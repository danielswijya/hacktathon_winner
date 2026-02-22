import { useState } from 'react';

function Sidebar({ documents, selectedDoc, onSelect, onNewIncidentReport, onDelete }) {
  // Local name overrides for incident reports (persist only in-session)
  const [localNames, setLocalNames] = useState({});

  const formatDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const isIncidentReport = (doc) =>
    (doc.display_name || doc.filename || '').includes('Incident Report');

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2 className="sidebar-title">Documents</h2>
        <span className="sidebar-count">{documents.length}</span>
      </div>

      <button
        className="btn-new-incident"
        onClick={onNewIncidentReport}
        title="Create a new DCAMM incident report"
      >
        + New Incident Report
      </button>

      {documents.length === 0 ? (
        <div className="sidebar-empty">
          <div className="sidebar-empty-icon">📂</div>
          <p>No documents yet</p>
          <p className="sidebar-empty-hint">Click above to start a new report</p>
        </div>
      ) : (
        <ul className="doc-list">
          {documents.map((doc) => {
            const isActive = selectedDoc?.id === doc.id;
            const isReport = isIncidentReport(doc);
            const fieldCount = (doc.fields || []).length;
            const cbCount = (doc.checkboxes || []).length;
            const displayName =
              localNames[doc.id] || doc.display_name || doc.filename;
            const dateStr = formatDate(doc.created_at);
            const timeStr = formatTime(doc.created_at);

            return (
              <li
                key={doc.id}
                className={`doc-item ${isActive ? 'doc-item--active' : ''}`}
                onClick={() => onSelect(doc)}
                title={displayName}
              >
                <div className="doc-item-icon">{isReport ? '📋' : '📄'}</div>
                <div className="doc-item-body">
                  {isReport ? (
                    <input
                      className="doc-name-input"
                      value={localNames[doc.id] ?? (doc.display_name || doc.filename || '')}
                      onChange={(e) =>
                        setLocalNames((prev) => ({ ...prev, [doc.id]: e.target.value }))
                      }
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Name this report..."
                    />
                  ) : (
                    <span className="doc-name">{displayName}</span>
                  )}
                  {(dateStr || timeStr) && (
                    <span className="doc-meta">
                      {[dateStr, timeStr].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  <div className="doc-badges">
                    {fieldCount > 0 && (
                      <span className="doc-badge">{fieldCount} fields</span>
                    )}
                    {cbCount > 0 && (
                      <span className="doc-badge doc-badge--cb">
                        {cbCount} checkboxes
                      </span>
                    )}
                    {isReport && (
                      <span className="doc-badge doc-badge--report">DCAMM</span>
                    )}
                  </div>
                </div>
                <button
                  className="doc-item-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${displayName}"?`)) {
                      onDelete(doc.id);
                    }
                  }}
                  title="Delete document"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* AI Advisor Box — pinned to sidebar bottom */}
      <div className="ai-advisor-box">
        <div className="ai-advisor-icon">✨</div>
        <div className="ai-advisor-content">
          <span className="ai-advisor-title">Talk with an AI Advisor</span>
          <span className="ai-advisor-sub">Get help filling out your report</span>
        </div>
        <div className="ai-advisor-arrow">›</div>
      </div>
    </aside>
  );
}

export default Sidebar;
