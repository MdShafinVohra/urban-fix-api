-- Migration number: 0006 	 2026-07-29T05:12:47.614Z

-- Add name column (nullable in case existing users don't have a name yet)
ALTER TABLE users ADD COLUMN name TEXT;

-- Add phone column (nullable, you can enforce uniqueness if needed)
ALTER TABLE users ADD COLUMN phone TEXT;