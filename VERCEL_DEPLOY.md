# Vercel Deployment Guide - DocFlow

## 🚀 Quick Deploy to Vercel

### Step 1: Push to GitHub

```powershell
cd c:\Users\danie\Desktop\hackathon-audi\hacktathon_winner
git add .
git commit -m "Add Vercel configuration"
git push origin main
```

### Step 2: Import to Vercel

1. Go to https://vercel.com/new
2. Click **Import Git Repository**
3. Select your GitHub repository: `hacktathon_winner`
4. Click **Import**

### Step 3: Configure Project

**Framework Preset**: `Other`

**Root Directory**: `.` (leave empty)

**Build Settings**:
- Build Command: `cd client && npm install && npm run build`
- Output Directory: `client/dist`
- Install Command: `npm install`

### Step 4: Add Environment Variables

Click **Environment Variables** and add these:

```
SUPABASE_URL = https://yipobgbwuxafchqabmhr.supabase.co
SUPABASE_SERVICE_ROLE_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpcG9iZ2J3dXhhZmNocWFibWhyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTYxNDUyMywiZXhwIjoyMDg3MTkwNTIzfQ.IpgqXDO3_eCtUmQix3465jkb_PeSXyVEgyiwhviOm_g
GEMINI_API_KEY = AIzaSyCn8towdSn38izK319WgoH_itJ_Kg5PsCg
ELEVENLABS_API_KEY = de89885432ae1714e42ac101e94a7c4591cf32751420823a51e7a26e3a77205d
ELEVENLABS_VOICE_ID = hpp4J3VqNfWAUOO0d1Us
```

**Important**: Check "Production", "Preview", and "Development" for all variables.

### Step 5: Deploy

Click **Deploy** and wait ~2 minutes.

---

## ✅ Post-Deployment

### Test Your Deployment

1. Visit your Vercel URL: `https://your-app.vercel.app`
2. Upload a PDF
3. Check server logs in Vercel Dashboard → Deployments → [Latest] → Functions

### Update Client API URL (Optional)

If you need to point to a different backend later, update `client/src/App.jsx`:

```javascript
const API_URL = import.meta.env.PROD 
  ? 'https://your-backend.vercel.app'
  : 'http://localhost:3001';
```

---

## 🔧 Troubleshooting

### Build Fails

Check Vercel build logs. Common issues:
- Missing dependencies: Run `npm install` in both `client/` and `server/`
- Python errors: Vercel serverless functions support Python, but make sure `requirements.txt` is in `server/analysis/`

### API Routes Don't Work

1. Check `vercel.json` routes configuration
2. Verify environment variables are set
3. Check Function logs in Vercel Dashboard

### PDF Upload Fails

1. Check Supabase Storage bucket exists: `documents`
2. Verify `SUPABASE_SERVICE_ROLE_KEY` is set correctly
3. Check Function logs for detailed error

---

## 📊 Expected Results

After deployment:
- ✅ Frontend loads at your Vercel URL
- ✅ Upload PDF works (stored in Supabase)
- ✅ PDF viewer shows uploaded PDFs
- ✅ Field extraction works
- ✅ Chatbot works (if Python dependencies install correctly)

---

## 🎯 Quick Commands

**Redeploy**:
```powershell
git add .
git commit -m "Update"
git push
```
Vercel auto-deploys on push!

**View Logs**:
Vercel Dashboard → Deployments → [Latest] → Functions → Click any function

**Environment Variables**:
Vercel Dashboard → Settings → Environment Variables
