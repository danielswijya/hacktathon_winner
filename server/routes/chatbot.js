// routes/chatbot.js — AI Legal Assistant endpoints
// Separate from the main server routes; mounted at /api/chatbot
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Local multer instance for audio uploads only
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// ── Build a readable document context from fields/checkboxes ────────────────
function buildContext(fields = [], checkboxes = []) {
  const filled = fields
    .filter((f) => f.value && String(f.value).trim())
    .map((f) => `${f.label}: ${f.value}`);

  const empty = fields
    .filter((f) => !f.value || !String(f.value).trim())
    .map((f) => f.label);

  const checked = checkboxes
    .filter((c) => c.value && c.value !== '' && c.value !== null)
    .map((c) => `${c.label}: ${c.value}`);

  return { filled, empty, checked };
}

// ── POST /api/chatbot/analyze ────────────────────────────────────────────────
// Returns: summary, incident_type, key_details, missing_info, lawyers
router.post('/analyze', async (req, res) => {
  const { fields = [], checkboxes = [] } = req.body;
  const { filled, empty, checked } = buildContext(fields, checkboxes);

  const prompt = `You are a legal document assistant analyzing an incident report form.

FILLED FIELDS:
${filled.length ? filled.join('\n') : 'None filled in yet'}

CHECKBOX SELECTIONS:
${checked.length ? checked.join('\n') : 'None selected'}

UNFILLED / EMPTY FIELDS:
${empty.length ? empty.join(', ') : 'All fields are filled'}

Respond ONLY with valid JSON (no markdown fences, no extra text) in exactly this shape:
{
  "summary": "3-5 sentence plain-English summary: what happened, who was involved, when, where, and what injuries/damages are described.",
  "incident_type": "Short label e.g. 'Slip and Fall', 'Auto Accident', 'Workplace Injury', 'Assault', 'Property Damage', 'Medical Incident', etc.",
  "key_details": [
    "One confirmed fact from the report (max 6 items)"
  ],
  "missing_info": [
    {
      "field": "Name of the missing or incomplete field",
      "suggestion": "Specific, actionable suggestion explaining what to add and why it strengthens the legal record"
    }
  ],
  "lawyers": [
    {
      "specialty": "Exact lawyer specialty title",
      "description": "2-3 sentences on how this specialty directly applies to THIS incident and what they can do for the claimant.",
      "fee_structure": "One of: Contingency Fee (no win no fee) | Hourly Rate | Free Consultation Available | Flat Fee",
      "keywords": ["primary search keyword", "secondary keyword"],
      "justia_url": "https://lawyers.justia.com/search?query=ENCODED_SPECIALTY&location=massachusetts"
    }
  ]
}

Rules:
- missing_info: only list fields that are genuinely empty AND legally significant. If the report is well-filled, return [].
- lawyers: return 3-4 specialists most relevant to the incident type. Always include Justia URLs using real Justia search format.
- For Justia URLs encode spaces as + (e.g. personal+injury, slip+and+fall, workers+compensation).
- fee_structure for injury/tort cases is almost always "Contingency Fee (no win no fee)".
- Return ONLY the JSON object. No explanatory text outside the JSON.`;

  try {
    const result = await model.generateContent([{ text: prompt }]);
    let raw = result.response.text().trim();
    // Strip accidental markdown fences
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    const analysis = JSON.parse(raw);
    res.json(analysis);
  } catch (err) {
    console.error('❌ Chatbot /analyze error:', err.message);
    res.status(500).json({ error: 'Analysis failed', details: err.message });
  }
});

// ── POST /api/chatbot/chat ───────────────────────────────────────────────────
// Conversational follow-up. Body: { message, fields, checkboxes, history[] }
router.post('/chat', async (req, res) => {
  const { message, fields = [], checkboxes = [], history = [] } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const { filled, empty, checked } = buildContext(fields, checkboxes);

  const systemSeed = `You are a compassionate AI legal documentation assistant embedded in DocFlow.
Your role is to help the user recall and articulate their own account of the incident — like a calm, patient interviewer helping someone tell their story clearly and completely.

CURRENT INCIDENT REPORT DATA:
FILLED FIELDS:
${filled.length ? filled.join('\n') : 'None filled yet'}

CHECKBOXES:
${checked.length ? checked.join('\n') : 'None selected'}

EMPTY / MISSING FIELDS:
${empty.length ? empty.join(', ') : 'All fields are filled'}

YOUR APPROACH:
- Act like a gentle interviewer. Ask open-ended questions that help the user remember and describe what actually happened ("Can you walk me through what you noticed first?", "What did you see/hear/feel at that moment?").
- Help them improve the clarity and completeness of their OWN story — better wording, more specific sequence of events, sensory details they experienced.
- If a field is empty, prompt them with a neutral question to help them recall that detail from memory (e.g. "Do you remember roughly what time it was?").
- You may suggest structure (e.g. "It might help to describe the before, during, and after") but never suggest WHAT the facts should be.

STRICT RULES — NEVER VIOLATE:
1. NEVER suggest, invent, or imply specific facts the user has not already stated (no "maybe it was wet", "perhaps the light was broken", "did someone push you?").
2. NEVER add context, details, or interpretations that could alter the evidence or influence what the user reports.
3. NEVER coach the user toward a particular legal narrative or outcome.
4. If the user asks you to "fill in" missing details or make up facts, politely refuse and explain that only what they actually remember can go in the report.
5. If asked about lawyers, refer them to Justia (https://lawyers.justia.com).
6. Always end with a brief reminder that you are an AI assistant and they should consult a licensed attorney for legal advice.`;

  try {
    const chat = model.startChat({
      history: [
        {
          role: 'user',
          parts: [{ text: systemSeed }],
        },
        {
          role: 'model',
          parts: [{ text: "Understood. I've reviewed your incident report. I'm here to help you tell your story as clearly and completely as possible — only what you actually remember. Take your time, and feel free to start wherever feels natural." }],
        },
        ...history.map((m) => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }],
        })),
      ],
    });

    const result = await chat.sendMessage(message.trim());
    res.json({ response: result.response.text() });
  } catch (err) {
    console.error('❌ Chatbot /chat error:', err.message);
    res.status(500).json({ error: 'Chat failed', details: err.message });
  }
});

// ── POST /api/chatbot/transcribe — ElevenLabs speech-to-text ────────────────
router.post('/transcribe', audioUpload.single('audio'), async (req, res) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'ElevenLabs API key not configured' });
  if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

  try {
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }),
      'recording.webm'
    );
    formData.append('model_id', 'scribe_v1');

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs STT ${response.status}: ${errText}`);
    }

    const data = await response.json();
    res.json({ text: data.text || '' });
  } catch (err) {
    console.error('❌ Chatbot /transcribe error:', err.message);
    res.status(500).json({ error: 'Transcription failed', details: err.message });
  }
});

// ── POST /api/chatbot/speak — ElevenLabs text-to-speech ─────────────────────
router.post('/speak', async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'ElevenLabs API key not configured' });
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs ${response.status}: ${errText}`);
    }

    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('❌ Chatbot /speak error:', err.message);
    res.status(500).json({ error: 'TTS failed', details: err.message });
  }
});

module.exports = router;
