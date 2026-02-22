-- ============================================================================
-- SUPABASE STORAGE RLS POLICY FIX
-- ============================================================================
-- Fix: "new row violates row-level security policy" error
-- 
-- Run this SQL in your Supabase SQL Editor to allow uploads to the 'documents' bucket
-- Dashboard: https://supabase.com/dashboard → SQL Editor → New Query
-- ============================================================================

-- Option 1: DISABLE RLS (Quick fix for development/testing)
-- ============================================================================
-- Uncomment the line below to completely disable RLS on the storage.objects table
-- WARNING: This allows anyone to upload/read files. Only use in development!

-- ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;


-- Option 2: CREATE STORAGE POLICIES (Production-ready)
-- ============================================================================
-- These policies allow authenticated users to upload/read files in the 'documents' bucket
-- More secure than disabling RLS entirely

-- 1. Allow authenticated users to upload files to 'documents' bucket
CREATE POLICY "Allow authenticated uploads to documents bucket"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents'
);

-- 2. Allow authenticated users to read files from 'documents' bucket
CREATE POLICY "Allow authenticated reads from documents bucket"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents'
);

-- 3. Allow authenticated users to update their own files
CREATE POLICY "Allow authenticated updates to documents bucket"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'documents'
)
WITH CHECK (
  bucket_id = 'documents'
);

-- 4. Allow authenticated users to delete files
CREATE POLICY "Allow authenticated deletes from documents bucket"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'documents'
);


-- Option 3: ALLOW PUBLIC ACCESS (For demo/prototype apps)
-- ============================================================================
-- Uncomment these if you want to allow anonymous (public) uploads/reads
-- WARNING: Anyone can upload files to your bucket! Only use for demos.

-- CREATE POLICY "Allow public uploads to documents bucket"
-- ON storage.objects
-- FOR INSERT
-- TO public
-- WITH CHECK (
--   bucket_id = 'documents'
-- );

-- CREATE POLICY "Allow public reads from documents bucket"
-- ON storage.objects
-- FOR SELECT
-- TO public
-- USING (
--   bucket_id = 'documents'
-- );


-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these to verify your policies are working:

-- 1. Check if RLS is enabled on storage.objects
SELECT relname, relrowsecurity 
FROM pg_class 
WHERE relname = 'objects' AND relnamespace = 'storage'::regnamespace;
-- relrowsecurity = true means RLS is enabled

-- 2. List all policies on storage.objects
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;

-- 3. Check bucket configuration
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE name = 'documents';


-- ============================================================================
-- TROUBLESHOOTING
-- ============================================================================
-- If you still get errors after applying policies:

-- 1. Make sure the 'documents' bucket exists:
--    Dashboard → Storage → Create bucket 'documents'

-- 2. Verify you're authenticated in your app:
--    Check if you're using anon key or service_role key in .env

-- 3. Check Supabase logs:
--    Dashboard → Logs → Filter by "storage"

-- 4. Test bucket access manually:
--    Dashboard → Storage → documents bucket → Upload a file manually
