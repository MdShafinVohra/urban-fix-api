-- Migration number: 0008

-- Add owner_id to restaurants
ALTER TABLE restaurants ADD COLUMN owner_id INTEGER;
