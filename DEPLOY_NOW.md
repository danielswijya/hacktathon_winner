# 🚀 Deploy to Vercel - 3 Steps

## Step 1: Push to GitHub

```powershell
git add .
git commit -m "Ready for Vercel deployment"
git push origin main
```

## Step 2: Import to Vercel

1. Go to **https://vercel.com/new**
2. Sign in with GitHub
3. Click **Import** next to your repo
4. Keep all defaults and click **Deploy**

## Step 3: Add Environment Variables

**After first deploy**, go to:
- Vercel Dashboard → Your Project → **Settings** → **Environment Variables**

Add these (copy-paste):

```
SUPABASE_URL
https://yipobgbwuxafchqabmhr.supabase.co

SUPABASE_SERVICE_ROLE_KEY
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpcG9iZ2J3dXhhZmNocWFibWhyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTYxNDUyMywiZXhwIjoyMDg3MTkwNTIzfQ.IpgqXDO3_eCtUmQix3465jkb_PeSXyVEgyiwhviOm_g

GEMINI_API_KEY
AIzaSyCn8towdSn38izK319WgoH_itJ_Kg5PsCg

ELEVENLABS_API_KEY
de89885432ae1714e42ac101e94a7c4591cf32751420823a51e7a26e3a77205d

ELEVENLABS_VOICE_ID
hpp4J3VqNfWAUOO0d1Us
```

Then click **Redeploy** in Deployments tab.

---

## ✅ Done!

Your app will be live at: `https://your-project-name.vercel.app`

Test: Upload a PDF and verify it works!
