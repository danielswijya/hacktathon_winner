# 🚨 FIX UPLOAD ERROR - Quick Guide

## Current Error
```
Storage upload failed: new row violates row-level security policy
```

## Root Cause
Your Supabase Storage bucket has RLS (Row-Level Security) enabled, but no policies exist to allow uploads.

---

## ⚡ FASTEST FIX (For Hackathon/Demo)

### Step 1: Open Supabase SQL Editor
1. Go to https://supabase.com/dashboard
2. Select your project
3. Click **SQL Editor** in left sidebar
4. Click **New Query**

### Step 2: Run This SQL
Copy-paste this entire block and click **RUN**:

```sql
-- Enable RLS (if not already enabled)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Allow anyone to upload PDFs (perfect for demos)
CREATE POLICY "Allow public uploads to documents bucket"
ON storage.objects FOR INSERT TO anon
WITH CHECK (bucket_id = 'documents');

-- Allow anyone to read PDFs
CREATE POLICY "Allow public reads from documents bucket"
ON storage.objects FOR SELECT TO anon
USING (bucket_id = 'documents');

-- Allow anyone to update PDFs
CREATE POLICY "Allow public updates to documents bucket"
ON storage.objects FOR UPDATE TO anon
USING (bucket_id = 'documents')
WITH CHECK (bucket_id = 'documents');

-- Allow anyone to delete PDFs
CREATE POLICY "Allow public deletes from documents bucket"
ON storage.objects FOR DELETE TO anon
USING (bucket_id = 'documents');
```

### Step 3: Verify Bucket Exists
Still in SQL Editor, run this:

```sql
-- Check if 'documents' bucket exists
SELECT name, public FROM storage.buckets WHERE name = 'documents';
```

**Expected result**: 1 row with `name = 'documents'`

**If no results**: Run this to create the bucket:

```sql
INSERT INTO storage.buckets (id, name, public) 
VALUES ('documents', 'documents', false);
```

### Step 4: Test Upload
1. Clear browser cache: Open DevTools (F12) → Console → Type:
   ```javascript
   sessionStorage.clear();
   localStorage.clear();
   ```
2. Refresh page (F5)
3. Try uploading a PDF

---

## ✅ Success Indicators

After running the SQL, you should see:
- ✅ No errors in Supabase SQL Editor
- ✅ PDF uploads work without "row-level security" error
- ✅ PDF persists after server restart

---

## 🔍 Still Not Working? Run Diagnostics

### Check Active Policies
```sql
SELECT * 
FROM pg_policies 
WHERE schemaname = 'storage' AND tablename = 'objects';
```

You should see 4 policies:
- Allow public uploads to documents bucket
- Allow public reads from documents bucket
- Allow public updates to documents bucket
- Allow public deletes from documents bucket

### Check RLS Status
```sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'storage' AND tablename = 'objects';
```

Expected: `rowsecurity = true`

### Check Server Logs
Look at your terminal where server is running. You should NOT see:
- ❌ `Storage upload failed`
- ❌ `row-level security policy`

You SHOULD see:
- ✅ `Uploading to Supabase Storage: pdfs/...`
- ✅ `Upload successful!`

---

## 🎯 Why This Works

**Before**: Supabase blocks all uploads (RLS enabled, no policies)
```
Client → Upload PDF → Supabase → ❌ DENIED (no policy)
```

**After**: Supabase allows public uploads (policies created)
```
Client → Upload PDF → Supabase → ✅ ALLOWED (anon policy)
```

---

## 🔒 After Hackathon: Secure It

This setup allows **anyone** to upload/delete files. For production:

1. Add Supabase Auth to your app
2. Replace `anon` policies with `authenticated` policies
3. Add user-specific checks:

```sql
-- Example: Only owners can access their PDFs
CREATE POLICY "Owner access only"
ON storage.objects FOR ALL TO authenticated
USING (auth.uid()::text = (storage.foldername(name))[1]);
```

---

## 📞 Need Help?

**Common Issues:**

1. **"bucket_id 'documents' does not exist"**
   - Run the bucket creation SQL from Step 3

2. **"permission denied for schema storage"**
   - You're not the project owner. Ask owner to run SQL.

3. **Uploads still fail**
   - Check browser DevTools → Network tab → Look for `/storage/v1/object/documents` request
   - Check response for detailed error

4. **Server crashes on upload**
   - Check your `.env` has correct `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`
   - Restart server: `Ctrl+C` then `npm run dev`

---

## 🚀 Next Step After Fix

Once uploads work, test the full flow:

1. ✅ Upload PDF → Should see in list
2. ✅ Click document → PDF viewer shows it
3. ✅ Refresh page (F5) → PDF still visible (sessionStorage)
4. ✅ Restart server → PDF still visible (Supabase Storage)

**All 4 should work!** This proves your 3-tier caching system is working.
