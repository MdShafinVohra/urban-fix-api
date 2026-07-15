-- Migration number: 0004 	 2026-07-15T14:08:19.021Z

-- Add image_url to categories
ALTER TABLE categories ADD COLUMN image_url TEXT;

-- Add image_url to sub_categories
ALTER TABLE sub_categories ADD COLUMN image_url TEXT;

-- Add image_url to cities
ALTER TABLE cities ADD COLUMN image_url TEXT;

-- Add image_url to services
ALTER TABLE services ADD COLUMN image_url TEXT;