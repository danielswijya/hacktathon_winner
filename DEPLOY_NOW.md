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

Then click **Redeploy** in Deployments tab.

---

## ✅ Done!

Your app will be live at: `https://your-project-name.vercel.app`

Test: Upload a PDF and verify it works!
