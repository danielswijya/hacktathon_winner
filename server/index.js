require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const zlib = require('zlib');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { PDFDocument, PDFName, PDFArray, PDFDict, StandardFonts, rgb } = require('pdf-lib');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(cors());
app.use(express.json({ limit: '20mb' })); // allow large base64 page images

function getDisplayName(storageFilename) {
  // Strip leading 13-digit timestamp prefix: "1234567890123-originalname.pdf"
  return storageFilename.replace(/^\d{13}-/, '');
}

// Per-page Gemini prompt — receives a single rendered page image, returns label/key/type only
const PAGE_EXTRACT_PROMPT = `You are a legal form field extractor. Look at this PDF page image and identify ALL fillable fields. Return ONLY this JSON, no markdown:
{
  "fields": [
    {
      "label": "Human readable label",
      "key": "snake_case_key",
      "value": "",
      "type": "text | date | currency | number | signature",
      "page": 1
    }
  ],
  "checkboxes": [
    {
      "label": "Human readable label",
      "key": "snake_case_key",
      "value": null,
      "options": ["option 1", "option 2"],
      "page": 1
    }
  ]
}
Rules:
- value is always empty string or null since this is a blank form
- type must be one of: text, date, currency, number, signature
- keys must be unique snake_case, no duplicates
- List fields top-to-bottom, left-to-right as they appear on the page`;

// ── Content stream parser: finds horizontal lines and box rectangles in flat PDFs ──
function parseContentStream(bytes, pageNum) {
  let text;
  try { text = new TextDecoder('latin1').decode(bytes); } catch { return []; }

  const tokens = text.match(/[-\d.]+(?:\.\d*)?|[A-Za-z*]+/g) || [];
  const results = [];
  const stack = [];
  let mx = 0, my = 0;

  for (const tok of tokens) {
    const n = parseFloat(tok);
    if (!isNaN(n) && tok !== '') { stack.push(n); continue; }

    if (tok === 'm' && stack.length >= 2) {
      my = stack.pop(); mx = stack.pop();
    } else if ((tok === 'l' || tok === 'L') && stack.length >= 2) {
      const ly = stack.pop(), lx = stack.pop();
      if (Math.abs(ly - my) < 2 && Math.abs(lx - mx) > 50) {
        const x = Math.min(mx, lx);
        const w = Math.abs(lx - mx);
        const h = 20; // estimated field height above the underline
        results.push({ x, y: my, w, h, page: pageNum, kind: 'line' });
      }
      mx = lx; my = ly;
    } else if (tok === 're' && stack.length >= 4) {
      const h = stack.pop(), w = stack.pop(), y = stack.pop(), x = stack.pop();
      if (h < 40 && w > 50) {
        results.push({ x, y, w, h, page: pageNum, kind: 'rect' });
      }
    } else if ('SsfFbBqQ'.includes(tok) && tok.length === 1) {
      mx = 0; my = 0;
    } else {
      stack.length = 0;
    }
  }
  return results;
}

// POST /api/extract-coordinates — use pdf-lib to return exact field rects in PDF points
app.post(
  '/api/extract-coordinates',
  express.raw({ type: 'application/pdf', limit: '30mb' }),
  async (req, res) => {
    try {
      const pdfDoc = await PDFDocument.load(req.body, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();
      const coords = [];

      // ── Try AcroForm: iterate each page's /Annots array for Widget annotations ──
      let acroformFound = false;
      for (let pi = 0; pi < pages.length; pi++) {
        const pageNode = pages[pi].node;
        const annotsRef = pageNode.get(PDFName.of('Annots'));
        if (!annotsRef) continue;
        const annots = pdfDoc.context.lookupMaybe(annotsRef, PDFArray);
        if (!annots) continue;

        for (let j = 0; j < annots.size(); j++) {
          const annotRef = annots.get(j);
          const annot = pdfDoc.context.lookupMaybe(annotRef, PDFDict);
          if (!annot) continue;
          const subtype = annot.get(PDFName.of('Subtype'));
          if (!subtype || subtype.toString() !== '/Widget') continue;

          const rectRef = annot.get(PDFName.of('Rect'));
          const rectArr = pdfDoc.context.lookupMaybe(rectRef, PDFArray);
          if (!rectArr || rectArr.size() < 4) continue;

          const x1 = rectArr.get(0).asNumber();
          const y1 = rectArr.get(1).asNumber();
          const x2 = rectArr.get(2).asNumber();
          const y2 = rectArr.get(3).asNumber();

          let name;
          const tEntry = annot.get(PDFName.of('T'));
          if (tEntry) name = tEntry.decodeText?.() ?? tEntry.toString();

          coords.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1, page: pi + 1, kind: 'acroform', name });
          acroformFound = true;
        }
      }

      // ── Flat PDF fallback: parse content streams for drawn lines / rectangles ──
      if (!acroformFound) {
        for (let pi = 0; pi < pages.length; pi++) {
          const page = pages[pi];
          const contentsRef = page.node.get(PDFName.of('Contents'));
          if (!contentsRef) continue;

          const streamRefs = [];
          const contentsObj = pdfDoc.context.lookupMaybe(contentsRef);
          if (contentsObj instanceof PDFArray) {
            for (let k = 0; k < contentsObj.size(); k++) streamRefs.push(contentsObj.get(k));
          } else {
            streamRefs.push(contentsRef);
          }

          for (const ref of streamRefs) {
            const stream = pdfDoc.context.lookupMaybe(ref);
            if (!stream || !stream.contents) continue;
            let bytes = stream.contents;
            const filter = stream.dict?.get(PDFName.of('Filter'));
            if (filter && filter.toString() === '/FlateDecode') {
              try { bytes = zlib.inflateSync(Buffer.from(bytes)); } catch { continue; }
            }
            coords.push(...parseContentStream(bytes, pi + 1));
          }
        }
      }

      res.json({ coords });
    } catch (err) {
      console.error('extract-coordinates error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/fill-pdf — fill PDF with field values using pdf-lib, return filled PDF bytes
app.post('/api/fill-pdf', upload.single('pdf'), async (req, res) => {
  try {
    const pdfBytes = req.file.buffer;
    const fields     = JSON.parse(req.body.fields     || '[]');
    const checkboxes = JSON.parse(req.body.checkboxes || '[]');
    const allItems   = [...fields, ...checkboxes];

    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

    // ── Detect AcroForm ──
    let hasAcroForm = false;
    try {
      const form = pdfDoc.getForm();
      hasAcroForm = form.getFields().length > 0;
    } catch { /* no AcroForm */ }

    if (hasAcroForm) {
      // Fill by AcroForm field name (the /T entry extracted in extract-coordinates)
      const form = pdfDoc.getForm();
      for (const item of allItems) {
        if (!item.name || !item.value) continue;
        try { form.getTextField(item.name).setText(String(item.value)); continue; } catch { /* not text */ }
        try { form.getDropdown(item.name).select(String(item.value)); continue; }    catch { /* not dropdown */ }
        try { const cb = form.getCheckBox(item.name); if (item.value) cb.check(); else cb.uncheck(); } catch { /* skip */ }
      }
    } else {
      // Flat PDF: draw text at stored PDF-point coordinates
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();

      for (const item of allItems) {
        if (!item.value || item.xPts == null) continue;
        const page = pages[(item.page || 1) - 1];
        if (!page) continue;
        page.drawText(String(item.value), {
          x: item.xPts + 2,
          y: item.yPts + 4,   // baseline slightly above bottom of field rect
          size: 10,
          font: helvetica,
          color: rgb(0.07, 0.07, 0.15),
          maxWidth: item.wPts - 4,
        });
      }
    }

    const filled = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="filled.pdf"');
    res.send(Buffer.from(filled));
  } catch (err) {
    console.error('fill-pdf error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/upload — save PDF filename to DB immediately, no Gemini call
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const storageFilename = `${Date.now()}-${file.originalname}`;

    const { data: dbData, error: dbError } = await supabase
      .from('parsed_documents')
      .insert({
        filename: storageFilename,
        fields: [],
        checkboxes: [],
      })
      .select()
      .single();

    if (dbError) {
      console.error('Supabase DB error:', dbError);
      throw new Error(`Database insert failed: ${dbError.message}`);
    }

    res.json({
      ...dbData,
      display_name: getDisplayName(storageFilename),
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/extract-page — receive one rendered page as JPEG base64, extract fields with Gemini
app.post('/api/extract-page', async (req, res) => {
  try {
    const { image, pageNum } = req.body;
    if (!image) return res.status(400).json({ error: 'No image provided' });

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const result = await model.generateContent([
      {
        inlineData: {
          data: image, // base64 JPEG
          mimeType: 'image/jpeg',
        },
      },
      { text: PAGE_EXTRACT_PROMPT },
    ]);

    let responseText = result.response.text();

    let parsed;
    try {
      responseText = responseText
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();
      parsed = JSON.parse(responseText);
    } catch {
      const match = responseText.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('Gemini did not return valid JSON. Response: ' + responseText.slice(0, 300));
      }
    }

    // Stamp every field with the actual page number
    const fields = (parsed.fields || []).map((f) => ({ ...f, page: pageNum }));
    const checkboxes = (parsed.checkboxes || []).map((cb) => ({ ...cb, page: pageNum }));

    res.json({ fields, checkboxes });
  } catch (err) {
    console.error('Extract-page error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents — list all uploaded documents
app.get('/api/documents', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('parsed_documents')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(data.map((doc) => ({
      ...doc,
      display_name: getDisplayName(doc.filename),
    })));
  } catch (err) {
    console.error('Fetch documents error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/documents/:id — save updated field values (snapshot)
app.patch('/api/documents/:id', async (req, res) => {
  try {
    const { fields, checkboxes } = req.body;
    const { data, error } = await supabase
      .from('parsed_documents')
      .update({ fields, checkboxes })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json({ ...data, display_name: getDisplayName(data.filename) });
  } catch (err) {
    console.error('Save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/:id — get single document
app.get('/api/documents/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('parsed_documents')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;

    res.json({
      ...data,
      display_name: getDisplayName(data.filename),
    });
  } catch (err) {
    console.error('Fetch document error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`DocFlow server running on http://localhost:${PORT}`);
});
