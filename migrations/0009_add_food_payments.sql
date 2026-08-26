-- Food orders have their own payment lifecycle because payment_details belongs to service orders.
ALTER TABLE food_orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'pending';

CREATE TABLE food_payment_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    food_order_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    transaction_id TEXT,
    amount REAL NOT NULL,
    payment_method TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (food_order_id) REFERENCES food_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
