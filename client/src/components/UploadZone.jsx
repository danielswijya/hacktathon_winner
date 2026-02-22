import { useRef } from 'react';
import PdfViewer from './PdfViewer';

function UploadZone({
  selectedDoc,
  pdfBuffer,
  fields,
  checkboxes,
  onUpload,
  loading,
  onAnnotationChange,
  onPageExtracted,
  onExtractionStart,
  onNewUpload,
  pdfViewerRef,
}) {
  // If the doc already has fields/checkboxes in state, skip re-extraction and
  // just redraw the canvas overlays from the saved data. This prevents duplicates
  // when switching between documents or reloading the page.
  const skipExtraction = fields.length > 0 || checkboxes.length > 0;
  const fileRef = useRef();

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) { onUpload(file); e.target.value = ''; }
  };

  if (loading) {
    return (
      <main className="center">
        <div className="loading-state">
          <div className="spinner" />
          <p className="loading-title">Loading document...</p>
          <p className="loading-sub">Please wait</p>
        </div>
      </main>
    );
  }

  if (selectedDoc) {
    return (
      <main className="center">
        <div className="pdf-viewer">
          <div className="pdf-toolbar">
            <span className="pdf-toolbar-name">
              {selectedDoc.display_name || selectedDoc.filename}
            </span>
          </div>

          {pdfBuffer ? (
            <PdfViewer
              key={selectedDoc.id}
              ref={pdfViewerRef}
              pdfBuffer={pdfBuffer}
              fields={fields}
              checkboxes={checkboxes}
              onAnnotationChange={onAnnotationChange}
              onPageExtracted={onPageExtracted}
              onExtractionStart={onExtractionStart}
              selectedDoc={selectedDoc}
              skipExtraction={skipExtraction}
            />
          ) : (
            <div className="pdf-unavailable">
              <div className="pdf-unavailable-icon">📂</div>
              <p>PDF preview not available for this document.</p>
              <p className="pdf-unavailable-hint">Re-upload the file to view and sync it.</p>
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="center">
      <div className="empty-state">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        <div className="empty-icon">📄</div>
        <p className="empty-title">No document selected</p>
        <p className="empty-hint">Click "New Incident Report" or select a document from the sidebar</p>
        <button 
          className="btn-outline"
          onClick={() => fileRef.current.click()}
        >
          Upload PDF
        </button>
      </div>
    </main>
  );
}

export default UploadZone;
