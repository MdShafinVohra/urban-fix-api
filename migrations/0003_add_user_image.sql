-- Migration number: 0003 	 2026-07-15T12:40:33.434Z

-- Add image_url column to store the Cloudflare R2 object key or URL
ALTER TABLE users ADD COLUMN image_url TEXT;