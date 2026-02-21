import { useState, useEffect, useRef, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import Sidebar from './components/Sidebar';
import UploadZone from './components/UploadZone';
import FieldsTable from './components/FieldsTable';
import './App.css';

// ── DCAMM Incident Report schema (hardcoded coordinates in canvas pixels) ──
const DCAMM_FIELDS = [
  { label: 'Date of Incident',    key: 'incident_date',      type: 'date',     page: 1, x: 320, y: 145, w: 180, h: 24 },
  { label: 'Time of Incident',    key: 'incident_time',      type: 'text',     page: 1, x: 320, y: 170, w: 180, h: 24 },
  { label: 'Day of Week',         key: 'day_of_week',        type: 'text',     page: 1, x: 320, y: 195, w: 180, h: 24 },
  { label: 'Date of Report',      key: 'report_date',        type: 'date',     page: 1, x: 320, y: 220, w: 180, h: 24 },
  { label: 'Report By',           key: 'report_by',          type: 'text',     page: 1, x: 320, y: 245, w: 180, h: 24 },
  { label: 'Location',            key: 'location',           type: 'text',     page: 1, x: 320, y: 270, w: 300, h: 24 },
  { label: 'Involved Party',      key: 'involved_party',     type: 'text',     page: 1, x: 200, y: 340, w: 250, h: 24 },
  { label: 'Telephone',           key: 'telephone',          type: 'text',     page: 1, x: 200, y: 365, w: 180, h: 24 },
  { label: 'Injury Description',  key: 'injury_description', type: 'text',     page: 1, x: 200, y: 430, w: 350, h: 24 },
  { label: 'Witness 1',           key: 'witness_1',          type: 'text',     page: 1, x: 200, y: 390, w: 250, h: 24 },
  { label: 'Witness 2',           key: 'witness_2',          type: 'text',     page: 1, x: 200, y: 415, w: 250, h: 24 },
  { label: 'Medical Bills ($)',   key: 'medical_bills',      type: 'currency', page: 1, x: 200, y: 455, w: 150, h: 24 },
  { label: 'Lost Wages ($)',      key: 'lost_wages',         type: 'currency', page: 1, x: 200, y: 480, w: 150, h: 24 },
  { label: 'Property Damage ($)', key: 'property_damage',    type: 'currency', page: 1, x: 200, y: 505, w: 150, h: 24 },
];

const DCAMM_CHECKBOXES = [
  { label: 'Injury',       key: 'type_injury',     options: ['Yes', 'No'], page: 1, x: 120, y: 310, w: 20, h: 20 },
  { label: 'Fire',         key: 'type_fire',        options: ['Yes', 'No'], page: 1, x: 120, y: 330, w: 20, h: 20 },
  { label: 'MV Accident',  key: 'type_mv_accident', options: ['Yes', 'No'], page: 1, x: 120, y: 350, w: 20, h: 20 },
  { label: 'Theft',        key: 'type_theft',       options: ['Yes', 'No'], page: 1, x: 120, y: 370, w: 20, h: 20 },
  { label: 'Injuries Y/N', key: 'injuries_yn',      options: ['Yes', 'No'], page: 1, x: 200, y: 410, w: 20, h: 20 },
];

const INCIDENT_REPORT_PDF_URL =
  'https://yipobgbwuxafchqabmhr.supabase.co/storage/v1/object/public/documents/incident-report.pdf';

// Helper: detect if a document is a DCAMM incident report by filename
function isReportDoc(doc) {
  return (doc?.display_name || doc?.filename || '').includes('Incident Report');
}

function App() {
  const [documents, setDocuments] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [pdfBuffer, setPdfBuffer] = useState(null);   // Uint8Array for PDF.js
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState([]);
  const [checkboxes, setCheckboxes] = useState([]);
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle'|'saving'|'saved'|'error'
  const [toast, setToast] = useState(null);             // string | null

  // Static mode: set when viewing a DCAMM incident report
  const [staticFields, setStaticFields] = useState(null);
  const [staticCheckboxes, setStaticCheckboxes] = useState(null);

  // ── Extraction progress: { done, total } ────────────────────────────────
  const [extraction, setExtraction] = useState({ done: 0, total: 0 });
  const extracting = extraction.total > 0 && extraction.done < extraction.total;

  // ── Session PDF cache: docId → Uint8Array ───────────────────────────────
  const pdfCacheRef = useRef(new Map());

  // ── Ref to PdfViewer for getPageCanvases() ──────────────────────────────
  const pdfViewerRef = useRef(null);

  // ── Resizable right panel ────────────────────────────────────────────────
  const [rightPanelWidth, setRightPanelWidth] = useState(440);
  const isResizingRef = useRef(false);

  const handleResizerMouseDown = useCallback((e) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev) => {
      if (!isResizingRef.current) return;
      const newWidth = window.innerWidth - ev.clientX;
      setRightPanelWidth(Math.max(280, Math.min(720, newWidth)));
    };

    const onMouseUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      if (res.ok) setDocuments(data);
    } catch (err) {
      console.error('Failed to fetch documents:', err);
    }
  };

  // ── Toast helper ────────────────────────────────────────────────────────
  const showToast = useCallback((message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── New Incident Report ─────────────────────────────────────────────────
  const handleNewIncidentReport = async () => {
    setLoading(true);
    setError(null);
    setExtraction({ done: 0, total: 0 });

    try {
      const response = await fetch(INCIDENT_REPORT_PDF_URL);
      if (!response.ok) throw new Error('Failed to fetch incident report PDF from Supabase');
      const arrayBuffer = await response.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      const formData = new FormData();
      formData.append(
        'pdf',
        new Blob([bytes], { type: 'application/pdf' }),
        'Incident Report.pdf'
      );

      const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(data.error || 'Failed to create incident report record');

      pdfCacheRef.current.set(data.id, bytes);
      setSelectedDoc(data);
      setPdfBuffer(bytes);
      setFields(DCAMM_FIELDS.map((f) => ({ ...f, value: '' })));
      setCheckboxes(DCAMM_CHECKBOXES.map((cb) => ({ ...cb, value: null })));
      setStaticFields(DCAMM_FIELDS);
      setStaticCheckboxes(DCAMM_CHECKBOXES);
      await fetchDocuments();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (file) => {
    setLoading(true);
    setError(null);
    setExtraction({ done: 0, total: 0 });

    // Read file into buffer immediately (needed for PDF.js + cache)
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const formData = new FormData();
    formData.append('pdf', file);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (res.ok) {
        pdfCacheRef.current.set(data.id, bytes);
        setSelectedDoc(data);
        setPdfBuffer(bytes);
        // Fields stream in page-by-page via onPageExtracted
        setFields([]);
        setCheckboxes([]);
        setStaticFields(null);
        setStaticCheckboxes(null);
        await fetchDocuments();
      } else {
        setError(data.error || 'Upload failed');
      }
    } catch (err) {
      setError('Network error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Called by PdfViewer once it knows total page count ───────────────────
  const handleExtractionStart = useCallback((total) => {
    setExtraction({ done: 0, total });
  }, []);

  // ── Streaming page-by-page field accumulation ────────────────────────────
  const handlePageExtracted = useCallback((newFields, newCheckboxes) => {
    setFields((prev) => [...prev, ...newFields]);
    setCheckboxes((prev) => [...prev, ...newCheckboxes]);
    setExtraction((prev) => ({ ...prev, done: prev.done + 1 }));
  }, []);

  const handleSelectDoc = (doc) => {
    setSelectedDoc(doc);
    setFields(doc.fields || []);
    setCheckboxes(doc.checkboxes || []);
    setError(null);
    setSaveStatus('idle');
    setExtraction({ done: 0, total: 0 });
    // Restore from session cache if available
    const cached = pdfCacheRef.current.get(doc.id);
    setPdfBuffer(cached || null);

    // Restore static mode if it's an incident report
    if (isReportDoc(doc)) {
      setStaticFields(DCAMM_FIELDS);
      setStaticCheckboxes(DCAMM_CHECKBOXES);
    } else {
      setStaticFields(null);
      setStaticCheckboxes(null);
    }
  };

  // ── Save snapshot to Supabase ────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!selectedDoc) return;
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/documents/${selectedDoc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields, checkboxes }),
      });
      const data = await res.json();
      if (res.ok) {
        setSaveStatus('saved');
        showToast('Saved successfully');
        await fetchDocuments();
      } else {
        console.error('Save failed:', data.error);
        setSaveStatus('error');
      }
    } catch (err) {
      console.error('Save error:', err);
      setSaveStatus('error');
    } finally {
      setTimeout(() => setSaveStatus('idle'), 2500);
    }
  }, [selectedDoc, fields, checkboxes, showToast]);

  // ── Field value handlers ─────────────────────────────────────────────────
  const handleFieldChange = useCallback((idx, value) => {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, value } : f)));
  }, []);

  const handleCheckboxChange = useCallback((idx, value) => {
    setCheckboxes((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, value: value || null } : c))
    );
  }, []);

  // ── Editable key handlers ────────────────────────────────────────────────
  const handleFieldKeyChange = useCallback((idx, key) => {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, key } : f)));
  }, []);

  const handleCheckboxKeyChange = useCallback((idx, key) => {
    setCheckboxes((prev) => prev.map((c, i) => (i === idx ? { ...c, key } : c)));
  }, []);

  // ── PDF annotation → table sync ──────────────────────────────────────────
  const handleAnnotationChange = useCallback((key, value) => {
    setFields((prev) =>
      prev.map((f) => (f.key === key ? { ...f, value } : f))
    );
    setCheckboxes((prev) =>
      prev.map((c) => (c.key === key ? { ...c, value } : c))
    );
  }, []);

  // ── jsPDF canvas-burn download ───────────────────────────────────────────
  const handleDownloadJsPdf = useCallback(async () => {
    if (!pdfViewerRef.current) return;
    const canvases = pdfViewerRef.current.getPageCanvases();
    if (!canvases || canvases.length === 0) return;

    const first = canvases[0];
    const pdf = new jsPDF('p', 'px', [first.width, first.height]);
    canvases.forEach((canvas, i) => {
      if (i > 0) pdf.addPage([canvas.width, canvas.height], 'p');
      pdf.addImage(
        canvas.toDataURL('image/jpeg', 0.95),
        'JPEG', 0, 0, canvas.width, canvas.height
      );
    });
    pdf.save(`incident-report-${Date.now()}.pdf`);
  }, []);

  // ── Server-side filled PDF download (generic PDFs) ───────────────────────
  const handleDownloadPdf = useCallback(async () => {
    if (!pdfBuffer || !selectedDoc) return;
    const formData = new FormData();
    formData.append('pdf', new Blob([pdfBuffer], { type: 'application/pdf' }), 'document.pdf');
    formData.append('fields', JSON.stringify(fields));
    formData.append('checkboxes', JSON.stringify(checkboxes));
    try {
      const res = await fetch('/api/fill-pdf', { method: 'POST', body: formData });
      if (!res.ok) { console.error('fill-pdf failed:', await res.text()); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedDoc?.display_name || 'filled'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('fill-pdf error:', err);
    }
  }, [pdfBuffer, selectedDoc, fields, checkboxes]);

  // ── JSON download ────────────────────────────────────────────────────────
  const handleDownload = () => {
    const payload = {
      filename: selectedDoc?.display_name || selectedDoc?.filename,
      exported_at: new Date().toISOString(),
      ...(isReportDoc(selectedDoc) && { template: 'dcamm-incident-report' }),
      fields,
      checkboxes,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedDoc?.display_name || 'fields'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isIncidentReport = !!staticFields;

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <span className="logo">DocFlow</span>
          <span className="logo-sep">|</span>
          <span className="logo-sub">AI PDF Field Extractor</span>
        </div>
        {selectedDoc && (
          <div className="header-right">
            <span className="header-doc-name">
              {selectedDoc.display_name || selectedDoc.filename}
            </span>
          </div>
        )}
      </header>

      {error && (
        <div className="error-banner">
          <span>Error: {error}</span>
          <button onClick={() => setError(null)} className="error-close">×</button>
        </div>
      )}

      {/* Toast notification */}
      {toast && <div className="toast">{toast}</div>}

      <div className="main">
        <Sidebar
          documents={documents}
          selectedDoc={selectedDoc}
          onSelect={handleSelectDoc}
          onNewIncidentReport={handleNewIncidentReport}
        />

        <UploadZone
          selectedDoc={selectedDoc}
          pdfBuffer={pdfBuffer}
          fields={fields}
          checkboxes={checkboxes}
          onUpload={handleUpload}
          loading={loading}
          onAnnotationChange={handleAnnotationChange}
          onPageExtracted={handlePageExtracted}
          onExtractionStart={handleExtractionStart}
          onNewUpload={() => {
            setSelectedDoc(null);
            setPdfBuffer(null);
            setFields([]);
            setCheckboxes([]);
            setExtraction({ done: 0, total: 0 });
            setStaticFields(null);
            setStaticCheckboxes(null);
          }}
          pdfViewerRef={pdfViewerRef}
          staticFields={staticFields}
          staticCheckboxes={staticCheckboxes}
        />

        {/* Draggable resizer between center and right panel */}
        <div
          className="resizer"
          onMouseDown={handleResizerMouseDown}
          title="Drag to resize"
        />

        <FieldsTable
          fields={fields}
          checkboxes={checkboxes}
          onFieldChange={handleFieldChange}
          onCheckboxChange={handleCheckboxChange}
          onFieldKeyChange={handleFieldKeyChange}
          onCheckboxKeyChange={handleCheckboxKeyChange}
          onDownload={handleDownload}
          onDownloadPdf={isIncidentReport ? null : handleDownloadPdf}
          onDownloadJsPdf={isIncidentReport ? handleDownloadJsPdf : null}
          hasPdfBuffer={!!pdfBuffer}
          onSave={handleSave}
          saveStatus={saveStatus}
          selectedDoc={selectedDoc}
          extracting={extracting}
          style={{ width: rightPanelWidth }}
        />
      </div>
    </div>
  );
}

export default App;
