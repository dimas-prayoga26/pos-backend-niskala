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
    const [runs] = await db.query("SELECT name FROM seed_runs ORDER BY name");
    assert.deepEqual(runs.map((run) => run.name), ["cogs-categories-2026-11", "cogs-sheet-2026-11"]);

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
      [0, "Black Coffee", 23000]
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
    // The category seed then moves it to the sheet's Roti tab.
    assert.equal(roti.name, "Roti");

    // It runs once: a seeded menu the admin deletes stays deleted.
    const [[sprite]] = await db.query("SELECT id FROM menu_items WHERE name = 'Sprite'");
    assert.equal((await request("DELETE", `/api/menu-item/${sprite.id}`, { as: "admin" })).status, 200);
    await restartServer();
    const [[counts]] = await db.query(
      "SELECT SUM(name = 'Sprite') AS sprite, SUM(name = 'Montblanc') AS montblanc FROM menu_items"
    );
    assert.deepEqual([Number(counts.sprite), Number(counts.montblanc)], [0, 1]);
  });

  it("arranges the sheet's menus into its tabs as categories, once", async () => {
    const categoryOf = async (menuName) => {
      const [[row]] = await db.query(
        `SELECT c.name FROM menu_items mi JOIN categories c ON c.id = mi.category_id WHERE mi.name = ?`,
        [menuName]
      );
      return row?.name;
    };
    const [categories] = await db.query(
      "SELECT name, is_active FROM categories ORDER BY CASE WHEN sort_order > 0 THEN sort_order ELSE 9999 END, id"
    );
    // The tabs from Black Coffee to Roti come first; "Non Coffee" reuses Non-Coffee.
    assert.deepEqual(categories.slice(0, 12).map((category) => category.name), [
      "Black Coffee", "Hot Black Coffee", "White Coffee", "Hot White Coffee", "Matcha Series", "Non-Coffee",
      "Tea Based", "Minuman Kaleng", "Snack", "Nasi Goreng", "Rice Bowl", "Roti",
    ]);
    assert.deepEqual(
      await Promise.all(
        ["Americano", "Longblack", "Cafe Latte", "Matcha Coffee", "Matcha", "Thai Tea", "Coca-Cola",
          "Nasi Goreng Special", "Fried Egg Rice Bowl", "Roti Kukus Coklat"].map(categoryOf)
      ),
      ["Black Coffee", "Hot Black Coffee", "White Coffee", "Hot White Coffee", "Matcha Series", "Tea Based",
        "Minuman Kaleng", "Nasi Goreng", "Rice Bowl", "Roti"]
    );
    // Each tab has its own icon, a reused category too.
    const [icons] = await db.query(
      `SELECT icon FROM categories
       WHERE name IN ('Black Coffee', 'Hot Black Coffee', 'Hot White Coffee', 'Non-Coffee', 'Tea Based', 'Minuman Kaleng')
       ORDER BY sort_order`
    );
    assert.deepEqual(icons.map((row) => row.icon), ["\u2615\uFE0F", "\u{1F525}", "\u2668\uFE0F", "\u{1F9CB}", "\u{1FAD6}", "\u{1F964}"]);
    // A menu not on the sheet stays; an emptied category is turned off.
    assert.equal(await categoryOf("Vanilla Latte"), "Coffee");
    const isActive = (name) => Boolean(categories.find((category) => category.name === name)?.is_active);
    assert.deepEqual([isActive("Coffee"), isActive("Roti Kukus")], [true, false]);

    // Run again on a package offering every Coffee menu: it keeps offering those
    // menus where they move, and stays sellable.
    const [[coffee]] = await db.query("SELECT id FROM categories WHERE name = 'Coffee'");
    const promo = await request("POST", "/api/category", {
      as: "admin",
      body: { name: "Promo Seed", icon: "🏷️", isBundle: true },
    });
    const paket = await request("POST", "/api/menu-item", {
      as: "admin",
      body: {
        categoryId: promo.body.data.id, name: "Paket Kopi Seed", price: 15000,
        bundleChoices: [{ categoryId: coffee.id, quantity: 1 }],
      },
    });
    assert.equal(paket.status, 201, JSON.stringify(paket.body));
    await db.query(
      "UPDATE menu_items SET category_id = ? WHERE name = 'Cafe Latte'",
      [coffee.id]
    );
    await db.query("DELETE FROM seed_runs WHERE name = 'cogs-categories-2026-11'");
    await restartServer();

    assert.equal(await categoryOf("Cafe Latte"), "White Coffee");
    const [offered] = await db.query(
      `SELECT mi.name FROM menu_item_bundle_choice_menus o
       JOIN menu_item_bundle_choices bc ON bc.id = o.bundle_choice_id
       JOIN menu_items mi ON mi.id = o.menu_item_id
       WHERE bc.bundle_menu_item_id = ? ORDER BY mi.name`,
      [paket.body.data.id]
    );
    assert.ok(offered.some((row) => row.name === "Cafe Latte"));
    assert.ok(offered.some((row) => row.name === "Vanilla Latte"));
    const [[cafeLatte]] = await db.query("SELECT id, category_id FROM menu_items WHERE name = 'Cafe Latte'");
    const order = await request("POST", "/api/order", {
      as: "cashier",
      body: {
        customerDetails: { name: "Seed" },
        orderType: "Offline",
        orderStatus: "In Progress",
        bills: { total: 15000, tax: 0, totalWithTax: 15000 },
        items: [{
          id: `${promo.body.data.id}-${paket.body.data.id}~1`, sourceMenuItemId: paket.body.data.id,
          name: "Paket Kopi Seed", quantity: 1, pricePerQuantity: 15000, price: 15000,
          bundleChoices: [{ menuItemId: cafeLatte.id, quantity: 1 }],
        }],
        paymentMethod: "Cash",
        allowNegativeStock: true,
      },
    });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    assert.equal((await request("DELETE", `/api/order/${order.body.data.id}`, { as: "admin" })).status, 200);
    assert.equal((await request("DELETE", `/api/menu-item/${paket.body.data.id}`, { as: "admin" })).status, 200);
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
      grossProfit: 21000,
      bundleItems,
      ...extra,
    });
    const empty = await request("POST", "/api/menu-item", { as: "admin", body: bundleBody([]) });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.message, "Paket minimal berisi 1 menu.");
    // One menu is enough (e.g. a free coffee for a review).
    const single = await menuOf(bundleBody([{ menuItemId: kopi.id, quantity: 1 }], { name: "Paket Satu" }));
    assert.deepEqual(single.bundleItems.map((line) => [line.menuItemId, line.quantity]), [[kopi.id, 1]]);
    assert.equal((await request("DELETE", `/api/menu-item/${single.id}`, { as: "admin" })).status, 200);

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
    // No HPP of its own (each sale counts its menus); the profit is entered by hand.
    assert.deepEqual([paket.hppCost, paket.grossProfit], [0, 21000]);

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

    // Cost changes of its menus' bahan leave the package's own figures alone.
    await request("PATCH", `/api/stock-item/${espresso}/cogs`, { as: "admin", body: { averageCost: 200 } });
    const [[price]] = await db.query("SELECT hpp_cost, gross_profit FROM menu_item_prices WHERE menu_item_id = ?", [paket.id]);
    assert.deepEqual([Number(price.hpp_cost), Number(price.gross_profit)], [0, 21000]);

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

  it("sells a promo package with menus the cashier picks from a category", async () => {
    const categoryOf = async (body) => {
      const created = await request("POST", "/api/category", { as: "admin", body });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      return created.body.data;
    };
    const promo = await categoryOf({ name: "Promo Pilih", icon: "🏷️", isBundle: true });
    const kopiCat = await categoryOf({ name: "Kopi Pilih Cat", icon: "☕" });
    const snackCat = await categoryOf({ name: "Snack Pilih Cat", icon: "🍟" });

    const stockOf = async (name, unit, averageCost) => {
      const created = await request("POST", "/api/stock-item", {
        as: "admin",
        body: { name, category: "Bahan", unit, stock: 1000 },
      });
      await request("PATCH", `/api/stock-item/${created.body.data.id}/cogs`, { as: "admin", body: { averageCost } });
      return created.body.data.id;
    };
    const espresso = await stockOf("Espresso Pilih", "gr", 100);
    const susu = await stockOf("Susu Pilih", "ml", 20);
    const menuOf = async (body) => {
      const created = await request("POST", "/api/menu-item", { as: "admin", body });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      return created.body.data;
    };
    const americano = await menuOf({
      categoryId: kopiCat.id, name: "Americano Pilih", price: 15000,
      ingredients: [{ stockItemId: espresso, quantity: 10 }],
    });
    const latte = await menuOf({
      categoryId: kopiCat.id, name: "Latte Pilih", price: 20000,
      ingredients: [{ stockItemId: espresso, quantity: 10 }, { stockItemId: susu, quantity: 100 }],
    });
    const kentang = await menuOf({ categoryId: snackCat.id, name: "Kentang Pilih", price: 10000, hppCost: 2500 });

    const fromPromo = await request("POST", "/api/menu-item", {
      as: "admin",
      body: { categoryId: promo.id, name: "Paket Salah", price: 30000, bundleChoices: [{ categoryId: promo.id, quantity: 2 }] },
    });
    assert.equal(fromPromo.status, 400);
    assert.equal(fromPromo.body.message, "Pilihan paket tidak bisa dari Kategori Promo: Promo Pilih.");

    // 2 coffees of the cashier's choice + 1 Kentang.
    const paket = await menuOf({
      categoryId: promo.id, name: "Paket Pilih", price: 35000, hppCost: 9999, grossProfit: 20000,
      bundleItems: [{ menuItemId: kentang.id, quantity: 1 }],
      bundleChoices: [{ categoryId: kopiCat.id, quantity: 2 }],
    });
    assert.deepEqual(
      paket.bundleChoices.map(({ categoryId, categoryName, quantity }) => ({ categoryId, categoryName, quantity })),
      [{ categoryId: kopiCat.id, categoryName: "Kopi Pilih Cat", quantity: 2 }]
    );
    assert.deepEqual([paket.hppCost, paket.grossProfit], [0, 20000]);

    const orderWith = (bundleChoices) =>
      request("POST", "/api/order", {
        as: "cashier",
        body: {
          customerDetails: { name: "Pilih" },
          orderType: "Offline",
          orderStatus: "In Progress",
          bills: { total: 70000, tax: 0, totalWithTax: 70000 },
          items: [{
            id: `${promo.id}-${paket.id}-pilih`,
            sourceMenuItemId: paket.id,
            name: "Paket Pilih",
            quantity: 2,
            pricePerQuantity: 35000,
            price: 70000,
            bundleChoices,
          }],
          paymentMethod: "Cash",
        },
      });
    const missing = await orderWith([{ menuItemId: americano.id, quantity: 1 }]);
    assert.equal(missing.status, 400);
    assert.equal(missing.body.message, "Pilih 2 menu Kopi Pilih Cat untuk Paket Pilih.");
    const wrongCategory = await orderWith([{ menuItemId: americano.id, quantity: 1 }, { menuItemId: kentang.id, quantity: 1 }]);
    assert.equal(wrongCategory.status, 400);
    assert.equal(wrongCategory.body.message, "Menu pilihan paket tidak sesuai category paket.");

    const stocks = async () => {
      const [rows] = await db.query("SELECT id, stock FROM stock_items WHERE id IN (?) ORDER BY id", [[espresso, susu]]);
      return rows.map((row) => Number(row.stock));
    };
    assert.deepEqual(await stocks(), [1000, 1000]);

    // Two packages, each with an Americano and a Latte.
    const order = await orderWith([{ menuItemId: americano.id, quantity: 1 }, { menuItemId: latte.id, quantity: 1 }]);
    assert.equal(order.status, 201, JSON.stringify(order.body));
    assert.deepEqual(
      order.body.data.items[0].bundleChoices.map(({ menuItemId, name, quantity }) => ({ menuItemId, name, quantity })),
      [
        { menuItemId: americano.id, name: "Americano Pilih", quantity: 1 },
        { menuItemId: latte.id, name: "Latte Pilih", quantity: 1 },
      ]
    );
    assert.deepEqual(await stocks(), [960, 800]);
    const [[sold]] = await db.query("SELECT id, hpp_cost FROM order_items WHERE order_id = ?", [order.body.data.id]);
    assert.equal(Number(sold.hpp_cost), 6500);
    const [lines] = await db.query(
      "SELECT stock_item_name AS name, quantity, cost FROM order_item_costs WHERE order_item_id = ? ORDER BY id",
      [sold.id]
    );
    assert.deepEqual(
      lines.map(({ name, quantity, cost }) => ({ name, quantity: Number(quantity), cost })),
      [
        { name: "Kentang Pilih", quantity: 1, cost: 2500 },
        { name: "Espresso Pilih", quantity: 20, cost: 2000 },
        { name: "Susu Pilih", quantity: 100, cost: 2000 },
      ]
    );

    // A choice may offer only some menus of its category.
    const onlyAmericano = await menuOf({
      categoryId: promo.id, name: "Paket Americano", price: 15000,
      bundleChoices: [{ categoryId: kopiCat.id, quantity: 1, menuItemIds: [americano.id] }],
    });
    assert.deepEqual(onlyAmericano.bundleChoices.map((choice) => choice.menuItemIds), [[americano.id]]);
    const pickOf = (menuId) =>
      request("POST", "/api/order", {
        as: "cashier",
        body: {
          customerDetails: { name: "Pilih" },
          orderType: "Offline",
          orderStatus: "In Progress",
          bills: { total: 15000, tax: 0, totalWithTax: 15000 },
          items: [{
            id: `${promo.id}-${onlyAmericano.id}~1`, sourceMenuItemId: onlyAmericano.id, name: "Paket Americano",
            quantity: 1, pricePerQuantity: 15000, price: 15000, bundleChoices: [{ menuItemId: menuId, quantity: 1 }],
          }],
          paymentMethod: "Cash",
        },
      });
    const notOffered = await pickOf(latte.id);
    assert.equal(notOffered.status, 400);
    assert.equal(notOffered.body.message, "Menu pilihan paket tidak sesuai category paket.");
    const offered = await pickOf(americano.id);
    assert.equal(offered.status, 201, JSON.stringify(offered.body));
    assert.equal((await request("DELETE", `/api/order/${offered.body.data.id}`, { as: "admin" })).status, 200);
    const wrongMenu = await request("POST", "/api/menu-item", {
      as: "admin",
      body: {
        categoryId: promo.id, name: "Paket Salah Menu", price: 15000,
        bundleChoices: [{ categoryId: kopiCat.id, quantity: 1, menuItemIds: [paket.id] }],
      },
    });
    assert.equal(wrongMenu.status, 400);
    assert.equal(wrongMenu.body.message, "Menu pilihan paket harus menu biasa, bukan paket.");
    // An offered menu moved to another category can still be picked.
    await db.query("UPDATE menu_items SET category_id = ? WHERE id = ?", [snackCat.id, americano.id]);
    const movedPick = await pickOf(americano.id);
    assert.equal(movedPick.status, 201, JSON.stringify(movedPick.body));
    assert.equal((await request("DELETE", `/api/order/${movedPick.body.data.id}`, { as: "admin" })).status, 200);
    await db.query("UPDATE menu_items SET category_id = ? WHERE id = ?", [kopiCat.id, americano.id]);
    // A menu offered by a choice cannot be deleted.
    const deleteOffered = await request("DELETE", `/api/menu-item/${americano.id}`, { as: "admin" });
    assert.equal(deleteOffered.status, 409);
    assert.equal(
      deleteOffered.body.message,
      "Menu ini dipakai di paket Paket Americano. Hapus dari paket dulu."
    );

    // A promo with a discount: 100% off its menus (e.g. a Google Maps review).
    const review = await menuOf({
      categoryId: promo.id, name: "Review GMaps", price: 0, discountPercent: 100,
      bundleChoices: [{ categoryId: kopiCat.id, quantity: 2 }],
    });
    assert.equal(review.discountPercent, 100);
    // Only a promo keeps a discount.
    assert.equal(
      (await menuOf({ categoryId: snackCat.id, name: "Snack Diskon", price: 5000, discountPercent: 50 }))
        .discountPercent,
      0
    );

    // The category offered by a package stays an ordinary category and is kept.
    const toPromo = await request("PUT", `/api/category/${kopiCat.id}`, {
      as: "admin",
      body: { name: "Kopi Pilih Cat", icon: "☕", isBundle: true },
    });
    assert.equal(toPromo.status, 400);
    assert.equal(
      toPromo.body.message,
      "Category ini jadi pilihan di paket Paket Americano, Paket Pilih, Review GMaps, jadi tidak bisa dijadikan Kategori Promo."
    );
    const deleteCategory = await request("DELETE", `/api/category/${kopiCat.id}`, { as: "admin" });
    assert.equal(deleteCategory.status, 409);

    // The POS hides the package while its category has no available menu.
    const hide = (menu, isAvailable) =>
      request("PUT", `/api/menu-item/${menu.id}`, {
        as: "admin",
        body: {
          categoryId: kopiCat.id, name: menu.name, price: menu.regularPrice ?? menu.price,
          ingredients: menu.ingredients.map(({ stockItemId, quantity }) => ({ stockItemId, quantity })),
          isAvailable,
        },
      });
    await hide(americano, false);
    let posMenus = await request("GET", "/api/menu-item", { as: "cashier" });
    assert.equal(posMenus.body.data.some((item) => item.id === paket.id), true);
    await hide(latte, false);
    posMenus = await request("GET", "/api/menu-item", { as: "cashier" });
    assert.equal(posMenus.body.data.some((item) => item.id === paket.id), false);

    // Deleting the order returns the bahan of the picked menus.
    const removed = await request("DELETE", `/api/order/${order.body.data.id}`, { as: "admin" });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.deepEqual(await stocks(), [1000, 1000]);
  });

  it("keeps a line discount: the charged price, the percent and the rupiah taken off", async () => {
    const [[menu]] = await db.query(
      `SELECT mi.id, mi.category_id FROM menu_items mi
       JOIN menu_item_prices mip ON mip.menu_item_id = mi.id
       WHERE mip.regular_price > 0 ORDER BY mi.id LIMIT 1`
    );
    const line = (extra) => ({
      id: `${menu.category_id}-${menu.id}`,
      sourceMenuItemId: menu.id,
      name: "Diskon Test",
      quantity: 2,
      pricePerQuantity: 20000,
      ...extra,
    });
    const order = await request("POST", "/api/order", {
      as: "cashier",
      body: {
        customerDetails: { name: "Review GMaps" },
        orderType: "Offline",
        orderStatus: "In Progress",
        bills: { total: 30000, tax: 0, totalWithTax: 30000 },
        items: [
          // A free line (100%) for a Google Maps review, one at 25% off.
          line({ discountPercent: 100, price: 0 }),
          line({ discountPercent: 25, price: 30000 }),
          // Out of range percents are clamped.
          line({ discountPercent: 150, price: 0 }),
        ],
        paymentMethod: "Cash",
        allowNegativeStock: true,
      },
    });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    assert.deepEqual(
      order.body.data.items.map(({ pricePerQuantity, discountPercent, discountAmount, price }) => ({
        pricePerQuantity, discountPercent, discountAmount, price,
      })),
      [
        { pricePerQuantity: 0, discountPercent: 100, discountAmount: 40000, price: 0 },
        { pricePerQuantity: 15000, discountPercent: 25, discountAmount: 10000, price: 30000 },
        { pricePerQuantity: 0, discountPercent: 100, discountAmount: 40000, price: 0 },
      ]
    );
    // The HPP of a free line is still the cost of the menu.
    const [[hpp]] = await db.query(
      "SELECT MIN(hpp_cost) AS low, MAX(hpp_cost) AS high FROM order_items WHERE order_id = ?",
      [order.body.data.id]
    );
    assert.equal(Number(hpp.low), Number(hpp.high));
    assert.equal((await request("DELETE", `/api/order/${order.body.data.id}`, { as: "admin" })).status, 200);
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
