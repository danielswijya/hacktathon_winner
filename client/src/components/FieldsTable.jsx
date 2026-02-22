import { useState, useEffect } from 'react';
import CircularProgress from '@mui/material/CircularProgress';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';

// API URL for Render deployment
const API_URL = 'https://hacktathon-winner.onrender.com';

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
function AnalysisTab({ fields, checkboxes, cachedResult, onAnalysisComplete }) {
  const [status, setStatus] = useState(cachedResult ? 'done' : 'idle');
  const [errorMsg, setErrorMsg] = useState('');
  const result = cachedResult ?? null;

  const hasData = fields.length > 0 || checkboxes.length > 0;
  const runAnalysis = async () => {
    setStatus('loading');
    setErrorMsg('');
    onAnalysisComplete?.(null);
    try {
      const res = await fetch(`${API_URL}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields, checkboxes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed');
      onAnalysisComplete?.(data);
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
        <div className="analysis-placeholder-icon analysis-placeholder-icon--chart" aria-hidden>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 3v18h18M7 16v-5M11 16v-3M15 16V9M19 16v-7" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
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
          {status === 'error' ? 'Retry Analysis' : 'Analyze This Incident'}
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

  // ── Form completion stats (from JSON form fields + checkboxes) ──
  const totalFields = fields.length + checkboxes.length;
  const filledFields = fields.filter((f) => f.value != null && String(f.value).trim() !== '').length;
  const filledCheckboxes = checkboxes.filter((cb) => cb.value === 'Yes' || cb.value === true).length;
  const filled = filledFields + filledCheckboxes;
  const pctComplete = totalFields ? Math.round((filled / totalFields) * 100) : 0;
  const missingFieldLabels = fields
    .filter((f) => !f.value || String(f.value).trim() === '')
    .map((f) => f.label || f.key || 'Field');
  const missingCheckboxLabels = checkboxes
    .filter((cb) => cb.value !== 'Yes' && cb.value !== true)
    .map((cb) => cb.label || cb.key || 'Option');
  const missingLabels = [...missingFieldLabels, ...missingCheckboxLabels];
  const maxShow = 5;

  // ── Result: two cards like mockup — left: Case Type, right: Est. Duration ──
  const days = result?.predicted_days;
  const weeksApprox = days != null ? Math.round(days / 7) : null;
  const monthsApprox = days != null ? (days / 30.44).toFixed(1) : null;

  const ScaleIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="analysis-hero-icon-svg">
      <path d="M12 2v6m0 4v10M5 8l7 4 7-4M5 8v4l7 4 7-4V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
  const ClockIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="analysis-hero-icon-svg">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/>
      <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
  const BuildingIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="analysis-hero-icon-svg">
      <path d="M4 21h16M4 10h16M9 21v-5h6v5M4 10V4h16v6M9 7h.01M15 7h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
  const PinIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="analysis-hero-icon-svg">
      <path d="M12 2c-3.3 0-6 2.7-6 6 0 4.4 6 10 6 10s6-5.6 6-10c0-3.3-2.7-6-6-6z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="12" cy="8" r="2" stroke="currentColor" strokeWidth="2"/>
    </svg>
  );
  // Donut: circumference = 2 * π * 36, stroke-dasharray = [arc, gap], arc = (pct/100)*circ
  const donutR = 36;
  const donutC = 2 * Math.PI * donutR;
  const donutArc = (pctComplete / 100) * donutC;

  return (
    <div className="analysis-result">
      {/* Top row: Form completed (donut + %) | Missing fields (list with red bullets) */}
      <div className="analysis-completion-row">
        <div className="analysis-completion-card analysis-completion-card--donut">
          <div className="analysis-completion-donut-wrap">
            <svg className="analysis-completion-donut" viewBox="0 0 88 88" aria-hidden>
              <circle
                className="analysis-completion-donut-bg"
                cx="44"
                cy="44"
                r={donutR}
                fill="none"
                strokeWidth="8"
              />
              <circle
                className="analysis-completion-donut-fill"
                cx="44"
                cy="44"
                r={donutR}
                fill="none"
                strokeWidth="8"
                strokeDasharray={`${donutArc} ${donutC}`}
                strokeLinecap="round"
                transform="rotate(-90 44 44)"
              />
            </svg>
            <span className="analysis-completion-donut-pct">{pctComplete}%</span>
          </div>
          <h3 className="analysis-completion-title">Form Completed</h3>
          <p className="analysis-completion-detail">{filled} of {totalFields} fields filled</p>
        </div>
        <div className="analysis-completion-card analysis-completion-card--missing">
          <h3 className="analysis-completion-title">Missing Fields</h3>
          <p className="analysis-completion-sub">
            {missingLabels.length === 0
              ? 'All fields filled'
              : `${missingLabels.length} field${missingLabels.length !== 1 ? 's' : ''} require attention`}
          </p>
          {missingLabels.length > 0 ? (
            <ul className="analysis-missing-list">
              {missingLabels.slice(0, maxShow).map((label, i) => (
                <li key={i}>{label}</li>
              ))}
              {missingLabels.length > maxShow && (
                <li className="analysis-missing-more">+{missingLabels.length - maxShow} more</li>
              )}
            </ul>
          ) : null}
        </div>
      </div>

      {/* Row 2: Case Type (left), Est. Duration (right) */}
      <div className="analysis-hero-cards">
        <div className="analysis-hero-card">
          <div className="analysis-hero-card-header">
            <span className="analysis-hero-icon analysis-hero-icon--scale">
              <ScaleIcon />
            </span>
            <span className="analysis-hero-card-label">Case type</span>
          </div>
          <div className="analysis-hero-card-value analysis-hero-card-value--text">
            {result?.case_type || '—'}
          </div>
        </div>
        <div className="analysis-hero-card">
          <div className="analysis-hero-card-header">
            <span className="analysis-hero-icon analysis-hero-icon--clock">
              <ClockIcon />
            </span>
            <span className="analysis-hero-card-label">Est. duration</span>
          </div>
          {days != null ? (
            <>
              <div className="analysis-hero-card-value">
                {weeksApprox} weeks
              </div>
              <div className="analysis-hero-card-detail">
                ~{monthsApprox} months total
              </div>
            </>
          ) : (
            <div className="analysis-hero-card-value analysis-hero-card-na">Model unavailable</div>
          )}
        </div>
      </div>

      {/* Second row: Court Department + Court Location (other regression inputs) */}
      <div className="analysis-hero-cards">
        <div className="analysis-hero-card">
          <div className="analysis-hero-card-header">
            <span className="analysis-hero-icon analysis-hero-icon--scale">
              <BuildingIcon />
            </span>
            <span className="analysis-hero-card-label">Court department</span>
          </div>
          <div className="analysis-hero-card-value analysis-hero-card-value--text">
            {result?.court_department || '—'}
          </div>
        </div>
        <div className="analysis-hero-card">
          <div className="analysis-hero-card-header">
            <span className="analysis-hero-icon analysis-hero-icon--clock">
              <PinIcon />
            </span>
            <span className="analysis-hero-card-label">Court location</span>
          </div>
          <div className="analysis-hero-card-value analysis-hero-card-value--text">
            {result?.court_location || '—'}
          </div>
        </div>
      </div>

      {/* Disclaimer + re-run */}
      <div className="analysis-footer">
        <p className="analysis-disclaimer">
          This is a historical estimate for informational purposes only — not legal advice.
        </p>
        <button className="btn-analyze btn-analyze--secondary" onClick={runAnalysis}>
          Re-analyze
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
  const [analysisCache, setAnalysisCache] = useState(null);

  useEffect(() => {
    setAnalysisCache(null);
  }, [selectedDoc?.id]);

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
        <AnalysisTab
          fields={fields}
          checkboxes={checkboxes}
          cachedResult={analysisCache}
          onAnalysisComplete={setAnalysisCache}
        />
      )}
    </aside>
  );
}

export default FieldsTable;
