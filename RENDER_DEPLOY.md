# 🚀 Deploy to Render - 5 Minutes

## Step 1: Deploy Backend (Server)

1. Go to **https://render.com/dashboard**
2. Click **New +** → **Web Service**
3. Connect your GitHub repo: `hacktathon_winner`
4. Configure:
   ```
   Name: docflow-api
   Region: Oregon (US West)
   Branch: main
   Root Directory: server
   Runtime: Node
   Build Command: npm install
   Start Command: node index.js
   Instance Type: Free
   ```

5. **Add Environment Variables**:
   ```
   SUPABASE_URL = https://yipobgbwuxafchqabmhr.supabase.co
   SUPABASE_SERVICE_ROLE_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpcG9iZ2J3dXhhZmNocWFibWhyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTYxNDUyMywiZXhwIjoyMDg3MTkwNTIzfQ.IpgqXDO3_eCtUmQix3465jkb_PeSXyVEgyiwhviOm_g
   GEMINI_API_KEY = AIzaSyCn8towdSn38izK319WgoH_itJ_Kg5PsCg
   ELEVENLABS_API_KEY = de89885432ae1714e42ac101e94a7c4591cf32751420823a51e7a26e3a77205d
   ELEVENLABS_VOICE_ID = hpp4J3VqNfWAUOO0d1Us
   ```

6. Click **Create Web Service**
7. Wait ~3 minutes for deployment
8. **Copy your backend URL**: `https://docflow-api.onrender.com`

---

## Step 2: Deploy Frontend (Client)

1. Click **New +** → **Static Site**
2. Connect same repo: `hacktathon_winner`
3. Configure:
   ```
   Name: docflow-app
   Branch: main
   Root Directory: client
   Build Command: npm install && npm run build
   Publish Directory: dist
   ```

4. **Add Environment Variable**:
   ```
   VITE_API_URL = https://docflow-api.onrender.com
   ```

5. Click **Create Static Site**
6. Wait ~2 minutes

---

## Step 3: Update Client to Use Render API

The client needs to know about your backend URL. Since you already use relative URLs (`/api/...`), we need to add a proxy or update the fetch calls.

**Option A: Add VITE_API_URL to client code** (Quick)

Update `client/src/App.jsx` - add at the top:
```javascript
const API_URL = import.meta.env.VITE_API_URL || '';
```

Then update all fetch calls:
```javascript
// Before: fetch('/api/documents')
// After:  fetch(`${API_URL}/api/documents`)
```

**Option B: Configure CORS on server** (Already done! ✅)

Your server already has `app.use(cors())` so cross-origin requests work!

Just update the frontend to use absolute URLs:
- In Render Static Site settings, add:
  ```
  VITE_API_URL = https://docflow-api.onrender.com
  ```

---

## ✅ Done!

Your app is live at:
- **Frontend**: `https://docflow-app.onrender.com`
- **Backend**: `https://docflow-api.onrender.com`

Test: Upload a PDF and verify it works!

---

## 🔧 Troubleshooting

**Backend won't start?**
- Check Logs in Render dashboard
- Verify all environment variables are set
- Make sure `server/package.json` has correct `start` script

**Frontend can't reach backend?**
- Check CORS is enabled (it is!)
- Verify VITE_API_URL is set correctly
- Check browser console for errors

**PDF upload fails?**
- Check Supabase Storage bucket exists: `documents`
- Verify `SUPABASE_SERVICE_ROLE_KEY` is correct
- Check backend logs in Render

---

## 💡 Quick Fix If Needed

If frontend can't find backend, just hardcode it temporarily in `client/src/App.jsx`:

```javascript
const API_URL = 'https://docflow-api.onrender.com';

// Then use:
fetch(`${API_URL}/api/documents`)
```

This will work immediately while you figure out env vars!
