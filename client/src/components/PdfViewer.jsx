import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { fabric } from 'fabric';
import 'pdfjs-dist/web/pdf_viewer.css';

// Point to the bundled worker so Vite resolves it correctly
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href;

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
  backgroundColor: 'rgba(219,234,254,0.5)',
  borderColor: 'rgba(59,130,246,0.6)',
  cornerColor: 'rgba(59,130,246,0.6)',
  editingBorderColor: 'rgba(59,130,246,0.9)',
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
  background: rgba(219,234,254,0.5);
  border: 1.5px solid rgba(59,130,246,0.4);
  border-radius: 2px;
  font-size: 11px;
  font-family: inherit;
  padding: 0 4px;
  outline: none;
  box-sizing: border-box;
  pointer-events: all;
`;

// ── Coordinate conversion ─────────────────────────────────────────────────────
// Convert one pdf-lib coord {x,y,w,h} (PDF points, y from bottom-left of page)
// to canvas pixels (y from top-left) using the PDF.js page object and render SCALE.
function pdfPtsToPixels(coord, page, SCALE) {
  const vp1 = page.getViewport({ scale: 1 });
  return {
    x: coord.x * SCALE,
    y: (vp1.height - coord.y - coord.h) * SCALE, // Y-flip: PDF bottom-left → canvas top-left
    w: coord.w * SCALE,
    h: coord.h * SCALE,
    // Preserve original PDF-point coords so the fill-pdf server route can use them
    xPts: coord.x,
    yPts: coord.y,
    wPts: coord.w,
    hPts: coord.h,
    kind: coord.kind,   // 'acroform' | 'line' | 'rect'
    name: coord.name,   // AcroForm /T field name (undefined for flat PDFs)
  };
}

// ── Reading-order merge ───────────────────────────────────────────────────────
// Match Gemini semantic items to pdf-lib pixel coords by index (both in reading order).
// Items without a coord match are kept (appear in table, no PDF overlay).
function mergeByReadingOrder(geminiItems, pdfPixelCoords) {
  const len = Math.min(geminiItems.length, pdfPixelCoords.length);
  const merged = [];
  for (let i = 0; i < len; i++) {
    merged.push({ ...geminiItems[i], ...pdfPixelCoords[i] });
  }
  for (let i = len; i < geminiItems.length; i++) {
    merged.push(geminiItems[i]);
  }
  return merged;
}

// ── Helper: draw one Fabric IText overlay ─────────────────────────────────────
function addFabricField(f, fabricCanvas, annotInputsRef, onAnnotationChange) {
  const itext = new fabric.IText('', {
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

const PdfViewer = forwardRef(function PdfViewer(
  { pdfBuffer, fields, checkboxes, onAnnotationChange, onPageExtracted, onExtractionStart, staticFields, staticCheckboxes },
  ref
) {
  const containerRef = useRef(null);

  // Map: key → adapter with { get value(), set value(v) }
  const annotInputsRef = useRef(new Map());

  // Map: pageNum → fabric.Canvas instance
  const fabricCanvasesRef = useRef(new Map());

  // Map: pageNum → PDF.js canvas element (for jsPDF merging)
  const pdfCanvasesRef = useRef(new Map());

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

  // ── Load & render PDF whenever the buffer changes ──────────────────────
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

    (async () => {
      try {
        // In dynamic mode: fire coordinate extraction in parallel with PDF rendering
        const coordsPromise = staticFields
          ? Promise.resolve({ coords: [] })
          : fetch('/api/extract-coordinates', {
              method: 'POST',
              headers: { 'Content-Type': 'application/pdf' },
              body: pdfBuffer,
            })
              .then((r) => r.json())
              .catch(() => ({ coords: [] }));

        const pdfDoc = await pdfjsLib.getDocument({ data: pdfBuffer.slice() }).promise;
        if (cancelled) return;

        // Tell parent how many pages are about to be extracted (dynamic mode only)
        if (onExtractionStart && !staticFields) onExtractionStart(pdfDoc.numPages);

        const SCALE = 1.4;

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
          fabricEl.style.cssText = `position:absolute;top:0;left:0;pointer-events:none;`;
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
          `;
          pageWrapper.appendChild(selectContainer);

          if (staticFields) {
            // ── Static mode: draw overlays from hardcoded DCAMM schema ──────────
            const pageFields = (staticFields || []).filter((f) => f.page === pageNum);
            const pageCbs = (staticCheckboxes || []).filter((cb) => cb.page === pageNum);

            pageFields.forEach((f) => {
              addFabricField(f, fabricCanvas, annotInputsRef, onAnnotationChange);
            });

            pageCbs.forEach((cb) => {
              addSelectField(cb, selectContainer, annotInputsRef, onAnnotationChange);
              selectContainer.style.pointerEvents = 'none';
            });

            fabricCanvas.renderAll();

            if (pageFields.length > 0) fabricEl.style.pointerEvents = 'all';

            // Immediately sync any saved values (e.g. reloading from sidebar)
            const allItems = [
              ...(fieldsRef.current || []),
              ...(checkboxesRef.current || []),
            ];
            allItems.forEach((item) => {
              const adapter = annotInputsRef.current.get(item.key);
              if (!adapter || !item.value) return;
              adapter.value = item.value;
            });

          } else {
            // ── Dynamic mode: Gemini per-page extraction ──────────────────────
            ;(async () => {
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

                // ── Await pdf-lib coordinates (already resolved before Gemini finishes) ──
                const { coords: allCoords } = await coordsPromise;

                // Filter to this page, convert PDF points → canvas pixels, sort reading order
                const pageCoords = (allCoords || [])
                  .filter((c) => c.page === pageNum)
                  .map((c) => pdfPtsToPixels(c, page, SCALE))
                  .sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);

                const allGemini = [
                  ...rawFields.map((f) => ({ ...f, _kind: 'field' })),
                  ...rawCbs.map((cb) => ({ ...cb, _kind: 'checkbox' })),
                ];
                const allMerged = mergeByReadingOrder(allGemini, pageCoords);

                const mergedFields = allMerged.filter((i) => i._kind === 'field');
                const mergedCbs   = allMerged.filter((i) => i._kind === 'checkbox');

                // Notify parent to add these to the table
                if (onPageExtracted) onPageExtracted(mergedFields, mergedCbs);

                // Enable pointer events on Fabric canvas now that we have fields
                if (mergedFields.some((f) => f.x != null)) {
                  fabricEl.style.pointerEvents = 'all';
                }

                // ── Draw Fabric IText for each field that got exact coordinates ──
                mergedFields.filter((f) => f.x != null).forEach((f) => {
                  addFabricField(f, fabricCanvas, annotInputsRef, onAnnotationChange);
                });

                fabricCanvas.renderAll();

                // ── Draw HTML <select> for checkboxes that got exact coordinates ──
                mergedCbs.filter((cb) => cb.x != null).forEach((cb) => {
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
  }, [pdfBuffer]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Table → PDF: push value changes into Fabric IText / HTML selects ───
  useEffect(() => {
    const allItems = [...(fields || []), ...(checkboxes || [])];
    allItems.forEach((item) => {
      const adapter = annotInputsRef.current.get(item.key);
      if (!adapter) return;
      const val = item.value ?? '';
      if (adapter.value !== val) adapter.value = val;
    });
  }, [fields, checkboxes]);

  return (
    <div
      ref={containerRef}
      className="pdf-js-container"
    />
  );
});

export default PdfViewer;
