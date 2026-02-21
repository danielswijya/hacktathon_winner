import { useState, useRef } from 'react';
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
  staticFields,
  staticCheckboxes,
}) {
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef();

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') onUpload(file);
  };

  const handleDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setDragging(false); };

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
            {pdfBuffer && (
              <span className="pdf-sync-badge">⚡ Live sync</span>
            )}
            <button
              className="btn-outline"
              onClick={() => { onNewUpload(); setTimeout(() => fileRef.current?.click(), 0); }}
            >
              Upload New PDF
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </div>

          {pdfBuffer ? (
            <PdfViewer
              ref={pdfViewerRef}
              pdfBuffer={pdfBuffer}
              fields={fields}
              checkboxes={checkboxes}
              onAnnotationChange={onAnnotationChange}
              onPageExtracted={onPageExtracted}
              onExtractionStart={onExtractionStart}
              staticFields={staticFields}
              staticCheckboxes={staticCheckboxes}
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
      <div
        className={`drop-zone ${dragging ? 'drop-zone--active' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileRef.current.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && fileRef.current.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        <div className="drop-icon">{dragging ? '⬇️' : '📄'}</div>
        <p className="drop-title">
          {dragging ? 'Drop your PDF here' : 'Drag & drop a PDF'}
        </p>
        <p className="drop-hint">or click to browse · or use sidebar button for incident reports</p>
        <div className="drop-specs">
          <span>PDF only</span>
          <span>·</span>
          <span>Max 30 MB</span>
        </div>
      </div>
    </main>
  );
}

export default UploadZone;
