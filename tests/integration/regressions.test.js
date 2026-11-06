// Regression tests for bugs fixed after the modular refactor. Each runs
// against the real server on a disposable database (see tests/helpers).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");
const {
  BACKEND_DIR,
  dropTestDatabase,
  openTestPool,
  startServer,
} = require("../helpers/testServer");

const DATABASE = "pos_regression_test";
const PORT = 18741;
const UPLOAD_DIR = path.join(BACKEND_DIR, "uploads", "menu");
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

let server;
let db;
const cookies = {};

const request = async (method, urlPath, { as, body } = {}) => {
  const headers = {};
  if (as) headers.Cookie = cookies[as];
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${server.baseUrl}${urlPath}`, { method, headers, body: payload });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, body: json, setCookie: response.headers.get("set-cookie") };
};

const signUp = async (as, role) => {
  const email = `${as}@regression.test`;
  await request("POST", "/api/user/register", {
    body: { name: as, phone: "1", email, password: "secret-pass", role },
  });
  const login = await request("POST", "/api/user/login", {
    body: { email, password: "secret-pass" },
  });
  cookies[as] = login.setCookie.split(";")[0];
};

const restartServer = async () => {
  await server.stop();
  server = await startServer({ database: DATABASE, port: PORT });
};

describe("regressions", () => {
  before(async () => {
    await dropTestDatabase(DATABASE);
    server = await startServer({ database: DATABASE, port: PORT });
    db = openTestPool(DATABASE);
    await signUp("admin", "admin");
    await signUp("cashier", "cashier");
  });

  after(async () => {
    if (server) await server.stop();
    if (db) await db.end();
    await dropTestDatabase(DATABASE);
  });

  it("seeds the COGS sheet once, adding only what is missing", async () => {
    const [runs] = await db.query("SELECT name FROM seed_runs");
    assert.deepEqual(runs.map((run) => run.name), ["cogs-sheet-2026-11"]);

    const recipeOf = async (menuName) => {
      const [rows] = await db.query(
        `SELECT si.name, r.quantity
         FROM recipes r
         JOIN menu_items mi ON mi.id = r.menu_item_id
         JOIN stock_items si ON si.id = r.stock_item_id
         WHERE mi.name = ?
         ORDER BY r.sort_order`,
        [menuName]
      );
      return rows.map((row) => [row.name, Number(row.quantity)]);
    };

    // A new menu is priced as the sheet and stays off the POS until it has a photo.
    const [[montblanc]] = await db.query(
      `SELECT mi.is_available, c.name AS category, mip.regular_price
       FROM menu_items mi
       JOIN categories c ON c.id = mi.category_id
       JOIN menu_item_prices mip ON mip.menu_item_id = mi.id
       WHERE mi.name = 'Montblanc'`
    );
    assert.deepEqual(
      [montblanc.is_available, montblanc.category, Number(montblanc.regular_price)],
      [0, "Coffee", 23000]
    );
    assert.deepEqual(await recipeOf("Montblanc"), [
      ["ESPRESSO", 8], ["DIAMOND JUICE", 55], ["WATER", 50], ["WHIPPING CREAM", 15],
      ["FRESHMILK", 10], ["CUP", 1], ["SEDOTAN", 1],
    ]);
    // An existing recipe stays as it is; an empty one is filled from the sheet.
    assert.deepEqual(await recipeOf("Americano"), [["ESPRESSO", 8], ["WATER", 100], ["CUP", 1]]);
    assert.deepEqual(await recipeOf("Kentang Goreng"), [
      ["KENTANG BEKU", 120], ["SAOS", 1], ["FOOD TRAY M", 1], ["MINYAK", 1],
    ]);
    assert.deepEqual(await recipeOf("Milo Dino"), []);

    // A new bahan starts with one pack; an existing one keeps its stock.
    const [[telur]] = await db.query(
      "SELECT unit, stock, unit_cost, stock_value FROM stock_items WHERE name = 'TELUR'"
    );
    assert.deepEqual(
      [telur.unit, Number(telur.stock), telur.unit_cost, Number(telur.stock_value)],
      ["pcs", 16, 1750, 28000]
    );
    const [[espresso]] = await db.query("SELECT stock FROM stock_items WHERE name = 'ESPRESSO'");
    assert.equal(Number(espresso.stock), 999);
    const [[roti]] = await db.query(
      `SELECT c.name FROM menu_items mi JOIN categories c ON c.id = mi.category_id
       WHERE mi.name = 'Roti Kukus Coklat'`
    );
    assert.equal(roti.name, "Roti Kukus");

    // It runs once: a seeded menu the admin deletes stays deleted.
    const [[sprite]] = await db.query("SELECT id FROM menu_items WHERE name = 'Sprite'");
    assert.equal((await request("DELETE", `/api/menu-item/${sprite.id}`, { as: "admin" })).status, 200);
    await restartServer();
    const [[counts]] = await db.query(
      "SELECT SUM(name = 'Sprite') AS sprite, SUM(name = 'Montblanc') AS montblanc FROM menu_items"
    );
    assert.deepEqual([Number(counts.sprite), Number(counts.montblanc)], [0, 1]);
  });

  it("returns 404 instead of crashing when the recap format is inactive", async () => {
    await db.query("UPDATE meta_data_format_recap SET is_active = FALSE WHERE code = 'weekly'");
    try {
      const response = await request("POST", "/api/recap/weekly", {
        as: "admin",
        body: { periodStartDate: "2026-01-05", periodEndDate: "2026-01-11" },
      });
      assert.equal(response.status, 404);
      assert.equal(response.body.message, "Recap format not found!");
    } finally {
      await db.query("UPDATE meta_data_format_recap SET is_active = TRUE WHERE code = 'weekly'");
    }
  });

  it("rejects cash methods that are not own keys of the method map", async () => {
    const daily = await request("POST", "/api/recap/daily", {
      as: "admin",
      body: { recapDate: "2026-01-02" },
    });
    assert.equal(daily.status, 201);

    for (const method of ["constructor", "toString", "__proto__"]) {
      const response = await request("PATCH", `/api/recap/daily/${daily.body.data.id}/cash`, {
        as: "admin",
        body: { method, amount: 1000 },
      });
      assert.equal(response.status, 400, method);
      assert.equal(response.body.message, "Metode kas tidak valid.");
    }
  });

  it("does not store an uploaded image when the user is not an admin", async () => {
    const before = new Set(fs.readdirSync(UPLOAD_DIR));
    const form = new FormData();
    form.append("image", new Blob([TINY_PNG], { type: "image/png" }), "kasir.png");

    const response = await request("POST", "/api/menu-item/upload-image", { as: "cashier", body: form });
    const added = fs.readdirSync(UPLOAD_DIR).filter((file) => !before.has(file));
    added.forEach((file) => fs.unlinkSync(path.join(UPLOAD_DIR, file)));

    assert.equal(response.status, 403);
    assert.equal(response.body.message, "Only admin can manage menu items!");
    assert.deepEqual(added, []);
  });

  it("keeps non-seed stock items active and fills missing order codes across a restart", async () => {
    const created = await request("POST", "/api/stock-item", {
      as: "admin",
      body: { name: "Barang Admin", category: "Umum", unit: "pcs", stock: 5 },
    });
    assert.equal(created.status, 201);

    // One order already has a monthly code, a later one in the same month has none.
    const insertOrder = (code, date) =>
      db.query(
        `INSERT INTO orders (order_code, customer_name, order_status, order_date, total, tax, total_with_tax)
         VALUES (?, 'Lama', 'Completed', ?, 1000, 0, 1000)`,
        [code, date]
      );
    await insertOrder("2601-0001", "2026-01-05 10:00:00");
    await insertOrder(null, "2026-01-06 10:00:00");

    await restartServer();

    const stock = await request("GET", "/api/stock-item", { as: "admin" });
    assert.ok(
      stock.body.data.some((item) => item.name === "Barang Admin"),
      "admin-created stock item must survive a restart"
    );

    const [codes] = await db.query(
      "SELECT order_code FROM orders WHERE customer_name = 'Lama' ORDER BY order_date"
    );
    assert.deepEqual(codes.map((row) => row.order_code), ["2601-0001", "2601-0002"]);
  });

  it("rescales recipe quantities when a stock item switches to a convertible unit", async () => {
    const stock = await request("POST", "/api/stock-item", {
      as: "admin",
      body: { name: "Gula Resep", category: "Bahan", unit: "gr", stock: 1000 },
    });
    const stockItemId = stock.body.data.id;
    const [[category]] = await db.query("SELECT id FROM categories ORDER BY id LIMIT 1");
    const menu = await request("POST", "/api/menu-item", {
      as: "admin",
      body: {
        categoryId: category.id,
        name: "Teh Manis Resep",
        price: 5000,
        ingredients: [{ stockItemId, quantity: 15 }],
      },
    });
    assert.equal(menu.status, 201);

    const updateUnit = (unit) =>
      request("PUT", `/api/stock-item/${stockItemId}`, {
        as: "admin",
        body: { name: "Gula Resep", category: "Bahan", unit, stock: 1 },
      });
    const recipeQuantity = async () => {
      const [[row]] = await db.query(
        "SELECT quantity FROM recipes WHERE stock_item_id = ?",
        [stockItemId]
      );
      return Number(row.quantity);
    };

    await updateUnit("kg");
    assert.equal(await recipeQuantity(), 0.015);
    await updateUnit("pcs");
    assert.equal(await recipeQuantity(), 0.015, "incompatible units leave the recipe as is");
  });

  it("keeps recipe cost and menu HPP in step with the stock average cost", async () => {
    const stock = await request("POST", "/api/stock-item", {
      as: "admin",
      body: { name: "Kopi Biaya", category: "Bahan", unit: "gr", stock: 1000 },
    });
    const stockItemId = stock.body.data.id;
    const [[category]] = await db.query("SELECT id FROM categories ORDER BY id LIMIT 1");
    const menu = await request("POST", "/api/menu-item", {
      as: "admin",
      body: {
        categoryId: category.id,
        name: "Kopi Biaya",
        price: 20000,
        hppCost: 5000,
        ingredients: [{ stockItemId, quantity: 8 }],
      },
    });
    assert.equal(menu.body.data.hppCost, 5000, "without purchase prices the manual HPP stays");

    await request("PATCH", `/api/stock-item/${stockItemId}/cogs`, {
      as: "admin",
      body: { averageCost: 205 },
    });

    const [[recipe]] = await db.query("SELECT cost FROM recipes WHERE stock_item_id = ?", [stockItemId]);
    assert.equal(recipe.cost, 1640);
    const [[price]] = await db.query(
      "SELECT hpp_cost, gross_profit FROM menu_item_prices WHERE menu_item_id = ?",
      [menu.body.data.id]
    );
    assert.deepEqual([Number(price.hpp_cost), Number(price.gross_profit)], [1640, 18360]);
  });

  it("freezes the per-ingredient HPP of sold items when costs change later", async () => {
    const stock = await request("POST", "/api/stock-item", {
      as: "admin",
      body: { name: "Susu Snapshot", category: "Bahan", unit: "ml", stock: 10000 },
    });
    const stockItemId = stock.body.data.id;
    await request("PATCH", `/api/stock-item/${stockItemId}/cogs`, {
      as: "admin",
      body: { averageCost: 20 },
    });
    const [[category]] = await db.query("SELECT id FROM categories ORDER BY id LIMIT 1");
    const menu = await request("POST", "/api/menu-item", {
      as: "admin",
      body: {
        categoryId: category.id,
        name: "Latte Snapshot",
        price: 18000,
        ingredients: [{ stockItemId, quantity: 100 }],
      },
    });
    const menuItemId = menu.body.data.id;

    const order = await request("POST", "/api/order", {
      as: "cashier",
      body: {
        customerDetails: { name: "Snapshot" },
        orderType: "Offline",
        orderStatus: "In Progress",
        bills: { total: 36000, tax: 0, totalWithTax: 36000 },
        items: [{
          id: `${category.id}-${menuItemId}`,
          sourceMenuItemId: menuItemId,
          name: "Latte Snapshot",
          quantity: 2,
          pricePerQuantity: 18000,
          price: 36000,
        }],
        paymentMethod: "Cash",
      },
    });
    assert.equal(order.status, 201);

    const soldCosts = async () => {
      const [rows] = await db.query(
        `SELECT oi.hpp_cost, c.stock_item_name, c.quantity, c.unit, c.unit_cost, c.cost
         FROM order_item_costs c
         JOIN order_items oi ON oi.id = c.order_item_id
         WHERE oi.order_id = ?`,
        [order.body.data.id]
      );
      return rows.map((row) => ({ ...row, hpp_cost: Number(row.hpp_cost) }));
    };
    const atSale = [{
      hpp_cost: 2000, stock_item_name: "Susu Snapshot", quantity: 100, unit: "ml", unit_cost: 20, cost: 2000,
    }];
    assert.deepEqual(await soldCosts(), atSale);

    // The milk price rises: the recipe follows, the sold item does not.
    await request("PATCH", `/api/stock-item/${stockItemId}/cogs`, {
      as: "admin",
      body: { averageCost: 25 },
    });
    const [[recipe]] = await db.query("SELECT cost FROM recipes WHERE menu_item_id = ?", [menuItemId]);
    assert.equal(recipe.cost, 2500);
    assert.deepEqual(await soldCosts(), atSale);
  });

  it("sells a promo package as the recipes of its menus", async () => {
    // A Kategori Promo keeps its flag until it is changed.
    const promo = await request("POST", "/api/category", {
      as: "admin",
      body: { name: "Promo Paket", icon: "🏷️", isBundle: true },
    });
    assert.equal(promo.status, 201, JSON.stringify(promo.body));
    assert.equal(promo.body.data.isBundle, true);
    const renamed = await request("PUT", `/api/category/${promo.body.data.id}`, {
      as: "admin",
      body: { name: "Promo Paket", icon: "🏷️", isActive: true },
    });
    assert.equal(renamed.body.data.isBundle, true);
    const plainCategory = await request("POST", "/api/category", {
      as: "admin",
      body: { name: "Roti Paket Cat", icon: "🥐" },
    });
    assert.equal(plainCategory.body.data.isBundle, false);
    const [[coffee]] = await db.query("SELECT id FROM categories WHERE is_bundle = FALSE ORDER BY id LIMIT 1");

    const stockOf = async (name, unit, stock, averageCost) => {
      const created = await request("POST", "/api/stock-item", {
        as: "admin",
        body: { name, category: "Bahan", unit, stock },
      });
      await request("PATCH", `/api/stock-item/${created.body.data.id}/cogs`, { as: "admin", body: { averageCost } });
      return created.body.data.id;
    };
    const espresso = await stockOf("Espresso Paket", "gr", 1000, 100);
    const roti = await stockOf("Roti Paket", "pcs", 10, 5000);
    const menuOf = async (body) => {
      const created = await request("POST", "/api/menu-item", { as: "admin", body });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      return created.body.data;
    };
    const kopi = await menuOf({
      categoryId: coffee.id, name: "Kopi Paket", price: 15000, ingredients: [{ stockItemId: espresso, quantity: 10 }],
    });
    const rotiIsi = await menuOf({
      categoryId: plainCategory.body.data.id, name: "Roti Isi Paket", price: 12000, ingredients: [{ stockItemId: roti, quantity: 1 }],
    });
    // No recipe: priced by its stored HPP.
    const air = await menuOf({ categoryId: coffee.id, name: "Air Paket", price: 5000, hppCost: 2000 });
    assert.equal(kopi.hppCost, 1000);
    assert.equal(air.hppCost, 2000);

    const bundleBody = (bundleItems, extra = {}) => ({
      categoryId: promo.body.data.id,
      name: "Paket Hemat",
      price: 30000,
      bundleItems,
      ...extra,
    });
    const tooSmall = await request("POST", "/api/menu-item", {
      as: "admin",
      body: bundleBody([{ menuItemId: kopi.id, quantity: 1 }]),
    });
    assert.equal(tooSmall.status, 400);
    assert.equal(tooSmall.body.message, "Paket minimal berisi 2 menu.");

    // Bahan sent with a package are not kept: its menus carry the recipes.
    const paket = await menuOf(
      bundleBody(
        [
          { menuItemId: kopi.id, quantity: 2 },
          { menuItemId: rotiIsi.id, quantity: 1 },
          { menuItemId: air.id, quantity: 1 },
        ],
        { ingredients: [{ stockItemId: espresso, quantity: 5 }] }
      )
    );
    assert.equal(paket.isBundle, true);
    assert.deepEqual(paket.ingredients, []);
    assert.deepEqual(
      paket.bundleItems.map(({ menuItemId, name, quantity, price, hppCost }) => ({ menuItemId, name, quantity, price, hppCost })),
      [
        { menuItemId: kopi.id, name: "Kopi Paket", quantity: 2, price: 15000, hppCost: 1000 },
        { menuItemId: rotiIsi.id, name: "Roti Isi Paket", quantity: 1, price: 12000, hppCost: 5000 },
        { menuItemId: air.id, name: "Air Paket", quantity: 1, price: 5000, hppCost: 2000 },
      ]
    );
    assert.deepEqual([paket.hppCost, paket.grossProfit], [9000, 21000]);

    const nested = await request("POST", "/api/menu-item", {
      as: "admin",
      body: bundleBody([{ menuItemId: paket.id, quantity: 1 }, { menuItemId: kopi.id, quantity: 1 }], { name: "Paket Ganda" }),
    });
    assert.equal(nested.status, 400);
    assert.equal(nested.body.message, "Paket tidak bisa berisi paket lain: Paket Hemat.");

    // Two packages: the bahan of every menu leave the stock.
    const order = await request("POST", "/api/order", {
      as: "cashier",
      body: {
        customerDetails: { name: "Paket" },
        orderType: "Offline",
        orderStatus: "In Progress",
        bills: { total: 60000, tax: 0, totalWithTax: 60000 },
        items: [{
          id: `${promo.body.data.id}-${paket.id}`,
          sourceMenuItemId: paket.id,
          name: "Paket Hemat",
          quantity: 2,
          pricePerQuantity: 30000,
          price: 60000,
        }],
        paymentMethod: "Cash",
      },
    });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    const stocks = async () => {
      const [rows] = await db.query("SELECT id, stock FROM stock_items WHERE id IN (?) ORDER BY id", [[espresso, roti]]);
      return rows.map((row) => Number(row.stock));
    };
    assert.deepEqual(await stocks(), [960, 8]);

    const [[sold]] = await db.query("SELECT id, hpp_cost FROM order_items WHERE order_id = ?", [order.body.data.id]);
    assert.equal(Number(sold.hpp_cost), 9000);
    const [lines] = await db.query(
      "SELECT stock_item_name AS name, quantity, unit, unit_cost, cost FROM order_item_costs WHERE order_item_id = ? ORDER BY id",
      [sold.id]
    );
    assert.deepEqual(
      lines.map(({ name, quantity, unit, unit_cost, cost }) => ({ name, quantity: Number(quantity), unit, unitCost: unit_cost, cost })),
      [
        { name: "Espresso Paket", quantity: 20, unit: "gr", unitCost: 100, cost: 2000 },
        { name: "Roti Paket", quantity: 1, unit: "pcs", unitCost: 5000, cost: 5000 },
        { name: "Air Paket", quantity: 1, unit: "porsi", unitCost: 2000, cost: 2000 },
      ]
    );

    // A menu inside a package (or its category) cannot be deleted.
    const deleteKopi = await request("DELETE", `/api/menu-item/${kopi.id}`, { as: "admin" });
    assert.equal(deleteKopi.status, 409);
    assert.equal(deleteKopi.body.message, "Menu ini dipakai di paket Paket Hemat. Hapus dari paket dulu.");
    const deleteCategory = await request("DELETE", `/api/category/${plainCategory.body.data.id}`, { as: "admin" });
    assert.equal(deleteCategory.status, 409);
    assert.equal(deleteCategory.body.message, "Menu di category ini dipakai di paket Paket Hemat. Hapus dari paket dulu.");

    // The package HPP follows the price of its menus' bahan.
    await request("PATCH", `/api/stock-item/${espresso}/cogs`, { as: "admin", body: { averageCost: 200 } });
    const [[price]] = await db.query("SELECT hpp_cost, gross_profit FROM menu_item_prices WHERE menu_item_id = ?", [paket.id]);
    assert.deepEqual([Number(price.hpp_cost), Number(price.gross_profit)], [11000, 19000]);

    // The POS hides a package while one of its menus is unavailable.
    await request("PUT", `/api/menu-item/${rotiIsi.id}`, {
      as: "admin",
      body: {
        categoryId: plainCategory.body.data.id, name: "Roti Isi Paket", price: 12000,
        ingredients: [{ stockItemId: roti, quantity: 1 }], isAvailable: false,
      },
    });
    const posMenus = await request("GET", "/api/menu-item", { as: "cashier" });
    assert.equal(posMenus.body.data.some((item) => item.id === paket.id), false);
    const adminMenus = await request("GET", "/api/menu-item?includeUnavailable=true", { as: "admin" });
    const listed = adminMenus.body.data.find((item) => item.id === paket.id);
    assert.deepEqual(listed.bundleItems.map((item) => item.isAvailable), [true, false, true]);

    // Deleting the order returns the bahan.
    const removed = await request("DELETE", `/api/order/${order.body.data.id}`, { as: "admin" });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.deepEqual(await stocks(), [1000, 10]);

    // Moved to an ordinary category, the package becomes a menu with a recipe.
    const plain = await request("PUT", `/api/menu-item/${paket.id}`, {
      as: "admin",
      body: {
        categoryId: coffee.id, name: "Paket Hemat", price: 30000,
        bundleItems: [{ menuItemId: kopi.id, quantity: 2 }],
        ingredients: [{ stockItemId: roti, quantity: 1 }],
      },
    });
    assert.equal(plain.status, 200, JSON.stringify(plain.body));
    assert.deepEqual([plain.body.data.isBundle, plain.body.data.bundleItems.length, plain.body.data.ingredients.length], [false, 0, 1]);
    assert.equal((await request("DELETE", `/api/menu-item/${kopi.id}`, { as: "admin" })).status, 200);
  });

  it("stores whole-rupiah average costs but keeps the exact stock value", async () => {
    const stock = await request("POST", "/api/stock-item", {
      as: "admin",
      body: { name: "Matcha Nilai", category: "Bahan", unit: "gr", stock: 1600 },
    });
    const id = stock.body.data.id;

    // 800 gr package for Rp169.000 -> Rp211,25 per gr.
    const cogs = await request("PATCH", `/api/stock-item/${id}/cogs`, {
      as: "admin",
      body: { averageCost: 211.25 },
    });
    assert.equal(cogs.body.data.averageCost, 211);
    assert.equal(cogs.body.data.stockValue, 338000);

    const halved = await request("PATCH", `/api/stock-item/${id}/stock`, {
      as: "admin",
      body: { stock: 800 },
    });
    assert.equal(halved.body.data.stockValue, 169000, "not 800 x 211 = 168.800");
  });

  it("never stores a negative stock value when COGS is set on negative stock", async () => {
    const stock = await request("POST", "/api/stock-item", {
      as: "admin",
      body: { name: "Susu Minus", category: "Bahan", unit: "ml", stock: 0 },
    });
    const id = stock.body.data.id;
    // Orders with allowNegativeStock can push stock below zero.
    await db.query("UPDATE stock_items SET stock = -1500 WHERE id = ?", [id]);

    const cogs = await request("PATCH", `/api/stock-item/${id}/cogs`, {
      as: "admin",
      body: { averageCost: 20 },
    });
    assert.equal(cogs.body.data.averageCost, 20);
    assert.equal(cogs.body.data.stockValue, 0, "the dialog preview shows Rp 0 as well");
  });
});
