// Bahan olahan that can stand in for another in a menu (Nasi Putih -> Nasi
// Daun Jeruk, see modules/menu/menu.ingredientSwaps), and the swaps picked
// for each sold item:
//   stock_semi_item_substitutes    semi_item_id may be swapped for
//                                  substitute_semi_item_id in any menu that
//                                  uses it, extra_price more per item
//   order_item_ingredient_swaps    the swaps of a sold item, with the names
//                                  and extra price at the sale
// Runs after stock_semi_items and order_items exist.
const ensureIngredientSwapSchema = async (db) => {
  await db.query(`CREATE TABLE IF NOT EXISTS stock_semi_item_substitutes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    semi_item_id INT UNSIGNED NOT NULL,
    substitute_semi_item_id INT UNSIGNED NOT NULL,
    extra_price INT NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_stock_semi_item_substitutes (semi_item_id, substitute_semi_item_id),
    INDEX idx_stock_semi_item_substitutes_substitute (substitute_semi_item_id),
    CONSTRAINT fk_stock_semi_item_substitutes_semi
      FOREIGN KEY (semi_item_id) REFERENCES stock_semi_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_stock_semi_item_substitutes_substitute
      FOREIGN KEY (substitute_semi_item_id) REFERENCES stock_semi_items(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);

  await db.query(`CREATE TABLE IF NOT EXISTS order_item_ingredient_swaps (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_item_id INT UNSIGNED NOT NULL,
    from_semi_item_id INT UNSIGNED NULL,
    to_semi_item_id INT UNSIGNED NULL,
    from_name VARCHAR(150) NOT NULL,
    to_name VARCHAR(150) NOT NULL,
    extra_price INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_order_item_ingredient_swaps_order_item_id (order_item_id),
    CONSTRAINT fk_order_item_ingredient_swaps_order_item
      FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_order_item_ingredient_swaps_from
      FOREIGN KEY (from_semi_item_id) REFERENCES stock_semi_items(id) ON DELETE SET NULL,
    CONSTRAINT fk_order_item_ingredient_swaps_to
      FOREIGN KEY (to_semi_item_id) REFERENCES stock_semi_items(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);
};

module.exports = { ensureIngredientSwapSchema };
