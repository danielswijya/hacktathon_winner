import CircularProgress from '@mui/material/CircularProgress';

const TYPE_COLORS = {
  text: { bg: '#eff6ff', color: '#2563eb' },
  date: { bg: '#f0fdf4', color: '#16a34a' },
  currency: { bg: '#fefce8', color: '#ca8a04' },
  number: { bg: '#fdf4ff', color: '#9333ea' },
  signature: { bg: '#fff7ed', color: '#ea580c' },
};

function TypeBadge({ type }) {
  const style = TYPE_COLORS[type] || { bg: '#f3f4f6', color: '#374151' };
  return (
    <span className="type-badge" style={{ background: style.bg, color: style.color }}>
      {type}
    </span>
  );
}

const SAVE_LABEL = {
  idle: 'Save',
  saving: 'Saving…',
  saved: 'Saved ✓',
  error: 'Save failed',
};

// Sort by page → y → x so fields appear in reading order
function sortByPosition(arr) {
  return [...arr]
    .map((f, i) => ({ ...f, _i: i }))
    .sort((a, b) => {
      if (a.page !== b.page) return (a.page || 0) - (b.page || 0);
      if ((a.y || 0) !== (b.y || 0)) return (a.y || 0) - (b.y || 0);
      return (a.x || 0) - (b.x || 0);
    });
}

function FieldsTable({
  fields,
  checkboxes,
  onFieldChange,
  onCheckboxChange,
  onFieldKeyChange,
  onCheckboxKeyChange,
  onDownload,
  onDownloadPdf,
  onDownloadJsPdf,
  hasPdfBuffer = false,
  onSave,
  saveStatus = 'idle',
  selectedDoc,
  extracting = false,
  style,
}) {
  if (!selectedDoc) {
    return (
      <aside className="right-panel" style={style}>
        <div className="panel-empty">
          <div className="panel-empty-icon">🔍</div>
          <p className="panel-empty-title">No document selected</p>
          <p className="panel-empty-hint">
            Upload a PDF or start a new incident report
          </p>
        </div>
      </aside>
    );
  }

  const totalFields = fields.length + checkboxes.length;
  const sortedFields = sortByPosition(fields);
  const sortedCheckboxes = sortByPosition(checkboxes);

  return (
    <aside className="right-panel" style={style}>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Extracted Fields</h2>
          <span className="panel-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {totalFields} field{totalFields !== 1 ? 's' : ''} found
            {extracting && (
              <CircularProgress
                size={12}
                thickness={5}
                sx={{ color: '#3b82f6', flexShrink: 0 }}
              />
            )}
          </span>
        </div>
        <div className="panel-actions">
          <button
            className={`btn-save btn-save--${saveStatus}`}
            onClick={onSave}
            disabled={saveStatus === 'saving' || saveStatus === 'saved'}
            title="Save field values to Supabase"
          >
            {SAVE_LABEL[saveStatus]}
          </button>
          <button className="btn-primary" onClick={onDownload} title="Export fields as JSON">
            ⬇ JSON
          </button>
          {/* jsPDF download (incident reports) */}
          {onDownloadJsPdf && (
            <button className="btn-primary" onClick={onDownloadJsPdf} title="Download filled PDF">
              ⬇ PDF
            </button>
          )}
          {/* Server-side PDF download (generic PDFs) */}
          {!onDownloadJsPdf && hasPdfBuffer && (
            <button className="btn-primary" onClick={onDownloadPdf} title="Download filled PDF">
              ⬇ PDF
            </button>
          )}
        </div>
      </div>

      {fields.length === 0 && checkboxes.length === 0 && (
        <div className="panel-no-fields">
          <p>{extracting ? 'Extracting fields…' : 'No fields were extracted from this document.'}</p>
        </div>
      )}

      {sortedFields.length > 0 && (
        <section className="table-section">
          <h3 className="section-label">
            Form Fields
            <span className="section-count">{sortedFields.length}</span>
          </h3>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Key</th>
                  <th>Value</th>
                  <th>Type</th>
                  <th>Pg</th>
                </tr>
              </thead>
              <tbody>
                {sortedFields.map((field) => (
                  <tr key={`${field.key}-${field._i}`}>
                    <td className="td-label">{field.label}</td>
                    <td className="td-key">
                      <input
                        className="key-input"
                        value={field.key}
                        onChange={(e) => onFieldKeyChange(field._i, e.target.value)}
                        spellCheck={false}
                        title="Edit key name"
                      />
                    </td>
                    <td className="td-input">
                      <input
                        type={
                          field.type === 'number' || field.type === 'currency'
                            ? 'number'
                            : 'text'
                        }
                        value={field.value || ''}
                        onChange={(e) => onFieldChange(field._i, e.target.value)}
                        placeholder={
                          field.type === 'date'
                            ? (field.format || 'mm/dd/yyyy')
                            : `${field.type}...`
                        }
                        className="field-input"
                      />
                    </td>
                    <td>
                      <TypeBadge type={field.type} />
                    </td>
                    <td className="td-page">{field.page}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {sortedCheckboxes.length > 0 && (
        <section className="table-section">
          <h3 className="section-label">
            Checkboxes / Options
            <span className="section-count">{sortedCheckboxes.length}</span>
          </h3>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Key</th>
                  <th>Value</th>
                  <th>Pg</th>
                </tr>
              </thead>
              <tbody>
                {sortedCheckboxes.map((cb) => (
                  <tr key={`${cb.key}-${cb._i}`}>
                    <td className="td-label">{cb.label}</td>
                    <td className="td-key">
                      <input
                        className="key-input"
                        value={cb.key}
                        onChange={(e) => onCheckboxKeyChange(cb._i, e.target.value)}
                        spellCheck={false}
                        title="Edit key name"
                      />
                    </td>
                    <td className="td-input">
                      <select
                        value={cb.value ?? ''}
                        onChange={(e) => onCheckboxChange(cb._i, e.target.value)}
                        className="field-select"
                      >
                        <option value="">-- select --</option>
                        {(cb.options || []).map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </td>
                    <td className="td-page">{cb.page}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </aside>
  );
}

export default FieldsTable;
