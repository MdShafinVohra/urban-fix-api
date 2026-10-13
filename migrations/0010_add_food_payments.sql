-- Keep restaurant-order payments separate from service-order payments.
ALTER TABLE food_orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'pending';

CREATE TABLE food_payment_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    food_order_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    transaction_id TEXT NOT NULL UNIQUE,
    amount REAL NOT NULL,
    payment_method TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (food_order_id) REFERENCES food_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_food_payment_details_order ON food_payment_details(food_order_id, user_id, status);
