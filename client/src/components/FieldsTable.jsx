import { useState } from 'react';
import CircularProgress from '@mui/material/CircularProgress';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';

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

// ── Analysis Tab ──────────────────────────────────────────────────────────────
function AnalysisTab({ fields, checkboxes }) {
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const hasData = fields.length > 0 || checkboxes.length > 0;

  const runAnalysis = async () => {
    setStatus('loading');
    setResult(null);
    setErrorMsg('');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields, checkboxes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed');
      setResult(data);
      setStatus('done');
    } catch (err) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  };

  // ── Idle / no data ──
  if (status === 'idle' || (status === 'error' && !result)) {
    return (
      <div className="analysis-placeholder">
        <div className="analysis-placeholder-icon">📊</div>
        <h3 className="analysis-placeholder-title">Case Duration Estimator</h3>
        <p className="analysis-placeholder-desc">
          AI will classify this incident into Massachusetts court categories and
          estimate how long a similar case historically takes to resolve, based
          on MassCourts data.
        </p>
        {status === 'error' && (
          <p className="analysis-error-msg">{errorMsg}</p>
        )}
        <button
          className="btn-analyze"
          onClick={runAnalysis}
          disabled={!hasData}
          title={hasData ? 'Run AI analysis' : 'Fill in the form fields first'}
        >
          {status === 'error' ? '↺ Retry Analysis' : '✦ Analyze This Incident'}
        </button>
        {!hasData && (
          <p className="analysis-no-data">Fill in at least one field to enable analysis.</p>
        )}
      </div>
    );
  }

  // ── Loading ──
  if (status === 'loading') {
    return (
      <div className="analysis-placeholder">
        <CircularProgress size={32} thickness={4} sx={{ color: '#3b82f6', mb: 1 }} />
        <p className="analysis-loading-title">Analyzing incident…</p>
        <p className="analysis-placeholder-desc">
          Gemini is classifying the case type, then running the prediction model.
        </p>
      </div>
    );
  }

  // ── Result ──
  const days = result?.predicted_days;
  const weeksApprox = days != null ? Math.round(days / 7) : null;

  return (
    <div className="analysis-result">
      {/* Headline metric */}
      <div className="analysis-metric-card">
        <span className="analysis-metric-label">Estimated Case Duration</span>
        {days != null ? (
          <>
            <span className="analysis-metric-value">{Math.round(days)}</span>
            <span className="analysis-metric-unit">
              days{weeksApprox ? ` (~${weeksApprox} wks)` : ''}
            </span>
          </>
        ) : (
          <span className="analysis-metric-na">Model unavailable</span>
        )}
        <span className="analysis-metric-note">
          Based on similar historical MassCourts cases
        </span>
      </div>

      {/* Classification cards */}
      <div className="analysis-cards">
        <div className="analysis-card">
          <span className="analysis-card-label">Court Department</span>
          <span className="analysis-card-value">{result.court_department}</span>
        </div>
        <div className="analysis-card">
          <span className="analysis-card-label">Case Type</span>
          <span className="analysis-card-value">{result.case_type}</span>
        </div>
        <div className="analysis-card">
          <span className="analysis-card-label">Likely Venue</span>
          <span className="analysis-card-value">{result.court_location}</span>
        </div>
      </div>

      {/* Gemini reasoning */}
      {result.reasoning && (
        <div className="analysis-reasoning">
          <span className="analysis-reasoning-label">AI Reasoning</span>
          <p className="analysis-reasoning-text">{result.reasoning}</p>
        </div>
      )}

      {/* Disclaimer + re-run */}
      <div className="analysis-footer">
        <p className="analysis-disclaimer">
          This is a historical estimate for informational purposes only — not legal advice.
        </p>
        <button className="btn-analyze btn-analyze--secondary" onClick={runAnalysis}>
          ↺ Re-analyze
        </button>
      </div>
    </div>
  );
}

// ── Main FieldsTable ──────────────────────────────────────────────────────────
function FieldsTable({
  fields,
  checkboxes,
  onFieldChange,
  onCheckboxChange,
  onFieldKeyChange,
  onCheckboxKeyChange,
  onDownload,
  onSave,
  saveStatus = 'idle',
  selectedDoc,
  extracting = false,
  style,
}) {
  const [activeTab, setActiveTab] = useState(0);

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
      {/* ── Header ── */}
      <div className="panel-header">
        <div>
          <h2 className="panel-title">
            {activeTab === 0 ? 'Extracted Fields' : 'Analysis'}
          </h2>
          {activeTab === 0 && (
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
          )}
        </div>
        {activeTab === 0 && (
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
          </div>
        )}
      </div>

      {/* ── MUI Tabs ── */}
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        sx={{
          borderBottom: '1px solid #e5e7eb',
          minHeight: 38,
          px: 1,
          '& .MuiTabs-indicator': { backgroundColor: '#3b82f6', height: 2 },
          '& .MuiTab-root': {
            minHeight: 38,
            fontSize: 12,
            fontWeight: 600,
            textTransform: 'none',
            color: '#6b7280',
            padding: '0 12px',
            letterSpacing: 0,
            fontFamily: 'inherit',
          },
          '& .Mui-selected': { color: '#3b82f6 !important' },
        }}
      >
        <Tab label="Fields / Table" />
        <Tab label="Analysis" />
      </Tabs>

      {/* ── Tab 0: Fields Table ── */}
      {activeTab === 0 && (
        <>
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
        </>
      )}

      {/* ── Tab 1: Analysis ── */}
      {activeTab === 1 && (
        <AnalysisTab fields={fields} checkboxes={checkboxes} />
      )}
    </aside>
  );
}

export default FieldsTable;
