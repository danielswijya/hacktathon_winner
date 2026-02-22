import { useState, useEffect, useRef, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import Sidebar from './components/Sidebar';
import UploadZone from './components/UploadZone';
import FieldsTable from './components/FieldsTable';
import Chatbot from './components/Chatbot';
import './App.css';

const INCIDENT_REPORT_PDF_URL =
  'https://yipobgbwuxafchqabmhr.supabase.co/storage/v1/object/public/documents/incident-report.pdf';

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
  const [chatbotOpen, setChatbotOpen] = useState(false);

  // ── Extraction progress: { done, total } ────────────────────────────────
  const [extraction, setExtraction] = useState({ done: 0, total: 0 });
  const extracting = extraction.total > 0 && extraction.done < extraction.total;

  // ── Session PDF cache: docId → Uint8Array ───────────────────────────────
  const pdfCacheRef = useRef(new Map());

  // ── Ref to PdfViewer for getPageCanvases() ──────────────────────────────
  const pdfViewerRef = useRef(null);

  // ── PDF-only fetch: load PDF buffer without resetting field state ────────
  // Used by session restore so user's unsaved edits are not overwritten.
  const fetchPdfForDoc = async (doc) => {
    // Level 1: Check in-memory cache (fastest)
    const cachedBuffer = pdfCacheRef.current.get(doc.id);
    if (cachedBuffer) {
      console.log('✅ PDF found in memory cache');
      setPdfBuffer(cachedBuffer);
      return;
    }

    // Level 2: Check sessionStorage (fast)
    try {
      const sessionKey = `pdf_buffer_${doc.id}`;
      const sessionData = sessionStorage.getItem(sessionKey);
      if (sessionData) {
        console.log('✅ PDF found in session storage');
        const binaryString = atob(sessionData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        pdfCacheRef.current.set(doc.id, bytes);
        setPdfBuffer(bytes);
        return;
      }
    } catch (err) {
      console.warn('⚠️ Failed to restore from sessionStorage:', err);
    }

    // Level 3: Fetch from server (reliable fallback)
    if (doc.id) {
      console.log('📥 Fetching PDF from server for session restore...');
      setLoading(true);
      try {
        const res = await fetch(`/api/documents/${doc.id}/pdf`);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const arrayBuffer = await res.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        pdfCacheRef.current.set(doc.id, bytes);
        try {
          const binaryString = Array.from(bytes).map(b => String.fromCharCode(b)).join('');
          const base64 = btoa(binaryString);
          if (base64.length < 5 * 1024 * 1024) {
            sessionStorage.setItem(`pdf_buffer_${doc.id}`, base64);
          }
        } catch { /* sessionStorage full */ }
        setPdfBuffer(bytes);
        console.log('✅ PDF fetched for session restore');
      } catch (err) {
        console.error('❌ Failed to fetch PDF for session restore:', err);
        setError(`Failed to load PDF: ${err.message}`);
      } finally {
        setLoading(false);
      }
    }
  };

  // ── Session persistence: save/restore viewer state on refresh ───────────
  useEffect(() => {
    // Restore state from sessionStorage on mount
    const lastDocId = sessionStorage.getItem('last_selected_doc_id');

    if (lastDocId) {
      const sessionKey = `doc_state_${lastDocId}`;
      const savedState = sessionStorage.getItem(sessionKey);

      if (savedState) {
        try {
          const parsed = JSON.parse(savedState);
          console.log('🔄 Restoring last session for doc:', lastDocId);

          // Restore document state (fields/checkboxes = user's current in-memory values)
          setSelectedDoc(parsed.selectedDoc);
          setFields(parsed.fields || []);
          setCheckboxes(parsed.checkboxes || []);

          // Only fetch the PDF — do NOT call handleSelectDoc which would
          // overwrite fields with the empty DB-saved values.
          fetchPdfForDoc(parsed.selectedDoc);

          console.log('✅ Session state restored');
        } catch (err) {
          console.error('Failed to restore session state:', err);
          sessionStorage.removeItem(sessionKey);
          sessionStorage.removeItem('last_selected_doc_id');
        }
      }
    }
  }, []); // Empty deps - only run once on mount

  // Track last selected document for session restore
  useEffect(() => {
    if (selectedDoc?.id) {
      sessionStorage.setItem('last_selected_doc_id', selectedDoc.id);
    }
  }, [selectedDoc]);

  // Save state to sessionStorage whenever it changes
  useEffect(() => {
    if (!selectedDoc || !pdfBuffer) {
      return; // Don't clear session - keep per-document caches
    }

    try {
      // Save document-specific session state
      const sessionKey = `doc_state_${selectedDoc.id}`;
      const state = {
        selectedDoc,
        fields,
        checkboxes,
        timestamp: Date.now(),
      };

      sessionStorage.setItem(sessionKey, JSON.stringify(state));
      
      // Save PDF buffer separately (with size check)
      const pdfKey = `pdf_buffer_${selectedDoc.id}`;
      const binaryString = Array.from(pdfBuffer)
        .map(byte => String.fromCharCode(byte))
        .join('');
      const base64 = btoa(binaryString);
      
      if (base64.length < 5 * 1024 * 1024) { // 5MB limit
        sessionStorage.setItem(pdfKey, base64);
      }
      
      console.log('💾 Saved document state to session');
    } catch (err) {
      console.error('Failed to save session state:', err);
    }
  }, [selectedDoc, pdfBuffer, fields, checkboxes]);

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
      setFields([]);
      setCheckboxes([]);
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

  // ── Delete document ──────────────────────────────────────────────────────
  const handleDelete = useCallback(async (docId) => {
    try {
      const res = await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
      if (res.ok) {
        // Clear if deleting current document
        if (selectedDoc?.id === docId) {
          setSelectedDoc(null);
          setPdfBuffer(null);
          setFields([]);
          setCheckboxes([]);
          setExtraction({ done: 0, total: 0 });
        }
        // Remove from cache
        pdfCacheRef.current.delete(docId);
        await fetchDocuments();
        showToast('Document deleted');
      }
    } catch (err) {
      console.error('Delete error:', err);
      showToast('Failed to delete document');
    }
  }, [selectedDoc, showToast]);

  const handleSelectDoc = async (doc) => {
    console.log('📄 Selecting document:', doc.display_name);
    setSelectedDoc(doc);
    setFields(doc.fields || []);
    setCheckboxes(doc.checkboxes || []);
    setError(null);
    setSaveStatus('idle');
    setExtraction({ done: 0, total: 0 });

    // Smart caching strategy: Memory → Session → Remote
    
    // Level 1: Check in-memory cache (fastest)
    const cachedBuffer = pdfCacheRef.current.get(doc.id);
    if (cachedBuffer) {
      console.log('✅ PDF found in memory cache');
      setPdfBuffer(cachedBuffer);
      return;
    }

    // Level 2: Check sessionStorage (fast)
    try {
      const sessionKey = `pdf_buffer_${doc.id}`;
      const sessionData = sessionStorage.getItem(sessionKey);
      if (sessionData) {
        console.log('✅ PDF found in session storage');
        const binaryString = atob(sessionData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        pdfCacheRef.current.set(doc.id, bytes);
        setPdfBuffer(bytes);
        return;
      }
    } catch (err) {
      console.warn('⚠️ Failed to restore from sessionStorage:', err);
    }

    // Level 3: Fetch from server (slowest but reliable)
    if (doc.pdf_storage_path || doc.id) {
      console.log('📥 Fetching PDF from server...');
      setLoading(true);
      try {
        const res = await fetch(`/api/documents/${doc.id}/pdf`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        }
        
        const arrayBuffer = await res.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        
        // Store in all cache levels for next time
        pdfCacheRef.current.set(doc.id, bytes);
        
        // Store in sessionStorage (with size limit check)
        try {
          const binaryString = Array.from(bytes)
            .map(byte => String.fromCharCode(byte))
            .join('');
          const base64 = btoa(binaryString);
          
          // Only cache if under 5MB to avoid quota errors
          if (base64.length < 5 * 1024 * 1024) {
            sessionStorage.setItem(`pdf_buffer_${doc.id}`, base64);
            console.log('💾 PDF cached to sessionStorage');
          } else {
            console.warn('⚠️ PDF too large for sessionStorage, using memory cache only');
          }
        } catch (storageErr) {
          console.warn('⚠️ sessionStorage full, using memory cache only');
        }
        
        setPdfBuffer(bytes);
        console.log('✅ PDF fetched and cached');
      } catch (err) {
        console.error('❌ Failed to fetch PDF:', err);
        setError(`Failed to load PDF: ${err.message}`);
        setPdfBuffer(null);
      } finally {
        setLoading(false);
      }
    } else {
      console.warn('⚠️ No PDF storage path available');
      setPdfBuffer(null);
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

  // ── JSON download ────────────────────────────────────────────────────────
  const handleDownload = () => {
    const payload = {
      filename: selectedDoc?.display_name || selectedDoc?.filename,
      exported_at: new Date().toISOString(),
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
          onDelete={handleDelete}
          onAIAdvisor={() => setChatbotOpen(true)}
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
          }}
          pdfViewerRef={pdfViewerRef}
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
          onSave={handleSave}
          saveStatus={saveStatus}
          selectedDoc={selectedDoc}
          extracting={extracting}
          style={{ width: rightPanelWidth }}
        />
      </div>
      <Chatbot fields={fields} checkboxes={checkboxes} open={chatbotOpen} onClose={() => setChatbotOpen(false)} />
    </div>
  );
}

export default App;
