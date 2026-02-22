-- Migration: Add PDF storage columns to parsed_documents table
-- Run this in your Supabase SQL Editor

-- Add pdf_storage_path column (path in Supabase Storage)
ALTER TABLE parsed_documents 
ADD COLUMN IF NOT EXISTS pdf_storage_path TEXT;

-- Add pdf_public_url column (optional, for direct access)
ALTER TABLE parsed_documents 
ADD COLUMN IF NOT EXISTS pdf_public_url TEXT;

-- Add metadata column (stores upload info, file size, etc.)
ALTER TABLE parsed_documents 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Add index on pdf_storage_path for faster lookups
CREATE INDEX IF NOT EXISTS idx_parsed_documents_pdf_storage_path 
ON parsed_documents(pdf_storage_path);

-- Add created_at and updated_at timestamps if not exists
ALTER TABLE parsed_documents 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE parsed_documents 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_parsed_documents_updated_at ON parsed_documents;

CREATE TRIGGER update_parsed_documents_updated_at
    BEFORE UPDATE ON parsed_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Verify the changes
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'parsed_documents'
ORDER BY ordinal_position;
