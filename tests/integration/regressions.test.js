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
    await db.query("UPDATE stock_raw_items SET stock = -1500 WHERE id = ?", [id]);

    const cogs = await request("PATCH", `/api/stock-item/${id}/cogs`, {
      as: "admin",
      body: { averageCost: 20 },
    });
    assert.equal(cogs.body.data.averageCost, 20);
    assert.equal(cogs.body.data.stockValue, 0, "the dialog preview shows Rp 0 as well");
  });

  it("cooks bahan setengah jadi from bahan baku and sells their portions", async () => {
    const addRaw = async (name, unit, stock, averageCost) => {
      const created = await request("POST", "/api/stock-item", {
        as: "admin",
        body: { name, category: "Bahan", unit, stock },
      });
      await request("PATCH", `/api/stock-item/${created.body.data.id}/cogs`, {
        as: "admin",
        body: { averageCost },
      });
      return created.body.data.id;
    };
    const rawRow = async (id) => {
      const [[row]] = await db.query(
        "SELECT stock, stock_value, unit_cost FROM stock_raw_items WHERE id = ?",
        [id]
      );
      return { stock: Number(row.stock), stockValue: Number(row.stock_value), unitCost: row.unit_cost };
    };
    const semiRow = async (id) => {
      const [[row]] = await db.query(
        "SELECT stock, stock_value, unit_cost, yield_quantity FROM stock_semi_items WHERE id = ?",
        [id]
      );
      return {
        stock: Number(row.stock),
        stockValue: Number(row.stock_value),
        unitCost: row.unit_cost,
        yieldQuantity: row.yield_quantity,
      };
    };
    const berasId = await addRaw("Beras Olahan", "kg", 10, 14000);

    // Nasi: 1 kg beras per recipe, one portion = 150 gr of cooked rice.
    const nasiBody = {
      name: "Nasi Olahan",
      unit: "porsi",
      portionSize: 150,
      components: [{ stockItemId: berasId, quantity: 1 }],
    };
    assert.equal(
      (await request("POST", "/api/stock-item/semi", { as: "cashier", body: nasiBody })).status,
      403
    );
    const created = await request("POST", "/api/stock-item/semi", { as: "admin", body: nasiBody });
    assert.equal(created.status, 201);
    const nasi = created.body.data;
    assert.equal(nasi.category, "Olahan");
    assert.equal(nasi.status, "HARUS MASAK");
    assert.equal(nasi.recipeCost, 14000);
    assert.deepEqual(nasi.components.map((c) => [c.name, c.quantity, c.unit, c.cost]), [
      ["Beras Olahan", 1, "kg", 14000],
    ]);

    // Separate lists, and names unique across both tables.
    const rawList = await request("GET", "/api/stock-item", { as: "cashier" });
    assert.ok(!rawList.body.data.some((item) => item.name === "Nasi Olahan"));
    const semiList = await request("GET", "/api/stock-item/semi", { as: "cashier" });
    assert.deepEqual(semiList.body.data.map((item) => item.name), ["Nasi Olahan"]);
    const rawNameClash = await request("POST", "/api/stock-item/semi", {
      as: "admin",
      body: { ...nasiBody, name: "Beras Olahan" },
    });
    assert.equal(rawNameClash.status, 409);
    const semiNameClash = await request("POST", "/api/stock-item", {
      as: "admin",
      body: { name: "Nasi Olahan", category: "Bahan", unit: "porsi" },
    });
    assert.equal(semiNameClash.status, 409);
    const unknownRaw = await request("POST", "/api/stock-item/semi", {
      as: "admin",
      body: { name: "Sambal Olahan", components: [{ stockItemId: 999999, quantity: 1 }] },
    });
    assert.equal(unknownRaw.status, 400, "a composition only uses existing bahan baku");

    const [[category]] = await db.query("SELECT id FROM categories ORDER BY id LIMIT 1");
    const menu = await request("POST", "/api/menu-item", {
      as: "admin",
      body: {
        categoryId: category.id,
        name: "Nasi Ayam Olahan",
        price: 20000,
        hppCost: 5000,
        ingredients: [{ semiItemId: nasi.id, quantity: 1 }],
      },
    });
    const menuItemId = menu.body.data.id;
    assert.deepEqual(
      menu.body.data.ingredients.map((i) => [i.stockItemId, i.semiItemId, i.name, i.unit]),
      [[null, nasi.id, "Nasi Olahan", "porsi"]]
    );
    // recipes keeps only bahan baku; semi lines go to stock_semi_item_menus.
    const [[lineCounts]] = await db.query(
      `SELECT (SELECT COUNT(*) FROM recipes WHERE menu_item_id = ?) AS raw_lines,
              (SELECT COUNT(*) FROM stock_semi_item_menus WHERE menu_item_id = ?) AS semi_lines`,
      [menuItemId, menuItemId]
    );
    assert.deepEqual({ ...lineCounts }, { raw_lines: 0, semi_lines: 1 });
    const menuHpp = async () => {
      const [[price]] = await db.query(
        "SELECT hpp_cost FROM menu_item_prices WHERE menu_item_id = ?",
        [menuItemId]
      );
      return Number(price.hpp_cost);
    };
    assert.equal(await menuHpp(), 5000, "manual HPP until the first cooking");

    // Catat Masak: 5 kg beras, 12.000 gr nasi / 150 gr = 80 portions.
    const cooked = await request("POST", `/api/stock-item/semi/${nasi.id}/productions`, {
      as: "cashier",
      body: { batchQuantity: 5, outputWeight: 12000 },
    });
    assert.equal(cooked.status, 201);
    assert.equal(cooked.body.data.lastProduction.portionQuantity, 80);
    assert.deepEqual(await semiRow(nasi.id), {
      stock: 80, stockValue: 70000, unitCost: 875, yieldQuantity: 16,
    });
    assert.deepEqual(await rawRow(berasId), { stock: 5, stockValue: 70000, unitCost: 14000 });
    assert.equal(await menuHpp(), 875);

    // A menu mixing both kinds keeps its line order; HPP = 2 x 875 + 5 x 10.
    const garamId = await addRaw("Garam Olahan", "gr", 1000, 10);
    const mixed = await request("POST", "/api/menu-item", {
      as: "admin",
      body: {
        categoryId: category.id,
        name: "Nasi Garam Olahan",
        price: 15000,
        ingredients: [{ semiItemId: nasi.id, quantity: 2 }, { stockItemId: garamId, quantity: 5 }],
      },
    });
    assert.deepEqual(
      mixed.body.data.ingredients.map((i) => [i.name, i.quantity]),
      [["Nasi Olahan", 2], ["Garam Olahan", 5]]
    );
    const [[mixedPrice]] = await db.query(
      "SELECT hpp_cost FROM menu_item_prices WHERE menu_item_id = ?",
      [mixed.body.data.id]
    );
    assert.equal(Number(mixedPrice.hpp_cost), 1800);

    const tooMuch = await request("POST", `/api/stock-item/semi/${nasi.id}/productions`, {
      as: "cashier",
      body: { batchQuantity: 10, outputWeight: 24000 },
    });
    assert.equal(tooMuch.status, 409);
    assert.match(tooMuch.body.message, /Beras Olahan butuh 10 kg, sisa 5 kg/);

    // Selling uses the nasi portions, not the beras.
    const orderBody = (quantity) => ({
      customerDetails: { name: "Olahan" },
      orderType: "Offline",
      orderStatus: "In Progress",
      bills: { total: 20000 * quantity, tax: 0, totalWithTax: 20000 * quantity },
      items: [{
        id: `${category.id}-${menuItemId}`,
        sourceMenuItemId: menuItemId,
        name: "Nasi Ayam Olahan",
        quantity,
        pricePerQuantity: 20000,
        price: 20000 * quantity,
      }],
      paymentMethod: "Cash",
    });
    const short = await request("POST", "/api/order", { as: "cashier", body: orderBody(100) });
    assert.equal(short.status, 409);
    assert.deepEqual(short.body.details.insufficientStock, [{
      semiItemId: nasi.id, name: "Nasi Olahan", stock: 80, required: 100, shortage: 20, unit: "porsi",
    }]);
    const order = await request("POST", "/api/order", { as: "cashier", body: orderBody(2) });
    assert.equal(order.status, 201);
    assert.equal((await semiRow(nasi.id)).stock, 78);
    assert.equal((await rawRow(berasId)).stock, 5);
    const [[soldCost]] = await db.query(
      `SELECT c.stock_item_id, c.semi_item_id, c.stock_item_name, c.quantity, c.unit, c.unit_cost, c.cost
       FROM order_item_costs c
       JOIN order_items oi ON oi.id = c.order_item_id
       WHERE oi.order_id = ?`,
      [order.body.data.id]
    );
    assert.deepEqual({ ...soldCost }, {
      stock_item_id: null,
      semi_item_id: nasi.id,
      stock_item_name: "Nasi Olahan",
      quantity: 1,
      unit: "porsi",
      unit_cost: 875,
      cost: 875,
    });

    // Semi items are not bought, and items in use cannot be deleted.
    const purchase = await request("POST", "/api/shopping/purchases", {
      as: "admin",
      body: {
        requestId: "olahan-purchase-0001",
        date: "2026-10-28",
        suplierName: "Toko Olahan",
        paymentMethod: "Cash",
        items: [{ itemName: "Nasi Olahan", quantity: 10, unit: "porsi", unitPrice: 1000 }],
      },
    });
    assert.equal(purchase.status, 400);
    assert.match(purchase.body.message, /bahan setengah jadi/);
    const deleteBeras = await request("DELETE", `/api/stock-item/${berasId}`, { as: "admin" });
    assert.equal(deleteBeras.status, 409);
    assert.match(deleteBeras.body.message, /bahan setengah jadi: Nasi Olahan/);
    const deleteNasi = await request("DELETE", `/api/stock-item/semi/${nasi.id}`, { as: "admin" });
    assert.equal(deleteNasi.status, 409);
    assert.match(deleteNasi.body.message, /resep menu: Nasi Ayam Olahan/);

    // A new beras price: the composition follows, the portions in stock keep
    // their cost until the next cooking (moving average, as in belanja).
    await request("PATCH", `/api/stock-item/${berasId}/cogs`, {
      as: "admin",
      body: { averageCost: 16000 },
    });
    const [[component]] = await db.query(
      "SELECT cost FROM stock_semi_item_recipes WHERE semi_item_id = ?",
      [nasi.id]
    );
    assert.equal(component.cost, 16000);
    assert.equal((await semiRow(nasi.id)).unitCost, 875);

    // Counted directly: 1 kg, 15 portions. 68.250 + 16.000 over 93 portions.
    const counted = await request("POST", `/api/stock-item/semi/${nasi.id}/productions`, {
      as: "admin",
      body: { batchQuantity: 1, portionQuantity: 15, note: "dibagi langsung" },
    });
    assert.equal(counted.status, 201);
    assert.deepEqual(await semiRow(nasi.id), {
      stock: 93, stockValue: 84250, unitCost: 906, yieldQuantity: 15,
    });
    assert.equal(await menuHpp(), 906);

    const history = await request("GET", `/api/stock-item/semi/${nasi.id}/productions`, { as: "cashier" });
    assert.deepEqual(
      history.body.data.map((p) => [p.batchQuantity, p.outputWeight, p.portionQuantity, p.cost, p.unitCost]),
      [[1, null, 15, 16000, 1067], [5, 12000, 80, 70000, 875]]
    );
    assert.deepEqual(history.body.data[1].items, [{
      stockItemId: berasId, name: "Beras Olahan", quantity: 5, unit: "kg", unitCost: 14000, cost: 70000,
    }]);

    // Undo: only the latest cooking, and only while its portions are in stock.
    const [latest, first] = history.body.data;
    assert.equal(
      (await request("DELETE", `/api/stock-item/semi/productions/${first.id}`, { as: "admin" })).status,
      409
    );
    assert.equal(
      (await request("DELETE", `/api/stock-item/semi/productions/${latest.id}`, { as: "cashier" })).status,
      403
    );
    assert.equal(
      (await request("DELETE", `/api/stock-item/semi/productions/${latest.id}`, { as: "admin" })).status,
      200
    );
    assert.deepEqual(await semiRow(nasi.id), {
      stock: 78, stockValue: 68250, unitCost: 875, yieldQuantity: 16,
    });
    assert.equal((await rawRow(berasId)).stock, 5);
    assert.equal(await menuHpp(), 875);
    const usedUp = await request("DELETE", `/api/stock-item/semi/productions/${first.id}`, { as: "admin" });
    assert.equal(usedUp.status, 409, "2 of its 80 portions were sold");

    // Leftovers counted by hand: the value follows the exact unit cost.
    const adjusted = await request("PATCH", `/api/stock-item/semi/${nasi.id}/stock`, {
      as: "cashier",
      body: { stock: 70 },
    });
    assert.equal(adjusted.status, 200);
    assert.equal(adjusted.body.data.stockValue, 61250);

    // ...and the 8 missing portions are kept as kerugian.
    const wasteRows = async () =>
      (await request("GET", `/api/stock-item/semi/wastes?semiItemId=${nasi.id}`, { as: "cashier" }))
        .body.data.wastes.map((w) => [w.quantity, w.cost, w.reason]);
    assert.deepEqual(await wasteRows(), [[8, 7000, "Penyesuaian"]]);

    // Thrown away during the day: 5 spoiled portions at Rp 875.
    const spoiled = await request("POST", `/api/stock-item/semi/${nasi.id}/wastes`, {
      as: "cashier",
      body: { quantity: 5, reason: "Basi", note: "kena hujan" },
    });
    assert.equal(spoiled.status, 201);
    assert.deepEqual([spoiled.body.data.stock, spoiled.body.data.stockValue], [65, 56875]);
    assert.deepEqual(await wasteRows(), [[5, 4375, "Basi"], [8, 7000, "Penyesuaian"]]);
    const tooMany = await request("POST", `/api/stock-item/semi/${nasi.id}/wastes`, {
      as: "cashier",
      body: { quantity: 66, reason: "Tumpah" },
    });
    assert.equal(tooMany.status, 409);
    const badReason = await request("POST", `/api/stock-item/semi/${nasi.id}/wastes`, {
      as: "cashier",
      body: { quantity: 1, reason: "Sisa akhir hari" },
    });
    assert.equal(badReason.status, 400, "the system writes off leftovers itself");

    // Undo: admins, latest write-off only.
    const [latestWaste, olderWaste] = (
      await request("GET", `/api/stock-item/semi/wastes?semiItemId=${nasi.id}`, { as: "admin" })
    ).body.data.wastes;
    assert.equal(
      (await request("DELETE", `/api/stock-item/semi/wastes/${olderWaste.id}`, { as: "admin" })).status,
      409
    );
    assert.equal(
      (await request("DELETE", `/api/stock-item/semi/wastes/${latestWaste.id}`, { as: "cashier" })).status,
      403
    );
    assert.equal(
      (await request("DELETE", `/api/stock-item/semi/wastes/${latestWaste.id}`, { as: "admin" })).status,
      200
    );
    assert.deepEqual(await semiRow(nasi.id), {
      stock: 70, stockValue: 61250, unitCost: 875, yieldQuantity: 16,
    });

    // Closing a past day keeps portions cooked after it (all 70 were cooked
    // today); closing today writes the leftover off and Nasi starts from 0.
    const todayDate = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    const yesterday = new Date(`${todayDate}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const pastRecap = await request("POST", "/api/recap/daily", {
      as: "admin",
      body: { recapDate: yesterday.toISOString().slice(0, 10) },
    });
    assert.equal(pastRecap.status, 201);
    assert.deepEqual(pastRecap.body.data.writtenOff, []);
    assert.equal((await semiRow(nasi.id)).stock, 70);

    const todayRecap = await request("POST", "/api/recap/daily", {
      as: "admin",
      body: { recapDate: todayDate },
    });
    assert.equal(todayRecap.status, 201);
    assert.deepEqual(todayRecap.body.data.writtenOff, [
      { semiItemId: nasi.id, name: "Nasi Olahan", quantity: 70, cost: 61250 },
    ]);
    assert.deepEqual(await semiRow(nasi.id), {
      stock: 0, stockValue: 0, unitCost: 875, yieldQuantity: 16,
    });
    const todayWastes = await request("GET", `/api/stock-item/semi/wastes?from=${todayDate}&to=${todayDate}`, {
      as: "admin",
    });
    assert.deepEqual(todayWastes.body.data.wastes[0], {
      ...todayWastes.body.data.wastes[0],
      wasteDate: todayDate,
      quantity: 70,
      cost: 61250,
      reason: "Sisa akhir hari",
    });
    assert.deepEqual(todayWastes.body.data.dailyTotals, [{ date: todayDate, cost: 68250, entries: 2 }]);

    // Items that keep (Sambal) can opt out of the daily reset.
    const kept = await request("POST", "/api/stock-item/semi", {
      as: "admin",
      body: { name: "Sambal Olahan", resetDaily: false, components: [{ stockItemId: garamId, quantity: 10 }] },
    });
    assert.equal(kept.body.data.resetDaily, false);
    assert.equal(nasi.resetDaily, true);
  });
});
