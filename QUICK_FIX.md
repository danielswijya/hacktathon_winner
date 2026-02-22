# 🚀 QUICK FIX - 2 Minutes

## Your Error
```
Storage upload failed: new row violates row-level security policy
```

## The Fix (Copy-Paste This!)

### 1️⃣ Open Supabase SQL Editor
https://supabase.com/dashboard → SQL Editor → New Query

### 2️⃣ Run This SQL

```sql
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public uploads to documents bucket"
ON storage.objects FOR INSERT TO anon
WITH CHECK (bucket_id = 'documents');

CREATE POLICY "Allow public reads from documents bucket"
ON storage.objects FOR SELECT TO anon
USING (bucket_id = 'documents');

CREATE POLICY "Allow public updates to documents bucket"
ON storage.objects FOR UPDATE TO anon
USING (bucket_id = 'documents')
WITH CHECK (bucket_id = 'documents');

CREATE POLICY "Allow public deletes from documents bucket"
ON storage.objects FOR DELETE TO anon
USING (bucket_id = 'documents');
```

### 3️⃣ Restart Server
```bash
Ctrl+C
npm run dev
```

### 4️⃣ Test Upload
Upload a PDF - should work now! ✅

---

## Still Not Working?

Check if `documents` bucket exists:

```sql
SELECT name FROM storage.buckets WHERE name = 'documents';
```

**No results?** Create bucket:

```sql
INSERT INTO storage.buckets (id, name, public) 
VALUES ('documents', 'documents', false);
```

Then re-run Step 2.

---

## Why This Works

**Before**: No policies → All uploads blocked
**After**: Public policies → Uploads allowed

Full details in: `UPLOAD_FIX_CHECKLIST.md`

---

## ✅ Success = No More Errors!

Server logs should show:
```
✅ PDF uploaded to storage: pdfs/...
✅ Document record created: 123
```

Browser should show PDF in viewer after upload.

That's it! 🎉
