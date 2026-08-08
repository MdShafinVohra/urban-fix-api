-- Migration number: 0005 	 2026-07-27T06:49:38.345Z

-- Drop tables if they exist (order matters due to foreign key constraints)
DROP TABLE IF EXISTS payment_details;
DROP TABLE IF EXISTS ordered_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS carts;
DROP TABLE IF EXISTS agents;

-- 1. Agents Table (Technicians/Workers)
CREATE TABLE agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT UNIQUE,
    category_id INTEGER NOT NULL, 
    city_id INTEGER NOT NULL,
    status TEXT DEFAULT 'available', -- Options: 'available', 'busy', 'inactive'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
    FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE RESTRICT
);

-- 2. Cart Table
CREATE TABLE carts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    service_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1, -- Added quantity support
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
);

-- 3. Orders Table (The overall checkout session/receipt)
CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    total_amount REAL NOT NULL,
    payment_status TEXT DEFAULT 'pending', -- Options: 'pending', 'paid', 'failed'
    service_address TEXT NOT NULL, -- NEW: Where the agent needs to go
    city_id INTEGER NOT NULL,      -- NEW: To filter for nearby agents during dispatch
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE RESTRICT
);

-- 4. Ordered Items Table (Individual tasks assigned to agents)
CREATE TABLE ordered_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    service_id INTEGER NOT NULL,
    agent_id INTEGER, -- Nullable initially. Filled when agent is assigned.
    price_at_booking REAL NOT NULL, -- Changed to REAL for accurate math/totals
    status TEXT DEFAULT 'pending', -- Options: 'pending', 'assigned', 'completed', 'cancelled'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
);

-- 5. Payment Details Table
CREATE TABLE payment_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    transaction_id TEXT, -- Provided by your payment gateway (Stripe, Razorpay, etc.)
    amount REAL NOT NULL,
    payment_method TEXT, -- Options: 'card', 'upi', 'cash'
    status TEXT DEFAULT 'pending', -- Options: 'pending', 'success', 'failed'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);