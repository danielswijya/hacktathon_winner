# ✅ Upload Fix Checklist - Follow in Order

**Current Status**: ❌ PDF uploads fail with "row-level security policy" error

Follow these steps **in exact order** to fix your upload issue:

---

## 📋 Step-by-Step Fix

### ✅ Step 1: Verify Environment Variables

**Location**: `server/.env`

Make sure these are set correctly:

```bash
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
GEMINI_API_KEY=your_gemini_key_here
PORT=3001
```

**How to find your keys**:
1. Go to https://supabase.com/dashboard
2. Select your project
3. Click **Settings** (gear icon) → **API**
4. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **Project API keys** → `anon` `public` → `SUPABASE_ANON_KEY`

**✅ DONE** when: Your `.env` file has all 4 variables filled

---

### ✅ Step 2: Check Storage Bucket Exists

**Location**: Supabase Dashboard → Storage

1. Go to https://supabase.com/dashboard
2. Click **Storage** in left sidebar
3. Look for bucket named **`documents`**

**If bucket exists**: ✅ Skip to Step 3

**If bucket does NOT exist**:

1. Click **New bucket**
2. Fill in:
   ```
   Name: documents
   Public: ❌ (unchecked)
   File size limit: 50 MB
   Allowed MIME types: application/pdf
   ```
3. Click **Create bucket**

**✅ DONE** when: You see `documents` bucket in the list

---

### ✅ Step 3: Fix RLS Policies (THIS IS THE FIX!)

**Location**: Supabase Dashboard → SQL Editor

1. Go to https://supabase.com/dashboard
2. Click **SQL Editor** in left sidebar
3. Click **New Query**
4. **Copy-paste this ENTIRE block**:

```sql
-- Enable RLS on storage.objects table
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Allow anonymous users to upload PDFs
CREATE POLICY "Allow public uploads to documents bucket"
ON storage.objects FOR INSERT TO anon
WITH CHECK (bucket_id = 'documents');

-- Allow anonymous users to read PDFs
CREATE POLICY "Allow public reads from documents bucket"
ON storage.objects FOR SELECT TO anon
USING (bucket_id = 'documents');

-- Allow anonymous users to update PDFs
CREATE POLICY "Allow public updates to documents bucket"
ON storage.objects FOR UPDATE TO anon
USING (bucket_id = 'documents')
WITH CHECK (bucket_id = 'documents');

-- Allow anonymous users to delete PDFs
CREATE POLICY "Allow public deletes from documents bucket"
ON storage.objects FOR DELETE TO anon
USING (bucket_id = 'documents');
```

5. Click **RUN** (bottom right)
6. Wait for "Success" message

**✅ DONE** when: You see "Success. No rows returned" (this is expected!)

---

### ✅ Step 4: Verify Policies Are Active

**Location**: Same SQL Editor

Run this verification query:

```sql
SELECT policyname, cmd, roles
FROM pg_policies 
WHERE schemaname = 'storage' AND tablename = 'objects'
AND policyname LIKE '%documents%';
```

**Expected Output**: You should see **4 rows**:

| policyname | cmd | roles |
|------------|-----|-------|
| Allow public uploads to documents bucket | INSERT | {anon} |
| Allow public reads from documents bucket | SELECT | {anon} |
| Allow public updates to documents bucket | UPDATE | {anon} |
| Allow public deletes from documents bucket | DELETE | {anon} |

**✅ DONE** when: You see all 4 policies listed

---

### ✅ Step 5: Clear Browser Cache

**Location**: Browser DevTools

1. Open your app in browser
2. Press **F12** to open DevTools
3. Go to **Console** tab
4. Type this and press Enter:
   ```javascript
   sessionStorage.clear();
   localStorage.clear();
   console.log('✅ Cache cleared');
   ```
5. Close DevTools (F12)

**✅ DONE** when: Console shows "✅ Cache cleared"

---

### ✅ Step 6: Restart Server

**Location**: Terminal where server is running

1. Press **Ctrl+C** to stop server
2. Wait for "Server stopped" message
3. Run: `npm run dev`
4. Wait for "Server running on port 3001"

**✅ DONE** when: You see:
```
Server running on port 3001
Database connected successfully
```

---

### ✅ Step 7: Test Upload

**Location**: Your browser at http://localhost:5173

1. Refresh page (F5)
2. Click **Upload PDF** button
3. Select your test PDF (e.g., incident report)
4. Click **Open**

**Watch your server terminal** for these messages:
```
📤 Uploading PDF to Supabase Storage: pdfs/1234567890123-incident-report.pdf
✅ PDF uploaded to storage: pdfs/1234567890123-incident-report.pdf
✅ Document record created: 123
```

**✅ SUCCESS** when:
- ✅ No "row-level security" error
- ✅ PDF appears in document list
- ✅ Clicking document shows PDF in viewer

---

## 🎯 Final Verification

After upload succeeds, test persistence:

### Test 1: Page Refresh
1. Refresh page (F5)
2. Click on your uploaded document
3. **Expected**: PDF loads from sessionStorage (~50ms)

### Test 2: Server Restart
1. Stop server (Ctrl+C)
2. Start server (`npm run dev`)
3. Refresh browser (F5)
4. Click on your document
5. **Expected**: PDF loads from Supabase Storage (~300ms)

**✅ ALL TESTS PASS** = Your 3-tier caching system works! 🎉

---

## 🚨 Troubleshooting

### ❌ Still getting "row-level security" error?

**Check 1**: Verify policies exist
```sql
SELECT COUNT(*) 
FROM pg_policies 
WHERE schemaname = 'storage' AND tablename = 'objects'
AND policyname LIKE '%documents%';
```
Expected: **4** (not 0)

**Check 2**: Verify RLS is enabled
```sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'storage' AND tablename = 'objects';
```
Expected: `rowsecurity = true`

**Check 3**: Check bucket name matches
```sql
SELECT name FROM storage.buckets;
```
Expected: You should see `documents` in the list

**If all checks pass but still fails**: 
- The bucket might be using a different name
- Check your server logs for the exact error
- Run: `DROP POLICY IF EXISTS "Allow public uploads to documents bucket" ON storage.objects;`
- Then re-run Step 3

---

### ❌ "Bucket 'documents' not found"?

Run this in SQL Editor:
```sql
INSERT INTO storage.buckets (id, name, public) 
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;
```

---

### ❌ Upload succeeds but PDF doesn't show?

**Check browser console** (F12 → Console):
- Look for errors fetching `/api/documents/:id/pdf`
- Check Network tab for failed requests

**Check server logs**:
- Should see `📥 Fetching PDF from Supabase Storage: pdfs/...`
- Should NOT see errors

---

## 📊 What Each Step Does

| Step | Purpose | What It Fixes |
|------|---------|---------------|
| 1 | Environment | Missing credentials |
| 2 | Bucket | "Bucket not found" error |
| 3 | **RLS Policies** | **"row-level security" error** ← YOUR ISSUE |
| 4 | Verify | Confirms policies are active |
| 5 | Cache | Clears old state |
| 6 | Server | Loads new env vars |
| 7 | Test | Confirms fix works |

**Step 3 is the critical fix for your error!**

---

## 🎉 Success Indicators

You'll know everything works when:

1. ✅ Upload shows no errors
2. ✅ Server logs show "✅ PDF uploaded to storage"
3. ✅ Document appears in list
4. ✅ Clicking document shows PDF
5. ✅ Page refresh keeps PDF visible
6. ✅ Server restart keeps PDF visible

**All 6 = Perfect!** You're ready to demo! 🚀

---

## 🔒 Security Note

This setup allows **anyone** to upload/delete PDFs (perfect for hackathon demos).

For production, replace `anon` with `authenticated` in the policies and add Supabase Auth.

See `PRODUCTION_IMPLEMENTATION.md` for details.
