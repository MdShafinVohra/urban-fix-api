-- Migration number: 0002 	 2026-07-11T13:09:25.547Z

-- Drop tables if they exist (order matters due to foreign key constraints)
DROP TABLE IF EXISTS service_cities;
DROP TABLE IF EXISTS services;
DROP TABLE IF EXISTS sub_categories;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS cities;

-- Create Categories Table
CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Sub Categories Table
-- (Linked to categories so you know which sub-category belongs to which parent)
CREATE TABLE sub_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- Create Cities Table
CREATE TABLE cities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Services Table
CREATE TABLE services(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category_id INTEGER NOT NULL,
    sub_category_id INTEGER NOT NULL,
    price TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
    FOREIGN KEY (sub_category_id) REFERENCES sub_categories(id) ON DELETE RESTRICT
);

-- Create Junction Table for Services and Cities (Many-to-Many)
CREATE TABLE service_cities (
    service_id INTEGER NOT NULL,
    city_id INTEGER NOT NULL,
    PRIMARY KEY (service_id, city_id),
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
    FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE CASCADE
);