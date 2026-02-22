-- Migration: Ensure parsed_documents.fields and checkboxes are JSONB
-- Run this in Supabase SQL Editor if table saves only part of the form (e.g. only a few fields).
-- Cause: If these columns were created as TEXT/VARCHAR, large JSON gets truncated on update.

-- 1. Ensure fields is JSONB (convert only if currently not jsonb)
DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'parsed_documents' AND column_name = 'fields';

  IF col_type IS NULL THEN
    ALTER TABLE parsed_documents ADD COLUMN IF NOT EXISTS fields JSONB DEFAULT '[]'::jsonb;
  ELSIF col_type <> 'jsonb' THEN
    ALTER TABLE parsed_documents
    ALTER COLUMN fields TYPE JSONB
    USING (
      CASE
        WHEN fields IS NULL THEN '[]'::jsonb
        WHEN trim(fields::text) = '' THEN '[]'::jsonb
        ELSE fields::jsonb
      END
    );
  END IF;
END $$;

-- 2. Ensure checkboxes is JSONB
DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'parsed_documents' AND column_name = 'checkboxes';

  IF col_type IS NULL THEN
    ALTER TABLE parsed_documents ADD COLUMN IF NOT EXISTS checkboxes JSONB DEFAULT '[]'::jsonb;
  ELSIF col_type <> 'jsonb' THEN
    ALTER TABLE parsed_documents
    ALTER COLUMN checkboxes TYPE JSONB
    USING (
      CASE
        WHEN checkboxes IS NULL THEN '[]'::jsonb
        WHEN trim(checkboxes::text) = '' THEN '[]'::jsonb
        ELSE checkboxes::jsonb
      END
    );
  END IF;
END $$;

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'parsed_documents'
  AND column_name IN ('fields', 'checkboxes');
