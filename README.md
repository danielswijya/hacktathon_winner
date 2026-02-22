# DocFlow

## What is DocFlow?

**DocFlow** is a legal form assistant built for incident reports and court-related paperwork. It helps users:

1. **Upload PDF forms** (e.g. incident reports) and store them in the cloud (Supabase).
2. **Extract fillable fields automatically** using AI (Google Gemini): the app detects text fields, dates, checkboxes, and their positions on each page so you don’t have to define them by hand.
3. **Fill and edit the form** in a single place: an interactive PDF viewer with overlaid fields and a table view. Changes in the table or on the PDF stay in sync.
4. **Save progress to the database** so field and checkbox values are persisted and can be loaded again later.
5. **Estimate case duration** using an analysis pipeline: Gemini classifies the incident (court department, case type, location from fixed Massachusetts court lists), then a regression model (or fallback) outputs an estimated number of days until resolution. Results are shown in an “Analyze” tab (case type, estimated weeks/months, court department, court location).
6. **Chat with an AI advisor** about the incident; optionally use voice (ElevenLabs) for speech-to-text and text-to-speech.

DocFlow is aimed at anyone who needs to work with legal/incident PDF forms and get quick, structured analysis (court type + duration estimate) without manually re-entering data into separate tools.

---

## Features (summary)

- **PDF upload & storage** — PDFs go to Supabase Storage; document metadata and field data live in a Supabase table (`parsed_documents`).
- **Smart field extraction** — Gemini analyzes page images and returns fields/checkboxes with types and positions; incident-report templates get fast template-based extraction.
- **Interactive PDF viewer** — Resizable viewer; overlay layer scales with the document. Edit values in the right-hand table or directly on the PDF.
- **Save to Supabase** — All field and checkbox values are saved via `PATCH /api/documents/:id`. The table columns must be JSONB (see setup below).
- **Case Duration Estimator** — “Analyze” tab: incident summary → Gemini classification → regression (or fallback) → estimated days, displayed as weeks/months with court department and location.
- **AI Chatbot** — Chat and optional voice (ElevenLabs) for transcribe/speak.

---

## Tech stack

- **Frontend:** React 18, Vite, PDF.js (rendering), Fabric.js (overlay canvas), MUI (tabs, etc.).
- **Backend:** Node.js, Express, Supabase (Storage + Postgres), Google Gemini, pdf-lib (fill PDFs).
- **Analysis:** Optional Python script in `server/analysis/` (e.g. `predict.py`) for court/duration prediction; can use `.joblib` model artifacts or fallback days.

---

## How to set up (detailed)

Follow these steps in order. You need: Node.js (v18+), npm, a Supabase account, and a Google AI (Gemini) API key.

### Step 1: Clone and install dependencies

```bash
# From the repo root (e.g. hacktathon_winner)
cd hacktathon_winner

# Install frontend dependencies
cd client
npm install
cd ..

# Install backend dependencies
cd server
npm install
cd ..
```

You should have no errors. If you do, ensure Node and npm are up to date.

---

### Step 2: Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click **New project**. Choose organization, name the project (e.g. `docflow`), set a database password, and pick a region. Create the project and wait until it’s ready.
3. In the left sidebar, open **Project Settings** (gear) → **API**. You will need:
   - **Project URL** (e.g. `https://xxxx.supabase.co`) → this is `SUPABASE_URL`.
   - **Project API keys** → use the **service_role** key (secret). This is `SUPABASE_SERVICE_ROLE_KEY`. Do not expose it in the frontend.

---

### Step 3: Create the Storage bucket

1. In Supabase, go to **Storage** in the left sidebar.
2. Click **New bucket**.
3. Name it exactly: `documents`.
4. Choose public or private as you prefer (the server uses the service role to access it). Create the bucket.
5. If you use RLS on Storage, add policies so the server (using the service role key) can read/write. See `SUPABASE_RLS_FIX.sql` in the repo for examples.

---

### Step 4: Create the database table and columns

1. Go to **SQL Editor** in the Supabase dashboard.
2. Create the `parsed_documents` table if it doesn’t exist. At minimum you need something like:

```sql
-- Example minimal table (adjust if you already have a schema)
CREATE TABLE IF NOT EXISTS parsed_documents (
  id BIGSERIAL PRIMARY KEY,
  filename TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns if missing
ALTER TABLE parsed_documents ADD COLUMN IF NOT EXISTS fields JSONB DEFAULT '[]'::jsonb;
ALTER TABLE parsed_documents ADD COLUMN IF NOT EXISTS checkboxes JSONB DEFAULT '[]'::jsonb;
ALTER TABLE parsed_documents ADD COLUMN IF NOT EXISTS pdf_storage_path TEXT;
```

3. **Critical for saving all fields:** If your table already had `fields` or `checkboxes` as `TEXT`/`VARCHAR`, large JSON will be truncated and only a few fields (e.g. date/time of incident) will save. Run the migration that converts them to JSONB:

   - Open the file **`database_ensure_jsonb_columns.sql`** in this repo.
   - Copy its entire contents into the Supabase SQL Editor and run it. It ensures `fields` and `checkboxes` are JSONB and converts existing data if needed.

4. (Optional) Run **`database_migration.sql`** if you use it for `pdf_storage_path`, `created_at`, `updated_at`, etc.

---

### Step 5: Get a Gemini API key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Sign in with a Google account, then create an API key.
3. Copy the key. You will put it in the server `.env` as `GEMINI_API_KEY`.

---

### Step 6: Configure the server environment

1. In the repo, go to the server folder and copy the example env file:

```bash
cd server
cp .env.example .env
```

2. Open `.env` in an editor and set every value (no quotes needed around values):

| Variable | Where to get it | Example |
|----------|------------------|---------|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL | `https://abcdefgh.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → service_role key | `eyJhbGc...` (long string) |
| `GEMINI_API_KEY` | Google AI Studio (step 5) | `AIza...` |
| `PORT` | Your choice for local backend | `3001` |
| `ELEVENLABS_API_KEY` | Optional. [ElevenLabs](https://elevenlabs.io) → Profile → API key | (optional) |
| `ELEVENLABS_VOICE_ID` | Optional. Override default voice | (optional) |

3. Save `.env`. Ensure there are no spaces around `=` and no trailing spaces. The server must be able to read `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `GEMINI_API_KEY` or upload/analyze will fail.

---

### Step 7: Point the frontend at your backend (local)

The client sends API requests to a base URL. For **local development** it should talk to your local server.

1. Open **`client/src/App.jsx`** and find the line that sets `API_URL` (e.g. `const API_URL = 'https://...'`). Change it to your local backend, for example:

```js
const API_URL = '';  // same origin; use Vite proxy
```

or:

```js
const API_URL = 'http://localhost:3001';
```

2. Do the same in **`client/src/components/FieldsTable.jsx`** and **`client/src/components/Chatbot.jsx`** if they define their own `API_URL` (so the Analyze tab and chatbot use the same backend).

3. If you use `API_URL = ''`, ensure the Vite proxy is set up so `/api` goes to the backend. In **`client/vite.config.js`** you should have something like:

```js
server: {
  proxy: {
    '/api': { target: 'http://localhost:3001', changeOrigin: true },
  },
},
```

Then the frontend can call `/api/...` and Vite will forward to the Node server.

---

### Step 8: Run the backend

From the repo root:

```bash
cd server
npm run dev
```

(or `npm start` for plain `node index.js`). You should see a message like “DocFlow server running on http://localhost:3001”. Leave this terminal open.

---

### Step 9: Run the frontend

Open a **second** terminal:

```bash
cd client
npm run dev
```

Vite will print the dev server URL (e.g. http://localhost:5173). Open that URL in your browser.

---

### Step 10: Verify setup

1. **Upload:** Use the UI to upload a PDF. Check Supabase → Storage → `documents` bucket for a new file, and Table Editor → `parsed_documents` for a new row.
2. **Save:** Fill some fields and click Save. Reload the page and reselect the document; all fields should still be there (if `fields`/`checkboxes` are JSONB).
3. **Analyze:** Open the Analyze tab and run analysis. You should get case type, estimated duration, court department, and court location (and no “not valid JSON” error if the response is JSON).
4. **Chatbot (optional):** If you set `ELEVENLABS_API_KEY`, the chat and voice features should work.

---

## Scripts reference

| Location | Command | Description |
|----------|---------|-------------|
| `client/` | `npm run dev` | Start Vite dev server |
| `client/` | `npm run build` | Production build (e.g. for deploy) |
| `server/` | `npm run dev` | Start server with nodemon (restarts on file change) |
| `server/` | `npm start` | Start server with `node index.js` |

---

## API overview

| Method & path | Description |
|---------------|-------------|
| `POST /api/upload` | Upload PDF; creates Storage object + `parsed_documents` row |
| `GET /api/documents` | List all documents (from `parsed_documents`) |
| `GET /api/documents/:id` | Get one document (metadata, fields, checkboxes) |
| `GET /api/documents/:id/pdf` | Get PDF file bytes from Storage |
| `PATCH /api/documents/:id` | Save `fields` and `checkboxes` (body: `{ fields, checkboxes }`) |
| `DELETE /api/documents/:id` | Delete document record (and optionally Storage file) |
| `POST /api/extract-page` | Send page image; Gemini returns fields/checkboxes for that page |
| `POST /api/analyze` | Body: `{ fields, checkboxes }` → Gemini + regression → court/duration |
| `POST /api/documents/:id/analyze` | Same as above using stored document data in DB |
| `POST /api/fill-pdf` | Fill a PDF with field values (multipart: pdf + fields + checkboxes) |
| `POST /api/chatbot/chat` | Chat message |
| `POST /api/chatbot/analyze` | Analyze for chatbot context |
| `POST /api/chatbot/transcribe` | Speech-to-text (ElevenLabs) |
| `POST /api/chatbot/speak` | Text-to-speech (ElevenLabs) |

---

## Deploying

- **Backend:** Deploy the `server` folder to a Node host (e.g. Render, Railway). Set all required env vars (`SUPABASE_*`, `GEMINI_API_KEY`, `PORT`). The host will set `PORT` in production.
- **Frontend:** Run `npm run build` in `client/`, then host the `client/dist` output. Set the client’s `API_URL` (or build-time `VITE_API_URL`) to your deployed backend URL so the Analyze tab and other API calls hit the right server.
- **Database:** Ensure `parsed_documents` exists and `fields`/`checkboxes` are JSONB (run `database_ensure_jsonb_columns.sql` on the production DB if needed).

---

## Analysis pipeline (summary)

For more detail on the regression model and Gemini flow, see **`server/analysis/README.md`**. In short:

1. Document data (from request body or from `parsed_documents`) is turned into an incident summary.
2. Gemini classifies into fixed lists: court department, case type, court location (Massachusetts courts).
3. The server calls `server/analysis/predict.py` with those three; the script outputs `predicted_days` (or fallback is used if the script or model fails).
4. The API returns court department, case type, court location, estimated days, and optional reasoning.
