require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const zlib = require('zlib');
const path = require('path');
const { spawn } = require('child_process');
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
  process.env.SUPABASE_SERVICE_ROLE_KEY // Service role bypasses RLS
);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(cors());
app.use(express.json({ limit: '20mb' })); // allow large base64 page images

function getDisplayName(storageFilename) {
  // Strip leading 13-digit timestamp prefix: "1234567890123-originalname.pdf"
  return storageFilename.replace(/^\d{13}-/, '');
}

// Per-page Gemini prompt — receives a single rendered page image, returns label/key/type with percentage coordinates
const PAGE_EXTRACT_PROMPT = `You are a legal form field extractor. Look at this PDF page image and identify ALL fillable fields with their exact locations. Return ONLY this JSON, no markdown:
{
  "fields": [
    {
      "label": "Human readable label",
      "key": "snake_case_key",
      "value": "",
      "type": "text | date | currency | number | signature",
      "page": 1,
      "x_pct": 0.45,
      "y_pct": 0.23,
      "w_pct": 0.15,
      "h_pct": 0.02,
      "format": "mm/dd/yyyy"
    }
  ],
  "checkboxes": [
    {
      "label": "Human readable label",
      "key": "snake_case_key",
      "value": null,
      "options": ["option 1", "option 2"],
      "page": 1,
      "x_pct": 0.12,
      "y_pct": 0.55,
      "w_pct": 0.02,
      "h_pct": 0.02
    }
  ]
}
Rules:
- value is always empty string or null since this is a blank form
- type must be one of: text, date, currency, number, signature
- keys must be unique snake_case, no duplicates
- x_pct, y_pct, w_pct, h_pct are fractions (0.0-1.0) of page width/height; x_pct/y_pct are the left/top edges of the fillable blank
- format: for date fields only — the date format printed on the form near the field (e.g. "mm/dd/yyyy", "dd/mm/yyyy"); omit if not visible
- List fields top-to-bottom, left-to-right as they appear on the page`;

// ── Content stream parser: finds horizontal lines and box rectangles in flat PDFs ──
// pageWidth (in PDF points) is used to reject full-width border lines.
function parseContentStream(bytes, pageNum, pageWidth) {
  let text;
  try { text = new TextDecoder('latin1').decode(bytes); } catch { return []; }

  const tokens = text.match(/[-\d.]+(?:\.\d*)?|[A-Za-z*]+/g) || [];
  const results = [];
  const stack = [];
  let mx = 0, my = 0;
  let lineWidth = 1; // tracks current PDF line width set by 'w' operator

  for (const tok of tokens) {
    const n = parseFloat(tok);
    if (!isNaN(n) && tok !== '') { stack.push(n); continue; }

    if (tok === 'w' && stack.length >= 1) {
      lineWidth = stack.pop(); // PDF 'w' operator sets line width
    } else if (tok === 'm' && stack.length >= 2) {
      my = stack.pop(); mx = stack.pop();
    } else if ((tok === 'l' || tok === 'L') && stack.length >= 2) {
      const ly = stack.pop(), lx = stack.pop();
      const lineLen = Math.abs(lx - mx);
      const isHorizontal = Math.abs(ly - my) < 2;
      const isFieldWidth  = lineLen > 50;
      // Reject full-width horizontal rules (borders, section dividers) — keep only lines < 85% of page width
      const isNotBorder   = !pageWidth || lineLen < pageWidth * 0.85;
      // Reject thick lines (borders, decorative rules) — field underlines are typically ≤1.5pt
      const isThinLine    = lineWidth <= 1.5;
      if (isHorizontal && isFieldWidth && isNotBorder && isThinLine) {
        const x = Math.min(mx, lx);
        results.push({ x, y: my, w: lineLen, h: 20, page: pageNum, kind: 'line' });
      }
      mx = lx; my = ly;
    } else if (tok === 're' && stack.length >= 4) {
      const h = stack.pop(), w = stack.pop(), y = stack.pop(), x = stack.pop();
      if (h < 40 && w > 50 && (!pageWidth || w < pageWidth * 0.85)) {
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
          const { width: pageWidthPts } = page.getSize();
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
            coords.push(...parseContentStream(bytes, pi + 1, pageWidthPts));
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
      // Flat PDF: draw text using canvas metadata for accurate coordinate conversion
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();

      // Helper: Convert canvas pixel coordinates to PDF points
      // Canvas: origin at top-left, y increases downward
      // PDF: origin at bottom-left, y increases upward
      function canvasToPdfCoords(item) {
        const scale = item._scale || 1.4;
        const canvasHeight = item._canvasHeight || (792 * scale);
        
        console.log(`Converting field: ${item.key || 'unknown'}`);
        console.log(`  Canvas: x=${item.x}, y=${item.y}, w=${item.w}, h=${item.h}`);
        console.log(`  Scale: ${scale}, Canvas Height: ${canvasHeight}`);
        
        // Convert x: canvas pixels → PDF points
        const pdfX = item.x / scale;
        
        // Convert y: flip coordinate system
        // Canvas y=0 is top, PDF y=0 is bottom
        // item.y is the TOP of the field in canvas coordinates
        // We need the BOTTOM of the field in PDF coordinates
        const pdfY = (canvasHeight - item.y - (item.h || 20)) / scale;
        
        const pdfW = (item.w || 100) / scale;
        const pdfH = (item.h || 20) / scale;

        console.log(`  PDF: x=${pdfX.toFixed(2)}, y=${pdfY.toFixed(2)}, w=${pdfW.toFixed(2)}, h=${pdfH.toFixed(2)}`);

        return { x: pdfX, y: pdfY, width: pdfW, height: pdfH };
      }

      for (const item of allItems) {
        if (!item.value) continue;
        const page = pages[(item.page || 1) - 1];
        if (!page) continue;
        
        // Convert canvas coordinates to PDF coordinates
        const coords = canvasToPdfCoords(item);
        
        // For checkboxes, draw a checkmark if value is "Yes"
        if (item.value === 'Yes' || item.value === true) {
          // Draw checkbox rectangle
          page.drawRectangle({
            x: coords.x,
            y: coords.y,
            width: coords.width,
            height: coords.height,
            borderColor: rgb(0.231, 0.51, 0.965), // rgba(59,130,246,0.8)
            borderWidth: 1.43, // 2px / 1.4
            color: rgb(1, 1, 1), // White background
            opacity: 0.95,
          });
          
          // Draw green checkmark
          page.drawText('✓', {
            x: coords.x + (coords.width * 0.15),
            y: coords.y + (coords.height * 0.1),
            size: coords.height * 0.9,
            font: helvetica,
            color: rgb(0.09, 0.64, 0.29), // Green (#16a34a)
          });
        } else {
          // Regular text field - draw background rectangle
          page.drawRectangle({
            x: coords.x,
            y: coords.y,
            width: coords.width,
            height: coords.height,
            color: rgb(1, 1, 1), // White background
            opacity: 0.95,
            borderColor: rgb(0.231, 0.51, 0.965), // rgba(59,130,246,0.8)
            borderWidth: 1.07, // 1.5px / 1.4
          });
          
          // Draw text
          const fontSize = 12; // Matches FIELD_STYLE
          page.drawText(String(item.value), {
            x: coords.x + 2.86, // 4px padding / 1.4
            y: coords.y + (coords.height * 0.2), // Vertical alignment
            size: fontSize,
            font: helvetica,
            color: rgb(0.067, 0.094, 0.153), // #111827
            maxWidth: coords.width - 5.71, // 8px total padding / 1.4
          });
        }
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

// POST /api/upload — upload PDF to Supabase Storage + save metadata to DB
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    // Get user from auth token (optional - allows both authenticated and anonymous uploads)
    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (!authError && user) {
        userId = user.id;
      }
    }    const timestamp = Date.now();
    const storageFilename = `${timestamp}-${file.originalname}`;
    
    // Store files in user-specific folder if authenticated, otherwise in 'anonymous' folder
    const storagePath = userId 
      ? `${userId}/${storageFilename}` 
      : `anonymous/${storageFilename}`;

    console.log(`📤 Uploading PDF to Supabase Storage: ${storagePath} (user: ${userId || 'anonymous'})`);

    // Upload PDF to Supabase Storage bucket 'documents' (your existing bucket)
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, file.buffer, {
        contentType: 'application/pdf',
        upsert: false,
        cacheControl: '3600',
      });

    if (uploadError) {
      console.error('❌ Supabase Storage upload failed:', uploadError);
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    console.log('✅ PDF uploaded to storage:', uploadData.path);

    // Get public URL for the uploaded file
    const { data: { publicUrl } } = supabase.storage
      .from('documents')
      .getPublicUrl(storagePath);

    // Save document metadata to database
    const { data: dbData, error: dbError } = await supabase
      .from('parsed_documents')
      .insert({
        user_id: userId,
        filename: storageFilename,
        pdf_storage_path: storagePath,
        pdf_public_url: publicUrl,
        fields: [],
        checkboxes: [],
        metadata: {
          original_name: file.originalname,
          file_size: file.size,
          mime_type: file.mimetype,
          uploaded_at: new Date().toISOString(),
        },
      })
      .select()
      .single();    if (dbError) {
      console.error('❌ Database insert failed:', dbError);
      // Cleanup: delete uploaded file if DB insert fails
      await supabase.storage.from('documents').remove([storagePath]);
      throw new Error(`Database insert failed: ${dbError.message}`);
    }

    console.log('✅ Document record created:', dbData.id);

    // Return the DB record plus computed fields the client needs
    res.json({
      ...dbData,
      display_name: getDisplayName(storageFilename),
    });
  } catch (err) {
    console.error('❌ Upload error:', err);
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

    // Filter out page number fields and stamp with actual page number
    const PAGE_NUMBER_KEYWORDS = [
      'page_current', 'page_total', 'page_number', 'page_count',
      'page_of', 'page_num', 'current_page', 'total_page', 'page'
    ];
    
    const fields = (parsed.fields || [])
      .filter(f => !PAGE_NUMBER_KEYWORDS.some(kw => f.key.toLowerCase().includes(kw)))
      .map((f) => ({ ...f, page: pageNum }));
    
    const checkboxes = (parsed.checkboxes || [])
      .filter(cb => !PAGE_NUMBER_KEYWORDS.some(kw => cb.key.toLowerCase().includes(kw)))
      .map((cb) => ({ ...cb, page: pageNum }));

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
      .order('id', { ascending: false });

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
// Requires parsed_documents.fields and .checkboxes to be JSONB (see database_ensure_jsonb_columns.sql)
app.patch('/api/documents/:id', async (req, res) => {
  try {
    const fields = Array.isArray(req.body.fields) ? req.body.fields : [];
    const checkboxes = Array.isArray(req.body.checkboxes) ? req.body.checkboxes : [];
    const docId = req.params.id;

    console.log(`💾 Saving document ${docId}: ${fields.length} fields, ${checkboxes.length} checkboxes`);

    const { data, error } = await supabase
      .from('parsed_documents')
      .update({ fields, checkboxes })
      .eq('id', docId)
      .select()
      .single();

    if (error) {
      console.error('Supabase update error:', error.message);
      throw error;
    }

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

// POST /api/documents/:id/analyze — load document JSON from Supabase, run Gemini + regression
// Uses stored fields/checkboxes in parsed_documents; Gemini picks city, court type, case type from allowed lists; regression outputs estimated days.
app.post('/api/documents/:id/analyze', async (req, res) => {
  try {
    const docId = req.params.id;
    const { data: doc, error: docError } = await supabase
      .from('parsed_documents')
      .select('id, fields, checkboxes, filename')
      .eq('id', docId)
      .single();

    if (docError || !doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const fields = doc.fields || [];
    const checkboxes = doc.checkboxes || [];
    const incidentSummary = buildIncidentSummaryFromDoc(fields, checkboxes);

    console.log(`📋 Analyzing document ${docId} from Supabase (parsed_documents)`);
    const result = await runAnalysisPipeline(incidentSummary);
    res.json(result);
  } catch (err) {
    console.error('❌ Document analyze error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/:id/pdf — fetch PDF buffer from Supabase Storage
app.get('/api/documents/:id/pdf', async (req, res) => {
  try {
    console.log(`📥 Fetching PDF for document ${req.params.id}`);
    
    // Get document metadata to find storage path
    const { data: doc, error: docError } = await supabase
      .from('parsed_documents')
      .select('filename')
      .eq('id', req.params.id)
      .single();

    if (docError) throw docError;
    if (!doc.filename) {
      return res.status(404).json({ error: 'PDF not found in storage' });
    }

    // Derive storage path from filename (format: pdfs/{timestamp}-{originalname}.pdf)
    const storagePath = `pdfs/${doc.filename}`;
    console.log(`📂 Downloading from storage: ${storagePath}`);

    // Download PDF from Supabase Storage
    const { data: pdfBlob, error: downloadError } = await supabase.storage
      .from('documents')
      .download(storagePath);

    if (downloadError) {
      console.error('❌ Storage download failed:', downloadError);
      throw downloadError;
    }

    // Convert Blob to Buffer
    const arrayBuffer = await pdfBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(`✅ PDF downloaded: ${buffer.length} bytes`);

    // Send PDF as binary
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.send(buffer);
  } catch (err) {
    console.error('❌ Fetch PDF error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/documents/:id — delete a document
app.delete('/api/documents/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('parsed_documents')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('Delete document error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Gemini prompt for court classification ───────────────────────────────────
// Base classification on Location (→ court_location) and Narrative (→ case_type, court_department). Only allowed list values.
const COURT_CLASSIFICATION_PROMPT = `You are a legal case classifier for Massachusetts courts.
An incident occurred at a Massachusetts government building managed by DCAMM. You will receive incident details from a form.

IMPORTANT — Use only these two inputs to decide the three outputs:
1. **Location** (form field): Use this to pick court_location. Map the city/area to the matching Massachusetts court in the court_location list (e.g. Cambridge → "Cambridge District Court", Boston → a Boston-area court from the list).
2. **Narrative** (form field): Use this to pick case_type and court_department. The narrative describes what happened (e.g. theft, injury, vandalism). Map that to one case_type and the court type (court_department) that would handle it.

You MUST output exactly one value from EACH of the three lists below. Do not invent values — only use strings that appear in the lists.

INCIDENT DETAILS (from form — pay special attention to "Location:" and "Narrative:"):
{INCIDENT_SUMMARY}

Return ONLY this JSON object — no markdown, no explanation outside the JSON:
{
  "court_department": "<exactly one value from the court_department list below>",
  "case_type": "<exactly one value from the case_type list below>",
  "court_location": "<exactly one value from the court_location list below>",
  "reasoning": "<1-2 sentence explanation of your classification>"
}

VALID court_department values (pick exactly one):
"District Court", "Housing Court", "Land Court Department", "Probate and Family Court", "The Superior Court", "BMC"

VALID case_type values (pick exactly one):
"Small Claims", "Domestic Relations", "Civil", "Torts", "Housing Court Summary Process", "Housing Court Civil",
"Housing Court Small Claims", "Housing Court Supplementary Process", "Administrative Civil Actions",
"Actions Involving the State/Municipality", "Equitable Remedies", "DR Custody, Support, and Parenting Time",
"Servicemembers", "Summary Process", "Paternity Managed", "Estates and Administration",
"Special Immigration Juvenile Status", "Guardianship Managed", "Equity Complaint", "Real Property",
"Contract / Business Cases", "Supplementary Process", "Tax Lien", "Miscellaneous", "Parentage", "Bail Petition"

VALID court_location values (pick exactly one):
"Fitchburg District Court", "Taunton District Court", "Wareham District Court",
"Worcester County Probate and Family Court", "Somerville District Court", "Westfield District Court",
"New Bedford District Court", "Norfolk County Probate and Family Court", "Barnstable County",
"Hampden County Probate and Family Court", "Central Housing Court", "Metro South Housing Court",
"Eastern Housing Court", "Southeast Housing Court", "Northeast Housing Court", "Western Housing Court",
"Suffolk County Civil", "Boston Housing Court", "Worcester Housing Court", "Middlesex County",
"Middlesex County Probate and Family Court", "BMC Central", "BMC East Boston", "Lawrence District Court",
"Salem District Court", "Land Court Division", "Franklin County Probate and Family Court",
"Plymouth Probate and Family Court", "Quincy District Court", "Gloucester District Court",
"Essex County Probate and Family Court", "Springfield District Court", "Framingham District Court",
"Leominster District Court", "Northampton District Court", "Bristol County Probate and Family Court",
"Newburyport District Court", "Berkshire County Probate and Family Court", "BMC West Roxbury",
"Hampshire County Probate and Family Court", "Dedham District Court", "Brookline District Court",
"Nantucket County Probate and Family Court", "Brockton District Court", "Worcester District Court",
"Barnstable County Probate and Family Court", "Falmouth District Court",
"Suffolk County Probate and Family Court", "Plymouth District Court", "Essex County", "BMC Dorchester",
"Pittsfield District Court", "Ipswich District Court", "BMC Charlestown", "Westborough District Court",
"Waltham District Court", "Lowell District Court", "Newton District Court", "Milford District Court",
"Cambridge District Court", "Edgartown District Court", "East Brookfield District Court",
"BMC Brighton", "Malden District Court", "Boston Municipal Central Court", "Barnstable District Court",
"Dudley District Court", "Clinton District Court", "BMC South Boston", "Marlborough District Court"

Classification rules:
- Injury / slip-and-fall / physical harm → case_type "Torts", court_department "District Court" or "The Superior Court"
- Theft / vandalism / property damage → case_type "Civil" or "Small Claims" (Small Claims if likely under $7,000)
- Assault / threat / security incident → case_type "Torts" or "Civil", court_department "District Court"
- Fire / emergency → case_type "Civil" or "Actions Involving the State/Municipality"
- court_location: use the incident location field to pick the nearest Massachusetts court; default to "Suffolk County Civil" if location is unclear or Boston-area
`;

// ── Helper: run Python prediction script ─────────────────────────────────────
function runPythonPrediction(court_department, case_type, court_location) {
  const scriptPath = path.join(__dirname, 'analysis', 'predict.py');
  const inputJson = JSON.stringify({ court_department, case_type, court_location });

  return new Promise((resolve, reject) => {
    const trySpawn = (cmd) => {
      // -u = unbuffered stdout/stderr so Node gets output immediately
      const py = spawn(cmd, ['-u', scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '', err = '';

      py.stdout.on('data', (d) => { out += d.toString(); });
      py.stderr.on('data', (d) => { err += d.toString(); });

      py.on('error', (spawnErr) => {
        if (cmd === 'python3') {
          console.warn('⚠️  "python3" not found, retrying with "python"...');
          trySpawn('python');
        } else {
          reject(new Error(`Could not spawn Python: ${spawnErr.message}`));
        }
      });

      py.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(err.trim() || `Python exited with code ${code}`));
        }
        const trimmed = out.trim();
        if (!trimmed) {
          return reject(new Error('predict.py produced no output. ' + (err.trim() || '')));
        }
        try {
          resolve(JSON.parse(trimmed));
        } catch (e) {
          reject(new Error(`Bad JSON from predict.py: ${trimmed.slice(0, 200)}`));
        }
      });

      py.stdin.write(inputJson, (e) => {
        if (e) reject(e);
      });
      py.stdin.end();
    };

    trySpawn('python3');
  });
}

// ── Helper: build incident summary from parsed_documents JSON (fields + checkboxes) ──
function buildIncidentSummaryFromDoc(fields = [], checkboxes = []) {
  const summaryLines = [];
  for (const f of fields) {
    if (f.value && String(f.value).trim()) {
      summaryLines.push(`${f.label}: ${f.value}`);
    }
  }
  for (const cb of checkboxes) {
    if (cb.value === 'Yes' || cb.value === true) {
      summaryLines.push(`${cb.label}: Yes`);
    }
  }
  return summaryLines.length > 0
    ? summaryLines.join('\n')
    : 'No incident details provided (blank form).';
}

// ── Helper: run Gemini classification + Python regression on an incident summary ──
async function runAnalysisPipeline(incidentSummary) {
  const prompt = COURT_CLASSIFICATION_PROMPT.replace('{INCIDENT_SUMMARY}', incidentSummary);
  console.log('🔍 Running Gemini court classification...');
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const result = await model.generateContent([{ text: prompt }]);
  let geminiText = result.response.text().trim()
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  let classification;
  try {
    classification = JSON.parse(geminiText);
  } catch {
    const match = geminiText.match(/\{[\s\S]*\}/);
    if (match) {
      classification = JSON.parse(match[0]);
    } else {
      throw new Error('Gemini did not return valid JSON: ' + geminiText.slice(0, 300));
    }
  }

  console.log('✅ Gemini classification:', {
    court_department: classification.court_department,
    case_type: classification.case_type,
    court_location: classification.court_location,
  });

  const FALLBACK_DAYS = {
    'District Court': 60,
    'BMC': 45,
    'Housing Court': 75,
    'Probate and Family Court': 120,
    'The Superior Court': 180,
    'Land Court Department': 150,
  };  let predicted_days = null;
  
  // Skip Python child process in serverless environments (Vercel, Render, etc.)
  // Child processes are not supported on serverless platforms
  const isServerless = process.env.VERCEL === '1' || 
                       process.env.RENDER === 'true' || 
                       process.env.AWS_LAMBDA_FUNCTION_NAME ||
                       !process.env.NODE_ENV || 
                       process.env.NODE_ENV === 'production';
  
  if (isServerless) {
    console.log('⚠️  Serverless environment detected, using fallback prediction');
    predicted_days = FALLBACK_DAYS[classification.court_department] ?? 90;
  } else {
    try {
      const pyResult = await runPythonPrediction(
        classification.court_department,
        classification.case_type,
        classification.court_location
      );
      predicted_days = pyResult.predicted_days;
      console.log(`✅ Python prediction: ${predicted_days} days`);
    } catch (pyErr) {
      console.error('⚠️  Python prediction failed (using fallback):', pyErr.message);
      predicted_days = FALLBACK_DAYS[classification.court_department] ?? 90;
    }
  }

  return {
    court_department: classification.court_department,
    case_type: classification.case_type,
    court_location: classification.court_location,
    reasoning: classification.reasoning || '',
    predicted_days,
  };
}

// POST /api/analyze — classify incident with Gemini, predict case duration with ML model
app.post('/api/analyze', async (req, res) => {
  try {
    const { fields = [], checkboxes = [] } = req.body;
    const incidentSummary = buildIncidentSummaryFromDoc(fields, checkboxes);
    const result = await runAnalysisPipeline(incidentSummary);
    res.json(result);
  } catch (err) {
    console.error('❌ Analyze error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── AI Chatbot routes (separate component, mounted here) ─────────────────────
app.use('/api/chatbot', require('./routes/chatbot'));

// Export for Vercel serverless function
module.exports = app;

// Only start server if running locally (not in Vercel)
if (process.env.VERCEL !== '1') {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`DocFlow server running on http://localhost:${PORT}`);
  });
}
