import { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { fabric } from 'fabric';
import 'pdfjs-dist/web/pdf_viewer.css';

// Point to the bundled worker so Vite resolves it correctly
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href;

// PDF rendering constants - MUST match server for coordinate conversion
const DEFAULT_SCALE = 1.4;
const PAGE_WIDTH_PT = 612;
const PAGE_HEIGHT_PT = 792;
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

// Minimal stub so AnnotationLayer doesn't crash without a real link service
const STUB_LINK_SERVICE = {
  externalLinkEnabled: true,
  getDestinationHash: () => '',
  getAnchorUrl: () => '#',
  setHash: () => {},
  executeNamedAction: () => {},
  executeSetOCGState: () => {},
  cachePageRef: () => {},
  isPageVisible: () => true,
  isPageCached: () => true,
  addLinkAttributes: () => {},
};

// Fabric IText styling for overlay fields
const FIELD_STYLE = {
  fontSize: 12,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fill: '#111827',
  backgroundColor: 'rgba(255,255,255,0.95)',
  borderColor: 'rgba(59,130,246,0.8)',
  cornerColor: 'rgba(59,130,246,0.8)',
  editingBorderColor: 'rgba(59,130,246,1)',
  padding: 4,
  editable: true,
  selectable: true,
  hasControls: false,
  hasBorders: true,
  lockMovementX: true,
  lockMovementY: true,
  lockScalingX: true,
  lockScalingY: true,
  lockRotation: true,
};

// HTML select styling (Fabric has no native dropdown widget)
const SELECT_STYLE = `
  position: absolute;
  background: rgba(255,255,255,0.95);
  border: 1.5px solid rgba(59,130,246,0.6);
  border-radius: 2px;
  font-size: 11px;
  font-family: inherit;
  padding: 0 4px;
  outline: none;
  box-sizing: border-box;
  pointer-events: all;
`;

// ── Helper: draw one Fabric IText overlay ─────────────────────────────────────
function addFabricField(f, fabricCanvas, annotInputsRef, onAnnotationChange) {
  const itext = new fabric.IText(f.value ?? '', {
    ...FIELD_STYLE,
    left: f.x,
    top: f.y,
    width: f.w,
    fixedWidth: f.w,
    placeholder: f.label || '',
  });

  fabricCanvas.add(itext);

  const adapter = {
    get value() { return itext.text; },
    set value(v) {
      itext.set('text', v ?? '');
      fabricCanvas.renderAll();
    },
  };
  annotInputsRef.current.set(f.key, adapter);

  itext.on('changed', () => {
    if (onAnnotationChange) onAnnotationChange(f.key, itext.text);
  });
}

// ── Helper: draw one HTML <select> overlay ────────────────────────────────────
function addSelectField(cb, selectContainer, annotInputsRef, onAnnotationChange) {
  const sel = document.createElement('select');
  sel.style.cssText =
    SELECT_STYLE +
    `left:${cb.x}px;top:${cb.y}px;width:${cb.w}px;height:${cb.h}px;`;
  sel.style.position = 'absolute';

  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '-- select --';
  sel.appendChild(blank);
  (cb.options || []).forEach((opt) => {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    sel.appendChild(o);
  });

  sel.value = cb.value ?? '';
  selectContainer.appendChild(sel);
  sel.style.pointerEvents = 'all';

  annotInputsRef.current.set(cb.key, sel);
  sel.addEventListener('change', (e) => {
    if (onAnnotationChange) onAnnotationChange(cb.key, e.target.value);
  });
}

// ── Helper: draw one checkbox (visual tick mark) ──────────────────────────────
function addCheckboxField(cb, fabricCanvas, annotInputsRef, onAnnotationChange) {
  // Create a small square for the checkbox
  const rect = new fabric.Rect({
    left: cb.x,
    top: cb.y,
    width: cb.w || 20,
    height: cb.h || 20,
    fill: 'rgba(255,255,255,0.95)',
    stroke: 'rgba(59,130,246,0.8)',
    strokeWidth: 2,
    selectable: true,
    hasControls: false,
    hasBorders: true,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
  });

  // Create a checkmark text (visible if initially checked)
  const isInitiallyChecked = cb.value === 'Yes' || cb.value === true || cb.value === 'yes';
  const checkmark = new fabric.Text('✓', {
    left: cb.x + 3,
    top: cb.y - 2,
    fontSize: 18,
    fill: '#16a34a',
    fontWeight: 'bold',
    selectable: false,
    visible: isInitiallyChecked,
  });

  fabricCanvas.add(rect);
  fabricCanvas.add(checkmark);

  // Store both elements
  const adapter = {
    rect,
    checkmark,
    get value() {
      return checkmark.visible ? 'Yes' : null;
    },
    set value(v) {
      const isChecked = v === 'Yes' || v === true || v === 'yes';
      checkmark.set('visible', isChecked);
      fabricCanvas.renderAll();
    },
  };

  annotInputsRef.current.set(cb.key, adapter);

  // Toggle on click
  rect.on('mousedown', () => {
    const newValue = !checkmark.visible;
    checkmark.set('visible', newValue);
    fabricCanvas.renderAll();
    if (onAnnotationChange) {
      onAnnotationChange(cb.key, newValue ? 'Yes' : null);
    }
  });
}

// ── Incident Report Template ───────────────────────────────────────────────────
// Source coordinates are PDF points (x from left, y from BOTTOM of page).
// Canvas conversion: x_px = x_pt * SCALE,  y_px = (pageH_pt - y_pt) * SCALE
// SCALE = 1.4, Letter page = 612 × 792 pt → canvas ≈ 856.8 × 1108.8 px
//
// Pre-calculated at SCALE=1.4, pageH=792:
//   x_px = round(x_pt * 1.4, 1)
//   y_px = round((792 - y_pt) * 1.4, 1)
const INCIDENT_REPORT_TEMPLATE = {
  fields: [
    // ── Header ───────────────────────────────────────────────────────────────
    // date of incident: pdf(111.33, 589.13) → canvas(155.9, 284.0)
    { key: 'date_of_incident',    label: 'Date of Incident',    type: 'date',   page: 1, x: 155.9, y: 284.0,  w: 100, h: 18, value: '' },
    // time of incident: pdf(228.00, 583.79) → canvas(319.2, 291.5)
    { key: 'time_of_incident',    label: 'Time of Incident',    type: 'text',   page: 1, x: 319.2, y: 291.5,  w: 100, h: 18, value: '' },
    // day of week: pdf(441.33, 587.79) → canvas(617.9, 285.7)
    { key: 'day_of_week',         label: 'Day of Week',         type: 'text',   page: 1, x: 617.9, y: 285.7,  w: 120, h: 18, value: '' },
    // date of report: pdf(146.67, 567.13) → canvas(205.3, 314.6)
    { key: 'date_of_report',      label: 'Date of Report',      type: 'date',   page: 1, x: 205.3, y: 314.6,  w: 100, h: 18, value: '' },
    // report by: pdf(293.33, 566.46) → canvas(410.7, 315.5)
    { key: 'report_by',           label: 'Report By',           type: 'text',   page: 1, x: 410.7, y: 315.5,  w: 180, h: 18, value: '' },
    // location: pdf(172.67, 552.46) → canvas(241.7, 334.9)
    { key: 'location',            label: 'Location',            type: 'text',   page: 1, x: 241.7, y: 334.9,  w: 320, h: 18, value: '' },

    // ── Narrative (below location, above incident-type section) ──────────────
    // narrative: pdf(58.00, 539.13) → canvas(81.2, 354.0)
    { key: 'narrative',           label: 'Narrative',           type: 'text',   page: 1, x: 81.2,  y: 354.0,  w: 500, h: 18, value: '' },

    // ── Type of incident – specify text ──────────────────────────────────────
    // (specify): pdf(426.67, 467.46) → canvas(597.3, 454.2)
    { key: 'other_specify',       label: 'Other (specify)',     type: 'text',   page: 1, x: 597.3, y: 454.2,  w: 180, h: 18, value: '' },

    // ── Involved party ───────────────────────────────────────────────────────
    // Agency: pdf(140.00, 411.46) → canvas(196.0, 533.6)
    { key: 'agency',              label: 'Agency',              type: 'text',   page: 1, x: 196.0, y: 533.6,  w: 180, h: 18, value: '' },
    // witness 1: pdf(140.00, 399.46) → canvas(196.0, 550.4)
    { key: 'witness_1',           label: 'Witness 1',           type: 'text',   page: 1, x: 196.0, y: 550.4,  w: 180, h: 18, value: '' },
    // witness 2: pdf(139.33, 387.46) → canvas(195.1, 567.2)
    { key: 'witness_2',           label: 'Witness 2',           type: 'text',   page: 1, x: 195.1, y: 567.2,  w: 180, h: 18, value: '' },
    // telephone #: pdf(378.67, 436.79) → canvas(530.1, 497.1)
    { key: 'telephone',           label: 'Telephone #',         type: 'text',   page: 1, x: 530.1, y: 497.1,  w: 120, h: 18, value: '' },
    // visitor: pdf(378.00, 412.13) → canvas(529.2, 531.6)
    { key: 'visitor',             label: 'Visitor',             type: 'text',   page: 1, x: 529.2, y: 531.6,  w: 120, h: 18, value: '' },
    // visitor telephone #1: pdf(379.33, 400.13) → canvas(531.1, 548.4)
    { key: 'visitor_telephone_1', label: 'Visitor Tel. #1',     type: 'text',   page: 1, x: 531.1, y: 548.4,  w: 120, h: 18, value: '' },
    // visitor telephone #2: pdf(380.00, 386.79) → canvas(532.0, 567.1)
    { key: 'visitor_telephone_2', label: 'Visitor Tel. #2',     type: 'text',   page: 1, x: 532.0, y: 567.1,  w: 120, h: 18, value: '' },
    // Ext. #: pdf(518.67, 437.46) → canvas(726.1, 496.1)
    { key: 'ext',                 label: 'Ext. #',              type: 'text',   page: 1, x: 726.1, y: 496.1,  w: 80,  h: 18, value: '' },
    // Witness (name col): pdf(519.33, 411.46) → canvas(727.1, 533.5)
    { key: 'witness_name',        label: 'Witness',             type: 'text',   page: 1, x: 727.1, y: 533.5,  w: 80,  h: 18, value: '' },
    // witness ext. #1: pdf(519.33, 398.79) → canvas(727.1, 550.3)
    { key: 'witness_ext_1',       label: 'Witness Ext. #1',     type: 'text',   page: 1, x: 727.1, y: 550.3,  w: 80,  h: 18, value: '' },
    // witness ext. #2: pdf(519.33, 388.13) → canvas(727.1, 565.2)
    { key: 'witness_ext_2',       label: 'Witness Ext. #2',     type: 'text',   page: 1, x: 727.1, y: 565.2,  w: 80,  h: 18, value: '' },

    // ── Injuries ─────────────────────────────────────────────────────────────
    // injuries: pdf(138.00, 356.79) → canvas(193.2, 609.4)
    { key: 'injuries_yn',           label: 'Injuries',            type: 'text',   page: 1, x: 193.2, y: 609.4,  w: 100, h: 18, value: '' },
    // description of injuries: pdf(363.33, 356.79) → canvas(508.7, 609.4)
    { key: 'description_injuries',  label: 'Description of Injuries', type: 'text', page: 1, x: 508.7, y: 609.4, w: 200, h: 18, value: '' },

    // ── Notifications ─────────────────────────────────────────────────────────
    // police/fire/ems notified: pdf(195.33, 327.46) → canvas(273.5, 650.5)
    { key: 'police_fire_ems',     label: 'Police/Fire/EMS Notified', type: 'text', page: 1, x: 273.5, y: 650.5, w: 180, h: 18, value: '' },
    // bsb staff notified: pdf(163.33, 312.13) → canvas(228.7, 671.9)
    { key: 'bsb_staff_notified',  label: 'BSB Staff Notified',  type: 'text',   page: 1, x: 228.7, y: 671.9,  w: 180, h: 18, value: '' },
    // person notified #1: pdf(432.67, 326.79) → canvas(605.7, 651.4)
    { key: 'person_notified_1',   label: 'Person Notified #1',  type: 'text',   page: 1, x: 605.7, y: 651.4,  w: 200, h: 18, value: '' },
    // person notified #2: pdf(431.33, 312.13) → canvas(603.9, 671.9)
    { key: 'person_notified_2',   label: 'Person Notified #2',  type: 'text',   page: 1, x: 603.9, y: 671.9,  w: 200, h: 18, value: '' },

    // ── Subject description ───────────────────────────────────────────────────
    // race: pdf(278.67, 244.13) → canvas(390.1, 766.9)
    { key: 'race',                label: 'Race',                type: 'text',   page: 1, x: 390.1, y: 766.9,  w: 100, h: 18, value: '' },
    // height: pdf(278.67, 228.79) → canvas(390.1, 788.4)
    { key: 'height',              label: 'Height',              type: 'text',   page: 1, x: 390.1, y: 788.4,  w: 100, h: 18, value: '' },
    // age: pdf(409.33, 242.79) → canvas(573.1, 768.8)
    { key: 'age',                 label: 'Age',                 type: 'number', page: 1, x: 573.1, y: 768.8,  w: 60,  h: 18, value: '' },
    // eye color: pdf(410.00, 228.79) → canvas(574.0, 788.4)
    { key: 'eye_color',           label: 'Eye Color',           type: 'text',   page: 1, x: 574.0, y: 788.4,  w: 80,  h: 18, value: '' },
    // agency/visitor: pdf(496.67, 256.79) → canvas(695.3, 750.5)
    { key: 'agency_visitor',      label: 'Agency/Visitor',      type: 'text',   page: 1, x: 695.3, y: 750.5,  w: 120, h: 18, value: '' },

    // ── Identifiers & admin ────────────────────────────────────────────────────
    // other identifiers: pdf(151.33, 202.46) → canvas(211.9, 825.5)
    { key: 'other_identifiers',   label: 'Other Identifiers',   type: 'text',   page: 1, x: 211.9, y: 825.5,  w: 380, h: 18, value: '' },
    // referred to: pdf(269.33, 146.46) → canvas(377.1, 910.3)
    { key: 'referred_to',         label: 'Referred To',         type: 'text',   page: 1, x: 377.1, y: 910.3,  w: 150, h: 18, value: '' },
    // date received: pdf(112.00, 134.46) → canvas(156.8, 921.3)
    { key: 'date_received',       label: 'Date Received',       type: 'date',   page: 1, x: 156.8, y: 921.3,  w: 100, h: 18, value: '' },
    // comments: pdf(122.00, 122.46) → canvas(170.8, 938.1)
    { key: 'comments',            label: 'Comments',            type: 'text',   page: 1, x: 170.8, y: 938.1,  w: 380, h: 18, value: '' },
    // completed by: pdf(76.67, 95.13) → canvas(107.3, 975.4)
    { key: 'completed_by',        label: 'Completed By',        type: 'text',   page: 1, x: 107.3, y: 975.4,  w: 150, h: 18, value: '' },
    // date: pdf(485.33, 109.79) → canvas(679.5, 960.5)
    { key: 'date',                label: 'Date',                type: 'date',   page: 1, x: 679.5, y: 960.5,  w: 100, h: 18, value: '' },
  ],

  checkboxes: [
    // ── Type of incident (column 1) ───────────────────────────────────────────
    // injury: pdf(236.00, 524.46) → canvas(330.4, 374.9)
    { key: 'type_injury',         label: 'Injury',         page: 1, x: 330.4, y: 374.9, w: 18, h: 18, value: null },
    // fire: pdf(234.67, 504.46) → canvas(328.5, 402.9)
    { key: 'type_fire',           label: 'Fire',           page: 1, x: 328.5, y: 402.9, w: 18, h: 18, value: null },
    // theft: pdf(235.33, 481.46) → canvas(329.5, 435.1)
    { key: 'type_theft',          label: 'Theft',          page: 1, x: 329.5, y: 435.1, w: 18, h: 18, value: null },

    // ── Type of incident (column 2) ───────────────────────────────────────────
    // security issue: pdf(394.00, 524.13) → canvas(551.6, 374.5)
    { key: 'type_security_issue', label: 'Security Issue', page: 1, x: 551.6, y: 374.5, w: 18, h: 18, value: null },
    // mv accident: pdf(393.33, 503.46) → canvas(550.7, 403.3)
    { key: 'type_mv_accident',    label: 'MV Accident',    page: 1, x: 550.7, y: 403.3, w: 18, h: 18, value: null },
    // vandalism: pdf(393.33, 482.13) → canvas(550.7, 433.4)
    { key: 'type_vandalism',      label: 'Vandalism',      page: 1, x: 550.7, y: 433.4, w: 18, h: 18, value: null },

    // ── Type of incident (column 3) ───────────────────────────────────────────
    // threat: pdf(538.67, 524.79) → canvas(754.1, 374.1)
    { key: 'type_threat',         label: 'Threat',         page: 1, x: 754.1, y: 374.1, w: 18, h: 18, value: null },
    // assault: pdf(538.67, 503.46) → canvas(754.1, 403.3)
    { key: 'type_assault',        label: 'Assault',        page: 1, x: 754.1, y: 403.3, w: 18, h: 18, value: null },
    // Other: pdf(539.33, 481.46) → canvas(755.1, 435.1)
    { key: 'type_other',          label: 'Other',          page: 1, x: 755.1, y: 435.1, w: 18, h: 18, value: null },

    // ── Gender ────────────────────────────────────────────────────────────────
    // male: pdf(183.33, 242.79) → canvas(256.7, 768.9)
    { key: 'gender_male',         label: 'Male',           page: 1, x: 256.7, y: 768.9, w: 18, h: 18, value: null },
    // female: pdf(183.33, 230.13) → canvas(256.7, 786.6)
    { key: 'gender_female',       label: 'Female',         page: 1, x: 256.7, y: 786.6, w: 18, h: 18, value: null },
  ],
};

const PdfViewer = forwardRef(function PdfViewer(
  { pdfBuffer, fields, checkboxes, onAnnotationChange, onPageExtracted, onExtractionStart, selectedDoc, skipExtraction },
  ref
) {
  const containerRef = useRef(null);

  // Map: key → adapter with { get value(), set value(v) }
  const annotInputsRef = useRef(new Map());

  // Map: pageNum → fabric.Canvas instance
  const fabricCanvasesRef = useRef(new Map());

  // Map: pageNum → PDF.js canvas element (for jsPDF merging)
  const pdfCanvasesRef = useRef(new Map());

  // Container width from ResizeObserver — scale PDF and overlay to fit
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        setContainerWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep latest fields/checkboxes in refs so async callbacks can access them
  const fieldsRef = useRef(fields);
  const checkboxesRef = useRef(checkboxes);
  useEffect(() => { fieldsRef.current = fields; }, [fields]);
  useEffect(() => { checkboxesRef.current = checkboxes; }, [checkboxes]);

  // ── Expose getPageCanvases() to parent via ref ───────────────────────────
  useImperativeHandle(ref, () => ({
    getPageCanvases: () => {
      const result = [];
      const pageNums = [...pdfCanvasesRef.current.keys()].sort((a, b) => a - b);
      for (const pageNum of pageNums) {
        const pdfCanvas = pdfCanvasesRef.current.get(pageNum);
        const fabricCanvas = fabricCanvasesRef.current.get(pageNum);
        if (!pdfCanvas) continue;

        // Merge: PDF.js canvas + Fabric objects drawn on top
        const merged = document.createElement('canvas');
        merged.width = pdfCanvas.width;
        merged.height = pdfCanvas.height;
        const ctx = merged.getContext('2d');
        ctx.drawImage(pdfCanvas, 0, 0);
        if (fabricCanvas) {
          // lowerCanvasEl has all rendered Fabric objects
          ctx.drawImage(fabricCanvas.lowerCanvasEl, 0, 0);
        }
        result.push(merged);
      }
      return result;
    },
  }));

  // ── Load & render PDF when buffer or container width changes ─────────────
  useEffect(() => {
    if (!pdfBuffer || !containerRef.current) return;

    let cancelled = false;
    const container = containerRef.current;
    container.innerHTML = '';
    annotInputsRef.current.clear();
    pdfCanvasesRef.current.clear();

    // Dispose any existing Fabric canvases
    fabricCanvasesRef.current.forEach((fc) => fc.dispose());
    fabricCanvasesRef.current.clear();

    let availableWidth = containerWidth > 0 ? containerWidth - 32 : 0;
    if (availableWidth <= 0 && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      availableWidth = Math.max(0, rect.width - 32);
    }
    if (availableWidth <= 0) availableWidth = 856.8 - 32;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, availableWidth / PAGE_WIDTH_PT));

    (async () => {
      try {
        const pdfDoc = await pdfjsLib.getDocument({ data: pdfBuffer.slice() }).promise;
        if (cancelled) return;

        // Only announce extraction if we're actually going to extract
        if (!skipExtraction && onExtractionStart) onExtractionStart(pdfDoc.numPages);

        const SCALE = scale;

        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
          if (cancelled) return;
          const page = await pdfDoc.getPage(pageNum);
          const viewport = page.getViewport({ scale: SCALE });
          const W = viewport.width;
          const H = viewport.height;

          // ── Page wrapper ──
          const pageWrapper = document.createElement('div');
          pageWrapper.className = 'pdf-page-wrapper';
          pageWrapper.style.cssText = `
            position: relative;
            width: ${W}px;
            height: ${H}px;
            margin: 0 auto 16px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            background: #fff;
          `;
          container.appendChild(pageWrapper);

          // ── PDF.js canvas ──
          const pdfCanvas = document.createElement('canvas');
          pdfCanvas.width = W;
          pdfCanvas.height = H;
          pdfCanvas.style.cssText = `display:block;position:absolute;top:0;left:0;`;
          pageWrapper.appendChild(pdfCanvas);

          // Store for jsPDF merging
          pdfCanvasesRef.current.set(pageNum, pdfCanvas);

          await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport }).promise;
          if (cancelled) return;

          // ── AcroForm annotation layer ──
          const annotations = await page.getAnnotations();
          if (cancelled) return;

          const annotDiv = document.createElement('div');
          annotDiv.className = 'annotationLayer';
          pageWrapper.appendChild(annotDiv);

          const annotLayer = new pdfjsLib.AnnotationLayer({
            div: annotDiv,
            page,
            viewport,
            linkService: STUB_LINK_SERVICE,
            annotationStorage: pdfDoc.annotationStorage,
            accessibilityManager: null,
            annotationCanvasMap: null,
            annotationEditorUIManager: null,
            structTreeLayer: null,
            commentManager: null,
          });

          await annotLayer.render({
            annotations,
            viewport: viewport.clone({ dontFlip: true }),
            linkService: STUB_LINK_SERVICE,
            downloadManager: null,
            renderForms: true,
            enableScripting: false,
            hasJSActions: false,
          });

          // ── Fabric.js canvas (interactive overlay) ──
          const fabricEl = document.createElement('canvas');
          fabricEl.style.cssText = `position:absolute;top:0;left:0;pointer-events:none;z-index:10;`;
          pageWrapper.appendChild(fabricEl);

          const fabricCanvas = new fabric.Canvas(fabricEl, {
            width: W,
            height: H,
            selection: false,
            renderOnAddRemove: false,
          });
          fabricCanvasesRef.current.set(pageNum, fabricCanvas);

          // ── Select overlay container (for checkbox dropdowns) ──
          const selectContainer = document.createElement('div');
          selectContainer.style.cssText = `
            position: absolute; top: 0; left: 0;
            width: ${W}px; height: ${H}px;
            pointer-events: none;
            z-index: 11;
          `;
          pageWrapper.appendChild(selectContainer);

          // ── Check if this is an incident report ──
          const isIncidentReport = () => {
            if (!selectedDoc) return false;
            const name = (selectedDoc.display_name || selectedDoc.filename || '').toLowerCase();
            return name.includes('incident');
          };

          // Use hardcoded template for incident reports, otherwise use Gemini
          const useTemplate = isIncidentReport();

          if (skipExtraction) {
            // ── Re-render saved fields without re-extracting ──────────────────
            // Fields/checkboxes already live in parent state; scale coords to current view.
            const savedFields = fieldsRef.current.filter(f => f.page === pageNum);
            const savedCbs = checkboxesRef.current.filter(cb => cb.page === pageNum);
            const fieldScale = (f) => SCALE / (f._scale || DEFAULT_SCALE);
            const scaleField = (f) => {
              const k = fieldScale(f);
              return { ...f, x: f.x * k, y: f.y * k, w: f.w * k, h: f.h * k };
            };
            const scaleCb = (cb) => {
              const k = SCALE / (cb._scale || DEFAULT_SCALE);
              return { ...cb, x: cb.x * k, y: cb.y * k, w: cb.w * k, h: cb.h * k };
            };

            savedFields.forEach((f) => {
              addFabricField(scaleField(f), fabricCanvas, annotInputsRef, onAnnotationChange);
            });

            savedCbs.forEach((cb) => {
              const scaled = scaleCb(cb);
              if (scaled.options && scaled.options.length > 0) {
                addSelectField(scaled, selectContainer, annotInputsRef, onAnnotationChange);
              } else {
                addCheckboxField(scaled, fabricCanvas, annotInputsRef, onAnnotationChange);
              }
            });

            fabricCanvas.renderAll();
            if (savedFields.length > 0 || savedCbs.length > 0) {
              fabricEl.style.pointerEvents = 'all';
            }
            // Do NOT call onPageExtracted — fields are already in parent state.

          } else if (useTemplate && pageNum === 1) {
            // ── Page 1: Use hardcoded template ──────────────────────
            console.log('📋 Using hardcoded template for Incident Report Page 1');
            
            const templateFields = INCIDENT_REPORT_TEMPLATE.fields.filter(f => f.page === 1);
            const templateCheckboxes = INCIDENT_REPORT_TEMPLATE.checkboxes.filter(cb => cb.page === 1);

            // Draw text fields
            templateFields.forEach((f) => {
              addFabricField(f, fabricCanvas, annotInputsRef, onAnnotationChange);
            });

            // Draw checkboxes
            templateCheckboxes.forEach((cb) => {
              addCheckboxField(cb, fabricCanvas, annotInputsRef, onAnnotationChange);
            });

            fabricCanvas.renderAll();
            fabricEl.style.pointerEvents = 'all';

            // Notify parent to add these to the table
            // IMPORTANT: Store canvas metadata for accurate server-side coordinate conversion
            if (onPageExtracted) {
              onPageExtracted(
                templateFields.map(f => ({
                  ...f,
                  _canvasWidth: W,
                  _canvasHeight: H,
                  _scale: SCALE,
                  _pageWidthPt: PAGE_WIDTH_PT,
                  _pageHeightPt: PAGE_HEIGHT_PT,
                })),
                templateCheckboxes.map(cb => ({
                  ...cb,
                  _canvasWidth: W,
                  _canvasHeight: H,
                  _scale: SCALE,
                  _pageWidthPt: PAGE_WIDTH_PT,
                  _pageHeightPt: PAGE_HEIGHT_PT,
                }))
              );
            }
            
          } else {
            // ── Gemini per-page extraction (for non-incident-report pages) ──
            (async () => {
            try {
              // Show CSS spinner on this page while extracting
              const spinner = document.createElement('div');
              spinner.className = 'page-spinner';
              pageWrapper.appendChild(spinner);

              const imageData = pdfCanvas.toDataURL('image/jpeg', 0.85);
              const base64 = imageData.replace(/^data:image\/jpeg;base64,/, '');

              const res = await fetch('/api/extract-page', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64, pageNum }),
              });

              spinner.remove();
              if (cancelled) return;

              if (!res.ok) {
                console.error(`extract-page error page ${pageNum}:`, await res.text());
                if (onPageExtracted) onPageExtracted([], []);
                return;
              }

              const { fields: rawFields, checkboxes: rawCbs } = await res.json();

              // Convert percentage coordinates to pixels
              const fieldsWithPixels = rawFields.map(f => ({
                ...f,
                x: f.x_pct * W,
                y: f.y_pct * H,
                w: f.w_pct * W,
                h: f.h_pct * H,
                // Store canvas metadata for server-side conversion
                _canvasWidth: W,
                _canvasHeight: H,
                _scale: SCALE,
                _pageWidthPt: PAGE_WIDTH_PT,
                _pageHeightPt: PAGE_HEIGHT_PT,
              }));

              const cbsWithPixels = rawCbs.map(cb => ({
                ...cb,
                x: cb.x_pct * W,
                y: cb.y_pct * H,
                w: cb.w_pct * W,
                h: cb.h_pct * H,
                // Store canvas metadata for server-side conversion
                _canvasWidth: W,
                _canvasHeight: H,
                _scale: SCALE,
                _pageWidthPt: PAGE_WIDTH_PT,
                _pageHeightPt: PAGE_HEIGHT_PT,
              }));

              // Notify parent to add these to the table
              if (onPageExtracted) onPageExtracted(fieldsWithPixels, cbsWithPixels);

              // Enable pointer events on Fabric canvas now that we have fields
              if (fieldsWithPixels.length > 0) {
                fabricEl.style.pointerEvents = 'all';
              }

              // ── Draw Fabric IText for each field ──
              fieldsWithPixels.forEach((f) => {
                addFabricField(f, fabricCanvas, annotInputsRef, onAnnotationChange);
              });

              fabricCanvas.renderAll();

              // ── Draw HTML <select> for checkboxes ──
              cbsWithPixels.forEach((cb) => {
                addSelectField(cb, selectContainer, annotInputsRef, onAnnotationChange);
                selectContainer.style.pointerEvents = 'none';
              });

            } catch (err) {
              console.error(`Page ${pageNum} extraction failed:`, err);
              // Still count this page as done so the progress counter completes
              if (onPageExtracted) onPageExtracted([], []);
            }
          })();
          }
        }
      } catch (err) {
        console.error('PdfViewer render error:', err);
      }
    })();

    return () => {
      cancelled = true;
      fabricCanvasesRef.current.forEach((fc) => fc.dispose());
      fabricCanvasesRef.current.clear();
    };
  }, [pdfBuffer, containerWidth]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Table → PDF: push value changes into Fabric IText / HTML selects ───
  useEffect(() => {
    const allItems = [...(fields || []), ...(checkboxes || [])];
    let needsRender = false;
    
    allItems.forEach((item) => {
      const adapter = annotInputsRef.current.get(item.key);
      if (!adapter) return;
      const val = item.value ?? '';
      if (adapter.value !== val) {
        adapter.value = val;
        needsRender = true;
      }
    });
    
    // Re-render all Fabric canvases to show updated text
    if (needsRender) {
      fabricCanvasesRef.current.forEach((fc) => fc.renderAll());
    }
  }, [fields, checkboxes]);

  return (
    <div
      ref={containerRef}
      className="pdf-js-container"
      style={{ height: '100%' }}
    />
  );
});

export default PdfViewer;
