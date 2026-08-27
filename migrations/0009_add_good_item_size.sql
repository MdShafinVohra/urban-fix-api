-- Three menu prices; existing `price` remains the legacy/full-size value.
ALTER TABLE restaurant_menus ADD COLUMN price_quarter REAL;
ALTER TABLE restaurant_menus ADD COLUMN price_half REAL;
ALTER TABLE restaurant_menus ADD COLUMN price_full REAL;
UPDATE restaurant_menus SET price_full = price WHERE price_full IS NULL;

-- Preserve the customer's size and price choice in the cart and final order.
ALTER TABLE food_carts ADD COLUMN size TEXT NOT NULL DEFAULT 'full';
ALTER TABLE food_carts ADD COLUMN unit_price REAL;
UPDATE food_carts SET unit_price = (SELECT price FROM restaurant_menus WHERE restaurant_menus.id = food_carts.menu_item_id) WHERE unit_price IS NULL;
ALTER TABLE food_ordered_items ADD COLUMN size TEXT NOT NULL DEFAULT 'full';
