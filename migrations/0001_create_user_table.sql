-- Migration number: 0001 	 2026-07-03T05:46:16.485Z

-- Drop table if exists
DROP TABLE IF EXISTS Users;

-- Create Table
CREATE TABLE users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    user_name TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add an Admin user
INSERT INTO users (email, user_name, role) VALUES ("assignova@gmail.com", "AssigNova", "ADMIN");