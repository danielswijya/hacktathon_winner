/**
 * Chatbot.jsx — AI Legal Assistant floating panel
 *
 * Drop-in component. Add to App.jsx:
 *   import Chatbot from './components/Chatbot';
 *   <Chatbot fields={fields} checkboxes={checkboxes} />
 *
 * Requires NO extra npm packages — uses only @mui/material (already installed).
 * Connects to /api/chatbot/analyze and /api/chatbot/chat on the existing server.
 */

import { useState, useEffect, useRef } from 'react';
import {
  Box,
  Drawer,
  Typography,
  Tabs,
  Tab,
  CircularProgress,
  Alert,
  Paper,
  List,
  ListItem,
  ListItemText,
  Chip,
  Button,
  TextField,
  IconButton,
  Accordion,
  AccordionSummary,
  AccordionDetails,  Divider,
} from '@mui/material';

const API_URL = 'https://hacktathon-winner.onrender.com';

// ── Inline SVG icons (no @mui/icons-material needed) ────────────────────────

const SpeakerSvg = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
  </svg>
);
const StopSvg = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 6h12v12H6z" />
  </svg>
);
const MicSvg = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z" />
  </svg>
);
const CloseSvg = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </svg>
);
const RefreshSvg = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
  </svg>
);
const SendSvg = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
  </svg>
);
const ExpandSvg = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" />
  </svg>
);
const LinkSvg = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 4 }}>
    <path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
  </svg>
);

// ── Colour palette ────────────────────────────────────────────────────────────
const PURPLE = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';

// ── Tab panel helper ──────────────────────────────────────────────────────────
function TabPanel({ value, index, children }) {
  return value === index ? <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>{children}</Box> : null;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Chatbot({ fields = [], checkboxes = [], open = false, onClose }) {
  const [tab, setTab] = useState(0);

  // Analysis state
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);

  // Chat state
  const [history, setHistory] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef(null);

  // TTS state
  const [playingIdx, setPlayingIdx] = useState(null);
  const [ttsLoadingIdx, setTtsLoadingIdx] = useState(null);
  const audioRef = useRef(null);

  // STT (voice input) state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const hasDoc = fields.length > 0 || checkboxes.length > 0;

  // Auto-analyze when the drawer opens and we have a document
  useEffect(() => {
    if (open && hasDoc && !analysis && !loading) {
      runAnalysis();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset analysis when document changes
  useEffect(() => {
    setAnalysis(null);
  }, [fields, checkboxes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll chat to bottom on new messages
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, chatLoading]);
  async function runAnalysis() {
    setLoading(true);
    setAnalysisError(null);
    try {
      const res = await fetch(`${API_URL}/api/chatbot/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields, checkboxes }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setAnalysis(data);
    } catch (e) {
      setAnalysisError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function sendChat() {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput('');
    const next = [...history, { role: 'user', content: msg }];
    setHistory(next);    setChatLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/chatbot/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, fields, checkboxes, history }),
      });
      const data = await res.json();
      setHistory([...next, { role: 'assistant', content: data.response }]);
    } catch {
      setHistory([...next, { role: 'assistant', content: '⚠️ Could not get a response. Please try again.' }]);
    } finally {
      setChatLoading(false);
    }
  }

  async function toggleRecording() {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setIsTranscribing(true);        try {
          const fd = new FormData();
          fd.append('audio', blob, 'recording.webm');
          const res = await fetch(`${API_URL}/api/chatbot/transcribe`, { method: 'POST', body: fd });
          const data = await res.json();
          if (data.text) setChatInput((prev) => (prev ? `${prev} ${data.text}` : data.text));
        } catch { /* ignore */ } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch { /* mic permission denied */ }
  }

  async function playMessage(text, idx) {
    // If already playing this message, stop it
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      if (playingIdx === idx) {
        setPlayingIdx(null);
        return;
      }
    }    setTtsLoadingIdx(idx);
    try {
      const res = await fetch(`${API_URL}/api/chatbot/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error('TTS failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      setTtsLoadingIdx(null);
      setPlayingIdx(idx);
      audio.onended = () => {
        setPlayingIdx(null);
        URL.revokeObjectURL(url);
        audioRef.current = null;
      };
      audio.play();
    } catch {
      setTtsLoadingIdx(null);
      setPlayingIdx(null);
    }
  }

  // ── Shared loading / error states used across tabs ────────────────────────
  const LoadingState = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 6, gap: 2 }}>
      <CircularProgress sx={{ color: '#667eea' }} />
      <Typography variant="body2" color="text.secondary">
        Analyzing your incident report…
      </Typography>
    </Box>
  );

  const ErrorState = () => (
    <Alert
      severity="error"
      sx={{ mt: 2 }}
      action={
        <Button size="small" onClick={runAnalysis}>
          Retry
        </Button>
      }
    >
      {analysisError}
    </Alert>
  );

  const NoDocState = () => (
    <Alert severity="info" sx={{ mt: 2 }}>
      Open an incident report document to get AI analysis.
    </Alert>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Side drawer ── */}
      <Drawer
        anchor="right"
        open={open}
        onClose={() => onClose()}
        PaperProps={{
          sx: {
            width: { xs: '100vw', sm: 480 },
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          },
        }}
      >
        {/* Header */}
        <Box
          sx={{
            background: PURPLE,
            color: '#fff',
            px: 2.5,
            py: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <Box>
            <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.2 }}>
              AI Legal Assistant
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.82 }}>
              Powered by Gemini · DocFlow
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {hasDoc && (
              <IconButton
                size="small"
                sx={{ color: '#fff', opacity: 0.85, '&:hover': { opacity: 1 } }}
                onClick={runAnalysis}
                disabled={loading}
                title="Re-analyze"
              >
                <RefreshSvg />
              </IconButton>
            )}
            <IconButton
              size="small"
              sx={{ color: '#fff', opacity: 0.85, '&:hover': { opacity: 1 } }}
              onClick={() => onClose()}
            >
              <CloseSvg />
            </IconButton>
          </Box>
        </Box>

        {/* Tabs */}
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="fullWidth"
          sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
          TabIndicatorProps={{ style: { background: '#667eea' } }}
        >
          {['Summary', 'Lawyers', 'Chat'].map((label, i) => (
            <Tab
              key={label}
              label={label}
              sx={{
                fontSize: 12,
                fontWeight: 600,
                minHeight: 44,
                color: tab === i ? '#667eea' : 'text.secondary',
              }}
            />
          ))}
        </Tabs>

        {/* ════════ TAB 0 — SUMMARY ════════ */}
        <TabPanel value={tab} index={0}>
          {!hasDoc && <NoDocState />}
          {hasDoc && loading && <LoadingState />}
          {hasDoc && !loading && analysisError && <ErrorState />}
          {hasDoc && !loading && analysis && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Incident type badge */}
              {analysis.incident_type && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="overline" color="text.secondary">
                    Incident Type
                  </Typography>
                  <Chip
                    label={analysis.incident_type}
                    size="small"
                    sx={{
                      background: 'linear-gradient(135deg,#667eea,#764ba2)',
                      color: '#fff',
                      fontWeight: 700,
                    }}
                  />
                </Box>
              )}

              {/* Summary text */}
              <Paper
                variant="outlined"
                sx={{ p: 2, borderRadius: 2, borderColor: 'divider', background: '#fafafa' }}
              >
                <Typography variant="caption" color="text.secondary" fontWeight={700} display="block" gutterBottom>
                  DOCUMENT SUMMARY
                </Typography>
                <Typography variant="body2" sx={{ lineHeight: 1.75 }}>
                  {analysis.summary || 'No summary generated.'}
                </Typography>
              </Paper>

              {/* Key details */}
              {analysis.key_details?.length > 0 && (
                <Box>
                  <Typography variant="caption" color="text.secondary" fontWeight={700} display="block" gutterBottom>
                    KEY DETAILS FOUND IN REPORT
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                    {analysis.key_details.map((d, i) => (
                      <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                        <Box
                          sx={{
                            mt: 0.4,
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: '#667eea',
                            flexShrink: 0,
                          }}
                        />
                        <Typography variant="body2">{d}</Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </TabPanel>


        {/* ════════ TAB 1 — LAWYERS ════════ */}
        <TabPanel value={tab} index={1}>
          {!hasDoc && <NoDocState />}
          {hasDoc && loading && <LoadingState />}
          {hasDoc && !loading && analysisError && <ErrorState />}
          {hasDoc && !loading && analysis && (
            <Box>
              <Typography variant="caption" color="text.secondary" fontWeight={700} display="block" gutterBottom>
                RECOMMENDED LEGAL SPECIALISTS
              </Typography>

              {!analysis.lawyers?.length ? (
                <Alert severity="info">No specific lawyer recommendations generated for this report.</Alert>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {analysis.lawyers.map((l, i) => (
                    <Accordion
                      key={i}
                      variant="outlined"
                      disableGutters
                      sx={{
                        borderRadius: '10px !important',
                        '&:before': { display: 'none' },
                        overflow: 'hidden',
                      }}
                    >
                      <AccordionSummary
                        expandIcon={<ExpandSvg />}
                        sx={{ px: 2, py: 1 }}
                      >
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          <Typography variant="body2" fontWeight={700}>
                            {l.specialty}
                          </Typography>
                          <Chip
                            label={l.fee_structure}
                            size="small"
                            variant="outlined"
                            sx={{ width: 'fit-content', fontSize: 11, height: 20 }}
                          />
                        </Box>
                      </AccordionSummary>
                      <AccordionDetails sx={{ pt: 0, px: 2, pb: 2 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.65 }}>
                          {l.description}
                        </Typography>

                        {/* Keywords */}
                        {l.keywords?.length > 0 && (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
                            {l.keywords.map((kw, j) => (
                              <Chip key={j} label={kw} size="small" sx={{ fontSize: 11, height: 20, background: '#f3f4f6' }} />
                            ))}
                          </Box>
                        )}

                        {/* Justia button */}
                        <Button
                          variant="contained"
                          fullWidth
                          size="small"
                          href={l.justia_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={{
                            background: PURPLE,
                            textTransform: 'none',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                          }}
                        >
                          Find {l.specialty} on Justia <LinkSvg />
                        </Button>
                      </AccordionDetails>
                    </Accordion>
                  ))}
                </Box>
              )}

              <Divider sx={{ my: 2 }} />
              <Alert severity="info" sx={{ fontSize: 12 }}>
                <Typography variant="caption">
                  <strong>Justia.com</strong> is a free, trustworthy legal directory. Always consult a licensed
                  attorney before taking legal action. Initial consultations for injury cases are typically free.
                </Typography>
              </Alert>
            </Box>
          )}
        </TabPanel>

        {/* ════════ TAB 2 — CHAT ════════ */}
        <TabPanel value={tab} index={2}>
          {!hasDoc ? (
            <NoDocState />
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {history.length === 0 && (
                <Box sx={{ textAlign: 'center', mt: 4 }}>
                  <Typography variant="body2" color="text.secondary">
                    Ask anything about your incident report.
                  </Typography>
                  <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 0.5 }}>
                    e.g. "What's the strongest part of my report?" or "What should I do next?"
                  </Typography>
                </Box>
              )}

              {history.map((m, i) => (
                <Box
                  key={i}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                    mb: 1,
                  }}
                >
                  <Paper
                    sx={{
                      px: 2,
                      py: 1.25,
                      maxWidth: '82%',
                      borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                      background:
                        m.role === 'user'
                          ? 'linear-gradient(135deg,#667eea,#764ba2)'
                          : '#f3f4f6',
                      color: m.role === 'user' ? '#fff' : 'text.primary',
                      boxShadow: 'none',
                    }}
                  >
                    <Typography variant="body2" sx={{ lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                      {m.content}
                    </Typography>
                  </Paper>

                  {/* ElevenLabs TTS button — assistant messages only */}
                  {m.role === 'assistant' && (
                    <Box
                      component="button"
                      onClick={() => playMessage(m.content, i)}
                      disabled={ttsLoadingIdx === i}
                      sx={{
                        mt: 0.5,
                        ml: 0.5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        background: 'none',
                        border: 'none',
                        cursor: ttsLoadingIdx === i ? 'default' : 'pointer',
                        color: playingIdx === i ? '#764ba2' : 'text.disabled',
                        fontSize: 11,
                        p: 0,
                        '&:hover': { color: '#667eea' },
                      }}
                    >
                      {ttsLoadingIdx === i ? (
                        <CircularProgress size={12} sx={{ color: '#667eea' }} />
                      ) : playingIdx === i ? (
                        <StopSvg />
                      ) : (
                        <SpeakerSvg />
                      )}
                      <span>
                        {ttsLoadingIdx === i ? 'Loading…' : playingIdx === i ? 'Stop' : 'Listen'}
                      </span>
                    </Box>
                  )}
                </Box>
              ))}

              {chatLoading && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-start', mb: 1, gap: 1, alignItems: 'center' }}>
                  <CircularProgress size={16} sx={{ color: '#667eea' }} />
                  <Typography variant="caption" color="text.secondary">
                    Thinking…
                  </Typography>
                </Box>
              )}

              <div ref={chatBottomRef} />
            </Box>
          )}
        </TabPanel>

        {/* ── Chat input bar (only visible on Chat tab) ── */}
        {tab === 2 && hasDoc && (
          <Box
            sx={{
              p: 2,
              borderTop: 1,
              borderColor: 'divider',
              display: 'flex',
              gap: 1,
              flexShrink: 0,
            }}
          >
            <TextField
              fullWidth
              size="small"
              placeholder="Ask about your incident report…"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendChat();
                }
              }}
              disabled={chatLoading}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
            />
            {/* Mic button — hold to record, tap again to stop */}
            <IconButton
              onClick={toggleRecording}
              disabled={isTranscribing || chatLoading}
              title={isRecording ? 'Stop recording' : 'Speak your message'}
              sx={{
                borderRadius: 2,
                flexShrink: 0,
                color: isRecording ? '#ef4444' : 'text.secondary',
                background: isRecording ? 'rgba(239,68,68,0.08)' : undefined,
                animation: isRecording ? 'chatbot-pulse 1s ease-in-out infinite' : 'none',
                '@keyframes chatbot-pulse': {
                  '0%,100%': { boxShadow: '0 0 0 0 rgba(239,68,68,0.4)' },
                  '50%': { boxShadow: '0 0 0 6px rgba(239,68,68,0)' },
                },
              }}
            >
              {isTranscribing ? <CircularProgress size={18} sx={{ color: '#667eea' }} /> : <MicSvg />}
            </IconButton>

            <IconButton
              onClick={sendChat}
              disabled={!chatInput.trim() || chatLoading}
              sx={{
                background: chatInput.trim() ? PURPLE : undefined,
                color: chatInput.trim() ? '#fff' : undefined,
                borderRadius: 2,
                flexShrink: 0,
                '&:hover': { background: chatInput.trim() ? 'linear-gradient(135deg,#764ba2,#667eea)' : undefined },
              }}
            >
              <SendSvg />
            </IconButton>
          </Box>
        )}
      </Drawer>
    </>
  );
}
