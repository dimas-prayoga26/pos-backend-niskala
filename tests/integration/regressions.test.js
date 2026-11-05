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

// A Buang as multipart: its fields and photos (bukti foto).
const wasteForm = (fields, photos = 1) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  for (let index = 0; index < photos; index += 1) {
    form.append("files", new Blob([TINY_PNG], { type: "image/png" }), `buang-${index + 1}.png`);
  }
  return form;
};

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
        "SELECT quantity FROM menu_item_recipes WHERE stock_item_id = ?",
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

    const [[recipe]] = await db.query("SELECT cost FROM menu_item_recipes WHERE stock_item_id = ?", [stockItemId]);
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
    const [[recipe]] = await db.query("SELECT cost FROM menu_item_recipes WHERE menu_item_id = ?", [menuItemId]);
    assert.equal(recipe.cost, 2500);
    assert.deepEqual(await soldCosts(), atSale);

    // The Rekap shows the same rincian: per portion, and for both portions sold.
    const [[sold]] = await db.query("SELECT id FROM order_items WHERE order_id = ?", [order.body.data.id]);
    for (const as of ["admin", "cashier"]) {
      const rincian = await request("GET", `/api/order/items/${sold.id}/costs`, { as });
      assert.equal(rincian.status, 200, JSON.stringify(rincian.body));
      const { lines, ...item } = rincian.body.data;
      assert.deepEqual(
        { name: item.name, quantity: item.quantity, hppCost: item.hppCost, totalCost: item.totalCost, hppStatus: item.hppStatus },
        { name: "Latte Snapshot", quantity: 2, hppCost: 2000, totalCost: 4000, hppStatus: "closed" }
      );
      assert.deepEqual(
        lines.map(({ name, hppType, quantity, unit, unitCost, cost, totalQuantity, totalCost }) => ({
          name, hppType, quantity, unit, unitCost, cost, totalQuantity, totalCost,
        })),
        [{ name: "Susu Snapshot", hppType: "standar", quantity: 100, unit: "ml", unitCost: 20, cost: 2000, totalQuantity: 200, totalCost: 4000 }]
      );
    }
    assert.equal((await request("GET", "/api/order/items/999999/costs", { as: "admin" })).status, 404);
    assert.equal((await request("GET", "/api/order/items/abc/costs", { as: "admin" })).status, 404);
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

    const halved = await request("PUT", `/api/stock-item/${id}`, {
      as: "admin",
      body: { name: "Matcha Nilai", category: "Bahan", unit: "gr", stock: 800 },
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

  it("Modul 3: throws bahan baku away with a bukti foto and lists the kerugian of both kinds", async () => {
    const created = await request("POST", "/api/stock-item", {
      as: "admin",
      body: { name: "Susu Buang", category: "Bahan", unit: "ml", stock: 1000 },
    });
    const id = created.body.data.id;
    await request("PATCH", `/api/stock-item/${id}/cogs`, { as: "admin", body: { averageCost: 20 } });
    const rawRow = async () => {
      const [[row]] = await db.query("SELECT stock, stock_value FROM stock_raw_items WHERE id = ?", [id]);
      return [Number(row.stock), Number(row.stock_value)];
    };
    const buang = (as, body) => request("POST", `/api/stock-item/${id}/wastes`, { as, body });

    // Kasir must attach a real photo; nothing leaves stock until then.
    assert.equal((await buang("cashier", { quantity: 250, reason: "Basi" })).status, 400);
    const fake = new FormData();
    fake.append("quantity", "250");
    fake.append("reason", "Basi");
    fake.append("files", new Blob(["not an image"], { type: "image/jpeg" }), "susu.jpg");
    assert.equal((await buang("cashier", fake)).status, 400);
    assert.equal((await buang("cashier", wasteForm({ quantity: 250, reason: "Tumpah" }))).status, 400);
    assert.deepEqual(await rawRow(), [1000, 20000]);

    // 250 ml basi at Rp 20 per ml: Rp 5.000 leaves the stock value.
    const spoiled = await buang("cashier", wasteForm({ quantity: 250, reason: "Basi", note: "kulkas mati" }, 2));
    assert.equal(spoiled.status, 201);
    assert.deepEqual(await rawRow(), [750, 15000]);
    // Admins may skip the photo; more than the stock is refused.
    assert.equal((await buang("admin", { quantity: 751, reason: "Expired" })).status, 409);
    assert.equal((await buang("admin", { quantity: 50, reason: "Jatuh" })).status, 201);
    assert.deepEqual(await rawRow(), [700, 14000]);

    // Bahan baku whose stock is not counted cannot be thrown away.
    const unlimited = await request("POST", "/api/stock-item", {
      as: "admin",
      body: { name: "Air Galon Bebas", category: "Bahan", unit: "ml", stock: 0, isUnlimited: true },
    });
    const freeWaste = await request("POST", `/api/stock-item/${unlimited.body.data.id}/wastes`, {
      as: "admin",
      body: { quantity: 1, reason: "Basi" },
    });
    assert.equal(freeWaste.status, 400);

    // Riwayat Kerugian: bahan baku and bahan olahan together, newest
    // first, with the day's total over both kinds.
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    const history = (await request("GET", `/api/stock-item/wastes?from=${today}&to=${today}`, { as: "cashier" })).body.data;
    const susu = history.wastes.filter((waste) => waste.kind === "raw" && waste.itemId === id);
    assert.deepEqual(
      susu.map((waste) => [waste.quantity, waste.unit, waste.cost, waste.reason, waste.note, waste.photos.length]),
      [[50, "ml", 1000, "Jatuh", "", 0], [250, "ml", 5000, "Basi", "kulkas mati", 2]]
    );
    assert.equal(
      history.dailyTotals.find((day) => day.date === today).cost,
      history.wastes.reduce((total, waste) => total + waste.cost, 0)
    );
    // Each tab's Riwayat Kerugian lists its own kind only.
    const ofKind = async (kind) =>
      (await request("GET", `/api/stock-item/wastes?kind=${kind}`, { as: "cashier" })).body.data;
    const rawOnly = await ofKind("raw");
    assert.ok(rawOnly.wastes.length >= 2 && rawOnly.wastes.every((waste) => waste.kind === "raw"));
    assert.equal(
      rawOnly.dailyTotals.find((day) => day.date === today).cost,
      rawOnly.wastes.filter((waste) => waste.wasteDate === today).reduce((total, waste) => total + waste.cost, 0)
    );
    assert.ok((await ofKind("semi")).wastes.every((waste) => waste.kind === "semi"));
    assert.equal((await request("GET", "/api/stock-item/wastes?kind=lainnya", { as: "cashier" })).status, 400);

    // Bukti foto: logged-in users only.
    const [photo] = susu[1].photos;
    assert.equal((await fetch(`${server.baseUrl}${photo.url}`)).status, 401);
    const served = await fetch(`${server.baseUrl}${photo.url}`, { headers: { Cookie: cookies.cashier } });
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), TINY_PNG);
    assert.equal((await request("GET", "/api/stock-item/waste-photos/lainnya/1", { as: "cashier" })).status, 404);

    // Undo: admins, latest write-off of the item only; its photos go too.
    const undo = (as, wasteId) => request("DELETE", `/api/stock-item/wastes/${wasteId}`, { as });
    assert.equal((await undo("admin", susu[1].id)).status, 409);
    assert.equal((await undo("cashier", susu[0].id)).status, 403);
    assert.equal((await undo("admin", susu[0].id)).status, 200);
    assert.deepEqual(await rawRow(), [750, 15000]);
    assert.equal((await undo("admin", susu[1].id)).status, 200);
    assert.deepEqual(await rawRow(), [1000, 20000]);
    assert.equal((await request("GET", photo.url, { as: "cashier" })).status, 404);
  });

  it("cooks bahan olahan from bahan baku and sells their portions", async () => {
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
      `SELECT (SELECT COUNT(*) FROM menu_item_recipes WHERE menu_item_id = ?) AS raw_lines,
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
      body: { items: [{ stockItemId: berasId, quantity: 5 }], outputWeight: 12000 },
    });
    assert.equal(cooked.status, 201);
    assert.equal(cooked.body.data.lastProduction.portionQuantity, 80);
    assert.deepEqual(await semiRow(nasi.id), {
      stock: 80, stockValue: 70000, unitCost: 875, yieldQuantity: 80,
    });
    // The beras used is the next Catat Masak's suggestion.
    assert.deepEqual(cooked.body.data.components.map((c) => [c.quantity, c.cost]), [[5, 70000]]);
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
      body: { items: [{ stockItemId: berasId, quantity: 10 }], outputWeight: 24000 },
    });
    assert.equal(tooMuch.status, 409);
    assert.match(tooMuch.body.message, /Beras Olahan butuh 10 kg, sisa 5 kg/);
    // Catat Masak needs the bahan used, and only bahan of its composition.
    const cook = (body) =>
      request("POST", `/api/stock-item/semi/${nasi.id}/productions`, { as: "cashier", body });
    const noItems = await cook({ items: [{ stockItemId: berasId, quantity: 0 }], portionQuantity: 10 });
    assert.equal(noItems.status, 400);
    assert.equal(noItems.body.message, "Isi jumlah bahan baku yang dipakai.");
    const notComposed = await cook({ items: [{ stockItemId: garamId, quantity: 5 }], portionQuantity: 10 });
    assert.equal(notComposed.status, 400);
    assert.match(notComposed.body.message, /bukan komposisi Nasi Olahan/);
    assert.equal((await rawRow(garamId)).stock, 1000);

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
    // Bahan olahan never block a sale (Modul 2: see the HPP pending test).
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
    assert.match(purchase.body.message, /bahan olahan/);
    const deleteBeras = await request("DELETE", `/api/stock-item/${berasId}`, { as: "admin" });
    assert.equal(deleteBeras.status, 409);
    assert.match(deleteBeras.body.message, /bahan olahan: Nasi Olahan/);
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
    assert.equal(component.cost, 80000, "the latest 5 kg at the new price");
    assert.equal((await semiRow(nasi.id)).unitCost, 875);

    // Counted directly: 1 kg, 15 portions. 68.250 + 16.000 over 93 portions.
    // Its Takaran 1 Porsi becomes the item's portion size.
    const counted = await request("POST", `/api/stock-item/semi/${nasi.id}/productions`, {
      as: "admin",
      body: { items: [{ stockItemId: berasId, quantity: 1 }], portionQuantity: 15, portionSize: 160, note: "dibagi langsung" },
    });
    assert.equal(counted.status, 201);
    assert.equal(counted.body.data.portionSize, 160);
    assert.deepEqual(await semiRow(nasi.id), {
      stock: 93, stockValue: 84250, unitCost: 906, yieldQuantity: 15,
    });
    assert.equal(await menuHpp(), 906);

    const history = await request("GET", `/api/stock-item/semi/${nasi.id}/productions`, { as: "cashier" });
    assert.deepEqual(
      history.body.data.map((p) => [p.batchQuantity, p.outputWeight, p.portionQuantity, p.cost, p.unitCost]),
      [[1, null, 15, 16000, 1067], [1, 12000, 80, 70000, 875]]
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
      stock: 78, stockValue: 68250, unitCost: 875, yieldQuantity: 80,
    });
    assert.equal((await rawRow(berasId)).stock, 5);
    assert.equal(await menuHpp(), 875);
    const usedUp = await request("DELETE", `/api/stock-item/semi/productions/${first.id}`, { as: "admin" });
    assert.equal(usedUp.status, 409, "2 of its 80 portions were sold");

    const wasteRows = async () =>
      (await request("GET", `/api/stock-item/semi/wastes?semiItemId=${nasi.id}`, { as: "cashier" }))
        .body.data.wastes.map((w) => [w.quantity, w.cost, w.reason]);
    assert.deepEqual(await wasteRows(), []);

    // Thrown away during the day: 5 spoiled portions at Rp 875. Kasir must
    // attach a photo of them.
    const noPhoto = await request("POST", `/api/stock-item/semi/${nasi.id}/wastes`, {
      as: "cashier",
      body: { quantity: 5, reason: "Basi" },
    });
    assert.equal(noPhoto.status, 400);
    const spoiled = await request("POST", `/api/stock-item/semi/${nasi.id}/wastes`, {
      as: "cashier",
      body: wasteForm({ quantity: 5, reason: "Basi", note: "kena hujan" }),
    });
    assert.equal(spoiled.status, 201);
    assert.deepEqual([spoiled.body.data.stock, spoiled.body.data.stockValue], [73, 63875]);
    assert.deepEqual(await wasteRows(), [[5, 4375, "Basi"]]);
    const tooMany = await request("POST", `/api/stock-item/semi/${nasi.id}/wastes`, {
      as: "admin",
      body: { quantity: 74, reason: "Jatuh" },
    });
    assert.equal(tooMany.status, 409);
    const badReason = await request("POST", `/api/stock-item/semi/${nasi.id}/wastes`, {
      as: "cashier",
      body: { quantity: 1, reason: "Sisa akhir hari" },
    });
    assert.equal(badReason.status, 400, "the system writes off leftovers itself");

    // Undo: admins, latest write-off only. An admin drops 1 more (no photo
    // needed), so the spoiled ones are no longer the latest.
    const dropped = await request("POST", `/api/stock-item/semi/${nasi.id}/wastes`, {
      as: "admin",
      body: { quantity: 1, reason: "Jatuh" },
    });
    assert.equal(dropped.status, 201);
    const [droppedWaste, latestWaste] = (
      await request("GET", `/api/stock-item/semi/wastes?semiItemId=${nasi.id}`, { as: "admin" })
    ).body.data.wastes;
    assert.equal(
      (await request("DELETE", `/api/stock-item/semi/wastes/${latestWaste.id}`, { as: "admin" })).status,
      409
    );
    assert.equal(
      (await request("DELETE", `/api/stock-item/semi/wastes/${droppedWaste.id}`, { as: "admin" })).status,
      200
    );
    assert.equal(
      (await request("DELETE", `/api/stock-item/semi/wastes/${latestWaste.id}`, { as: "cashier" })).status,
      403
    );
    const [photo] = latestWaste.photos;
    assert.equal((await request("GET", photo.url, { as: "cashier" })).status, 200);
    assert.equal(
      (await request("DELETE", `/api/stock-item/semi/wastes/${latestWaste.id}`, { as: "admin" })).status,
      200
    );
    assert.deepEqual(await semiRow(nasi.id), {
      stock: 78, stockValue: 68250, unitCost: 875, yieldQuantity: 80,
    });
    assert.equal((await request("GET", photo.url, { as: "cashier" })).status, 404, "its photo goes with it");

    // Closing a past day keeps portions cooked after it (all 78 were cooked
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
    assert.equal((await semiRow(nasi.id)).stock, 78);

    const todayRecap = await request("POST", "/api/recap/daily", {
      as: "admin",
      body: { recapDate: todayDate },
    });
    assert.equal(todayRecap.status, 201);
    assert.deepEqual(todayRecap.body.data.writtenOff, [
      { semiItemId: nasi.id, name: "Nasi Olahan", quantity: 78, cost: 68250 },
    ]);
    assert.deepEqual(await semiRow(nasi.id), {
      stock: 0, stockValue: 0, unitCost: 875, yieldQuantity: 80,
    });
    const todayWastes = await request("GET", `/api/stock-item/semi/wastes?from=${todayDate}&to=${todayDate}`, {
      as: "admin",
    });
    assert.deepEqual(todayWastes.body.data.wastes[0], {
      ...todayWastes.body.data.wastes[0],
      wasteDate: todayDate,
      quantity: 78,
      cost: 68250,
      reason: "Sisa akhir hari",
    });
    // Biaya Wastage of the day: the leftover only.
    assert.deepEqual(todayWastes.body.data.dailyTotals, [{ date: todayDate, cost: 68250, entries: 1 }]);

    // Items that keep (Sambal) can opt out of the daily reset. The form lists
    // the bahan only: no quantity, unit or portion size.
    const kept = await request("POST", "/api/stock-item/semi", {
      as: "admin",
      body: { name: "Sambal Olahan", resetDaily: false, components: [{ stockItemId: garamId }] },
    });
    assert.equal(kept.status, 201);
    assert.equal(kept.body.data.resetDaily, false);
    assert.equal(nasi.resetDaily, true);
    assert.deepEqual([kept.body.data.unit, kept.body.data.portionSize], ["porsi", 0]);
    assert.deepEqual(kept.body.data.components.map((c) => [c.name, c.quantity]), [["Garam Olahan", 0]]);
    // Ubah keeps the latest quantities and the portion size.
    const edited = await request("PUT", `/api/stock-item/semi/${nasi.id}`, {
      as: "admin",
      body: { name: "Nasi Olahan", components: [{ stockItemId: berasId }, { stockItemId: garamId }] },
    });
    assert.equal(edited.status, 200);
    assert.deepEqual(edited.body.data.components.map((c) => [c.name, c.quantity]), [
      ["Beras Olahan", 1],
      ["Garam Olahan", 0],
    ]);
    assert.deepEqual([edited.body.data.unit, edited.body.data.portionSize], ["porsi", 160]);
    const noBahan = await request("PUT", `/api/stock-item/semi/${nasi.id}`, {
      as: "admin",
      body: { name: "Nasi Olahan", components: [] },
    });
    assert.equal(noBahan.status, 400);
    assert.equal(noBahan.body.message, "Pilih minimal satu bahan baku.");
  });

  it("posts saldo keluar for a purchase and serves its bukti nota only to logged-in users", async () => {
    // Kasir see the sources to fill in a draft, never their saldo.
    const cashierList = await request("GET", "/api/payment-source", { as: "cashier" });
    assert.equal(cashierList.status, 200);
    assert.deepEqual(cashierList.body.data.map((source) => source.balance), [null, null, null]);
    assert.equal((await request("GET", "/api/payment-source/1/mutations", { as: "cashier" })).status, 403);
    const sources = await request("GET", "/api/payment-source", { as: "admin" });
    assert.deepEqual(sources.body.data.map((source) => source.name), ["Kasir (Tunai)", "Rekening Penjualan", "Niskala"]);
    const kasir = sources.body.data[0];
    const topUp = await request("POST", `/api/payment-source/${kasir.id}/mutations`, {
      as: "admin",
      body: { type: "in", amount: 100000, date: "2026-10-01", note: "Modal awal" },
    });
    assert.equal(topUp.status, 201);
    assert.equal(topUp.body.data.balance, 100000);

    const purchase = await request("POST", "/api/shopping/purchases", {
      as: "admin",
      body: {
        requestId: "payment-source-purchase-0001",
        date: "2026-10-02",
        suplierName: "Toko Saldo",
        paymentSourceId: kasir.id,
        items: [{ itemName: "Gula Saldo", quantity: 1000, unit: "gr", unitPrice: 15 }],
      },
    });
    assert.equal(purchase.status, 201);
    assert.equal(purchase.body.data.balance, 85000);
    const mutations = await request("GET", `/api/payment-source/${kasir.id}/mutations`, { as: "admin" });
    assert.deepEqual(
      mutations.body.data.mutations.map((row) => [row.date, row.amountIn, row.amountOut, row.balanceAfter, row.userName]),
      [["2026-10-02", 0, 15000, 85000, "admin"], ["2026-10-01", 100000, 0, 100000, "admin"]]
    );

    const purchaseId = purchase.body.data.id;
    const asCashier = new FormData();
    asCashier.append("files", new Blob([TINY_PNG], { type: "image/png" }), "nota.png");
    assert.equal((await request("POST", `/api/shopping/purchases/${purchaseId}/attachments`, { as: "cashier", body: asCashier })).status, 403);
    const fake = new FormData();
    fake.append("files", new Blob(["not an image at all"], { type: "image/jpeg" }), "nota.jpg");
    const rejected = await request("POST", `/api/shopping/purchases/${purchaseId}/attachments`, { as: "admin", body: fake });
    assert.equal(rejected.status, 400);
    const tooMany = new FormData();
    for (let index = 0; index < 6; index += 1) {
      tooMany.append("files", new Blob([TINY_PNG], { type: "image/png" }), `nota-${index}.png`);
    }
    assert.equal((await request("POST", `/api/shopping/purchases/${purchaseId}/attachments`, { as: "admin", body: tooMany })).status, 400);

    const form = new FormData();
    form.append("files", new Blob([TINY_PNG], { type: "image/png" }), "nota.png");
    const uploaded = await request("POST", `/api/shopping/purchases/${purchaseId}/attachments`, { as: "admin", body: form });
    assert.equal(uploaded.status, 201);
    const [attachment] = uploaded.body.data;
    assert.equal(attachment.name, "nota.png");

    const anonymous = await fetch(`${server.baseUrl}${attachment.url}`);
    assert.equal(anonymous.status, 401);
    const photo = await fetch(`${server.baseUrl}${attachment.url}`, { headers: { Cookie: cookies.cashier } });
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get("content-type"), "image/png");
    assert.equal(photo.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), TINY_PNG);
    // Receipts are never reachable through the public /uploads folder.
    assert.equal((await fetch(`${server.baseUrl}/uploads/../storage/purchase-receipts`)).status, 404);

    const list = await request("GET", "/api/shopping/purchases?search=Gula%20Saldo", { as: "cashier" });
    assert.deepEqual(list.body.data.itemGroups[0].histories[0].attachments.map((row) => row.id), [attachment.id]);
    assert.equal(list.body.data.itemGroups[0].histories[0].paymentMethod, "Kasir (Tunai)");

    assert.equal((await request("DELETE", `/api/shopping/purchase-attachments/${attachment.id}`, { as: "cashier" })).status, 403);
    const removed = await request("DELETE", `/api/shopping/purchase-attachments/${attachment.id}`, { as: "admin" });
    assert.equal(removed.status, 200);
    assert.equal((await request("GET", attachment.url, { as: "admin" })).status, 404);
  });

  it("keeps the merk of each purchase line, new or chosen, for bahan baku and lainnya", async () => {
    const buy = (path, requestId, items, extra = {}) =>
      request("POST", path, {
        as: "admin",
        body: { requestId, date: "2026-10-03", suplierName: "Toko Merk", paymentMethod: "Cash", items, ...extra },
      });
    const notasOf = async (path, search) =>
      (await request("GET", `${path}/notas?search=${encodeURIComponent(search)}`, { as: "admin" })).body.data.notas;
    const merkList = async () => (await request("GET", "/api/shopping/merks", { as: "cashier" })).body.data;
    const merkNamed = async (name) => (await merkList()).find((merk) => merk.name === name);

    // A new merk is created with the nota and listed for the form.
    const first = await buy("/api/shopping/purchases", "merk-purchase-000001", [
      { itemName: "Susu Merk", merkName: "Indomilk", quantity: 1000, unit: "ml", unitPrice: 20 },
    ]);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const indomilk = (await merkList()).find((merk) => merk.name === "Indomilk");
    assert.ok(indomilk, "Indomilk is listed");

    // Another merk of the same bahan, a chosen merk, and a line without one.
    const second = await buy("/api/shopping/purchases", "merk-purchase-000002", [
      { itemName: "Susu Merk", merkName: "Ultra", quantity: 1000, unit: "ml", unitPrice: 30 },
      { itemName: "Gula Merk", merkId: indomilk.id, quantity: 500, unit: "gr", unitPrice: 10 },
      { itemName: "Garam Merk", quantity: 100, unit: "gr", unitPrice: 5 },
    ]);
    assert.equal(second.status, 201, JSON.stringify(second.body));
    const [nota] = await notasOf("/api/shopping/purchases", "Garam Merk");
    assert.deepEqual(
      nota.items.map((item) => [item.itemName, item.merkName ?? null]),
      [["Susu Merk", "Ultra"], ["Gula Merk", "Indomilk"], ["Garam Merk", null]]
    );
    // The same name in another case is the same merk.
    const again = await buy("/api/shopping/purchases", "merk-purchase-000003", [
      { itemName: "Garam Merk", merkName: "indomilk", quantity: 100, unit: "gr", unitPrice: 5 },
    ]);
    assert.equal(again.status, 201);
    assert.equal((await merkList()).filter((merk) => merk.name.toLowerCase() === "indomilk").length, 1);

    // COGS stays one average over both merk; each purchase shows its merk.
    const perItem = (await request("GET", `/api/shopping/purchases?search=${encodeURIComponent("Susu Merk")}`, { as: "admin" })).body.data;
    const susu = perItem.itemGroups.find((group) => group.itemName === "Susu Merk");
    assert.deepEqual(
      susu.histories.map((row) => [row.merkName, row.stockAverageCost]),
      [["Ultra", 25], ["Indomilk", 20]]
    );
    assert.equal(susu.averageCost, 25);
    // The history is searched by merk too.
    assert.deepEqual((await notasOf("/api/shopping/purchases", "Ultra")).map((row) => row.id), [second.body.data.id]);

    // A merk that does not exist, or both an id and a name, saves nothing.
    for (const [requestId, line] of [
      ["merk-purchase-bad-001", { merkId: 999999 }],
      ["merk-purchase-bad-002", { merkId: indomilk.id, merkName: "Lain" }],
    ]) {
      const bad = await buy("/api/shopping/purchases", requestId, [
        { itemName: "Kopi Merk", quantity: 100, unit: "gr", unitPrice: 50, ...line },
      ]);
      assert.equal(bad.status, 400, JSON.stringify(line));
    }
    assert.equal((await notasOf("/api/shopping/purchases", "Kopi Merk")).length, 0);

    // Admins change the merk of a posted line, keep it, or drop it.
    const garam = nota.items.find((item) => item.itemName === "Garam Merk");
    const editLine = (body) =>
      request("PUT", `/api/shopping/purchase-items/${garam.id}`, {
        as: "admin",
        body: { quantity: 100, unit: "gr", unitPrice: 5, ...body },
      });
    const merkOfGaram = async () =>
      (await notasOf("/api/shopping/purchases", "Garam Merk"))
        .find((row) => row.id === nota.id)
        .items.find((item) => item.id === garam.id).merkName ?? null;
    assert.equal((await editLine({ merkName: "Refina" })).status, 200);
    assert.equal(await merkOfGaram(), "Refina");
    assert.equal((await editLine({})).status, 200);
    assert.equal(await merkOfGaram(), "Refina");
    assert.equal((await editLine({ merkId: "", merkName: "" })).status, 200);
    assert.equal(await merkOfGaram(), null);

    // A draft keeps its merk until it is posted.
    const draft = await request("POST", "/api/shopping/purchases", {
      as: "cashier",
      body: {
        requestId: "merk-purchase-draft-01",
        date: "2026-10-04",
        suplierName: "Toko Merk",
        paymentMethod: "Cash",
        status: "draft",
        items: [{ itemName: "Teh Merk", merkName: "Sariwangi", quantity: 25, unit: "pcs", unitPrice: 400 }],
      },
    });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    const drafts = (await request("GET", "/api/shopping/purchases/drafts", { as: "cashier" })).body.data;
    const [draftLine] = drafts.find((row) => row.id === draft.body.data.id).items;
    assert.equal(draftLine.merkName, "Sariwangi");
    // Not bought yet: a draft does not list its barang under the merk.
    assert.deepEqual((await merkNamed("Sariwangi")).rawItemIds, []);
    const posted = await request("PUT", `/api/shopping/purchases/${draft.body.data.id}`, {
      as: "admin",
      body: {
        date: "2026-10-04",
        suplierName: "Toko Merk",
        paymentMethod: "Cash",
        items: [{ itemName: "Teh Merk", merkId: draftLine.merkId, quantity: 25, unit: "pcs", unitPrice: 400 }],
      },
    });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    assert.equal((await notasOf("/api/shopping/purchases", "Teh Merk"))[0].items[0].merkName, "Sariwangi");

    // Barang Lainnya take a merk the same way.
    const supply = await buy("/api/shopping/supply-purchases", "merk-supply-0000001", [
      { itemName: "Pulpen Merk", category: "Lain-lain", merkName: "Joyko", quantity: 12, unitPrice: 2000 },
    ]);
    assert.equal(supply.status, 201, JSON.stringify(supply.body));
    assert.equal((await notasOf("/api/shopping/supply-purchases", "Joyko"))[0].items[0].merkName, "Joyko");
    const supplyGroups = (await request("GET", `/api/shopping/supply-purchases?search=${encodeURIComponent("Pulpen Merk")}`, { as: "admin" })).body.data.itemGroups;
    assert.equal(supplyGroups[0].histories[0].merkName, "Joyko");

    // Each merk lists the barang it was bought for, so the form offers them first.
    const idOf = (name) => nota.items.find((item) => item.itemName === name).stockItemId;
    const ascending = (ids) => [...ids].sort((a, b) => a - b);
    assert.deepEqual(await merkNamed("Indomilk"), {
      id: indomilk.id,
      name: "Indomilk",
      rawItemIds: ascending([idOf("Susu Merk"), idOf("Gula Merk"), idOf("Garam Merk")]),
      supplyItemIds: [],
    });
    assert.deepEqual((await merkNamed("Ultra")).rawItemIds, [idOf("Susu Merk")]);
    // Dropped from its only line: no barang.
    assert.deepEqual((await merkNamed("Refina")).rawItemIds, []);
    const [teh] = (await notasOf("/api/shopping/purchases", "Teh Merk"))[0].items;
    assert.deepEqual((await merkNamed("Sariwangi")).rawItemIds, [teh.stockItemId]);
    const [pulpen] = (await notasOf("/api/shopping/supply-purchases", "Joyko"))[0].items;
    assert.deepEqual(await merkNamed("Joyko"), {
      id: pulpen.merkId,
      name: "Joyko",
      rawItemIds: [],
      supplyItemIds: [pulpen.supplyItemId],
    });
  });

  it("rejects a second bahan baku with the same name with 409 instead of 500", async () => {
    const body = { name: "Sirup Uji", category: "Sirup", unit: "ml", stock: 0, minimumStock: 100 };
    const created = await request("POST", "/api/stock-item", { as: "admin", body });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.name, "Sirup Uji");

    const duplicate = await request("POST", "/api/stock-item", { as: "admin", body: { ...body, name: "sirup uji" } });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.message, "Bahan sirup uji sudah ada di Stok → Bahan Baku.");
    assert.equal((await request("POST", "/api/stock-item", { as: "cashier", body: { ...body, name: "Kasir Uji" } })).status, 403);
  });

  it("keeps perlengkapan apart from bahan baku and buys them on the same nota form", async () => {
    const created = await request("POST", "/api/stock-item/supply", {
      as: "admin",
      body: { name: "Blender Uji", category: "Peralatan", unit: "unit", minimumStock: 1 },
    });
    assert.equal(created.status, 201);
    assert.deepEqual(
      [created.body.data.category, created.body.data.stock, created.body.data.status],
      ["Peralatan", 0, "HARUS ORDER"]
    );
    for (const body of [
      { name: "Blender Uji", category: "Peralatan", unit: "unit" },
      { name: "Sirup Uji", category: "Perlengkapan", unit: "ml" },
    ]) {
      assert.equal((await request("POST", "/api/stock-item/supply", { as: "admin", body })).status, 409);
    }
    assert.equal((await request("POST", "/api/stock-item/supply", { as: "admin", body: { name: "X", category: "Bahan", unit: "pcs" } })).status, 400);
    assert.equal((await request("POST", "/api/stock-item/supply", { as: "cashier", body: { name: "Y", category: "Promosi", unit: "pcs" } })).status, 403);
    assert.equal((await request("POST", "/api/stock-item", { as: "admin", body: { name: "Blender Uji", category: "Alat", unit: "unit" } })).status, 409);

    const purchase = await request("POST", "/api/shopping/supply-purchases", {
      as: "admin",
      body: {
        requestId: "supply-purchase-0000001",
        date: "2026-10-29",
        suplierName: "Toko Alat",
        paymentMethod: "Cash",
        items: [
          { supplyItemId: created.body.data.id, quantity: 2, unit: "unit", unitPrice: 350000 },
          { itemName: "Brosur Uji", category: "Promosi", quantity: 500, unit: "lembar", unitPrice: 300 },
        ],
      },
    });
    assert.equal(purchase.status, 201);
    assert.equal(purchase.body.data.total, 850000);
    assert.equal((await request("POST", "/api/shopping/supply-purchases", { as: "cashier", body: {} })).status, 403);

    const supplies = await request("GET", "/api/stock-item/supply", { as: "cashier" });
    const byName = Object.fromEntries(supplies.body.data.map((item) => [item.name, item]));
    assert.deepEqual(
      [byName["Blender Uji"].stock, byName["Blender Uji"].stockValue, byName["Blender Uji"].status],
      [2, 700000, "HAMPIR HABIS"]
    );
    assert.deepEqual([byName["Brosur Uji"].category, byName["Brosur Uji"].unit, byName["Brosur Uji"].averageCost], ["Promosi", "lembar", 300]);
    const rawNames = (await request("GET", "/api/stock-item", { as: "admin" })).body.data.map((item) => item.name);
    assert.equal(rawNames.includes("Blender Uji"), false);

    const adjusted = await request("PATCH", `/api/stock-item/supply/${byName["Brosur Uji"].id}/stock`, { as: "cashier", body: { stock: 200 } });
    assert.deepEqual([adjusted.body.data.stock, adjusted.body.data.stockValue], [200, 60000]);

    const history = await request("GET", "/api/shopping/supply-purchases?search=Brosur", { as: "cashier" });
    assert.deepEqual(
      [history.body.data.itemGroups[0].itemName, history.body.data.itemGroups[0].category, history.body.data.itemGroups[0].histories[0].paymentMethod],
      ["Brosur Uji", "Promosi", "Cash"]
    );

    const form = new FormData();
    form.append("files", new Blob([TINY_PNG], { type: "image/png" }), "nota-alat.png");
    const uploaded = await request("POST", `/api/shopping/supply-purchases/${purchase.body.data.id}/attachments`, { as: "admin", body: form });
    assert.equal(uploaded.status, 201);
    const [receipt] = uploaded.body.data;
    assert.match(receipt.url, /^\/api\/shopping\/supply-purchase-attachments\/\d+$/);
    assert.equal((await fetch(`${server.baseUrl}${receipt.url}`)).status, 401);
    const photo = await fetch(`${server.baseUrl}${receipt.url}`, { headers: { Cookie: cookies.cashier } });
    assert.deepEqual([photo.status, photo.headers.get("content-type")], [200, "image/png"]);
    assert.equal((await request("DELETE", receipt.url, { as: "admin" })).status, 200);

    const updated = await request("PUT", `/api/stock-item/supply/${byName["Blender Uji"].id}`, {
      as: "admin",
      body: { name: "Blender Bar", category: "Peralatan", unit: "unit", minimumStock: 1 },
    });
    assert.deepEqual([updated.body.data.name, updated.body.data.stock], ["Blender Bar", 2]);
    assert.equal((await request("DELETE", `/api/stock-item/supply/${byName["Brosur Uji"].id}`, { as: "admin" })).status, 200);
    const afterDelete = await request("GET", "/api/shopping/supply-purchases?search=Brosur", { as: "admin" });
    assert.deepEqual([afterDelete.body.data.itemGroups[0].stockItemId, afterDelete.body.data.itemGroups[0].itemName], [null, "Brosur Uji"]);
  });

  it("lets kasir save a draft nota with its footer and only admins post it", async () => {
    const nota = {
      date: "2026-10-30",
      suplierName: "Toko Draft",
      paymentSourceId: 1,
      shippingCost: 10000,
      discountType: "amount",
      discountValue: 5000,
      taxPercent: 11,
      items: [{ itemName: "Kopi Draft", quantity: 1, unit: "kg", unitPrice: 100000 }],
    };
    // 100000 - 5000 + 10450 (PPN 11% of 95000) + 10000
    assert.equal((await request("POST", "/api/shopping/purchases", { as: "cashier", body: { ...nota, requestId: "draft-nota-0000000001" } })).status, 403);
    const draft = await request("POST", "/api/shopping/purchases", {
      as: "cashier",
      body: { ...nota, requestId: "draft-nota-0000000002", status: "draft" },
    });
    assert.equal(draft.status, 201);
    assert.deepEqual([draft.body.data.status, draft.body.data.total], ["draft", 115450]);
    const drafts = await request("GET", "/api/shopping/purchases/drafts", { as: "cashier" });
    assert.deepEqual(
      drafts.body.data.map((row) => [row.id, row.createdBy, row.taxAmount, row.items[0].itemName]),
      [[draft.body.data.id, "cashier", 10450, "Kopi Draft"]]
    );
    const stockNames = (await request("GET", "/api/stock-item", { as: "admin" })).body.data.map((item) => item.name);
    assert.equal(stockNames.includes("Kopi Draft"), false);

    const photo = new FormData();
    photo.append("files", new Blob([TINY_PNG], { type: "image/png" }), "nota-draft.png");
    const draftPhoto = await request("POST", `/api/shopping/purchases/${draft.body.data.id}/attachments`, { as: "cashier", body: photo });
    assert.equal(draftPhoto.status, 201);

    const asCashier = await request("PUT", `/api/shopping/purchases/${draft.body.data.id}`, {
      as: "cashier",
      body: { ...nota, status: "posted" },
    });
    assert.equal(asCashier.status, 403);
    const balanceBefore = (await request("GET", "/api/payment-source", { as: "admin" })).body.data[0].balance;
    const posted = await request("PUT", `/api/shopping/purchases/${draft.body.data.id}`, {
      as: "admin",
      body: { ...nota, status: "posted" },
    });
    assert.equal(posted.status, 200);
    assert.deepEqual([posted.body.data.status, posted.body.data.balance], ["posted", balanceBefore - 115450]);
    const kopi = (await request("GET", "/api/stock-item", { as: "admin" })).body.data.find((item) => item.name === "Kopi Draft");
    assert.deepEqual([kopi.unit, kopi.stock, kopi.stockValue], ["kg", 1, 115450]);
    assert.deepEqual((await request("GET", "/api/shopping/purchases/drafts", { as: "admin" })).body.data, []);
    // The posted nota now shows in the Per Nota history, for kasir too.
    const notas = await request("GET", "/api/shopping/purchases/notas?search=Kopi%20Draft", { as: "cashier" });
    assert.equal(notas.status, 200);
    assert.deepEqual(
      notas.body.data.notas.map((row) => [row.id, row.total, row.items.length]),
      [[draft.body.data.id, 115450, 1]]
    );
    assert.equal((await request("GET", "/api/shopping/supply-purchases/notas?category=Operasional", { as: "admin" })).status, 400);
    // The summary cards of the Belanja page, for kasir too.
    const summary = await request("GET", "/api/shopping/summary", { as: "cashier" });
    assert.equal(summary.status, 200);
    assert.ok(summary.body.data.bahanBaku.total >= 115450 && "asetPeralatan" in summary.body.data);
    assert.equal((await request("GET", "/api/shopping/summary?from=2026-13-01", { as: "admin" })).status, 400);
    assert.equal((await request("DELETE", `/api/shopping/purchases/${draft.body.data.id}`, { as: "admin" })).status, 409);
    // Once posted, only admins change its photos.
    assert.equal((await request("DELETE", draftPhoto.body.data[0].url, { as: "cashier" })).status, 403);
    assert.equal((await request("DELETE", draftPhoto.body.data[0].url, { as: "admin" })).status, 200);

    // Kasir may throw away their own draft.
    const second = await request("POST", "/api/shopping/supply-purchases", {
      as: "cashier",
      body: { ...nota, requestId: "draft-nota-0000000003", status: "draft", items: [{ itemName: "Lap Draft", category: "Perlengkapan", quantity: 3, unit: "pcs", unitPrice: 5000 }] },
    });
    assert.equal(second.status, 201);
    assert.equal((await request("DELETE", `/api/shopping/supply-purchases/${second.body.data.id}`, { as: "cashier" })).status, 200);
    assert.deepEqual((await request("GET", "/api/shopping/supply-purchases/drafts", { as: "cashier" })).body.data, []);
  });

  it("offers only bahan resep to the recipe editors and keeps the bahan recipes use on", async () => {
    const add = (body) =>
      request("POST", "/api/stock-item", { as: "admin", body: { category: "Bahan", unit: "gr", stock: 0, ...body } });
    const byName = async (name) =>
      (await request("GET", "/api/stock-item", { as: "admin" })).body.data.find((item) => item.name === name);
    const toggle = (id, isRecipeIngredient, as = "admin") =>
      request("PATCH", `/api/stock-item/${id}/recipe-use`, { as, body: { isRecipeIngredient } });

    const susu = (await add({ name: "Susu Resep" })).body.data;
    assert.equal(susu.isRecipeIngredient, true, "Tambah Stok starts as bahan resep");
    const galon = (await add({ name: "Galon Bukan Resep", unit: "pcs", isRecipeIngredient: false })).body.data;
    assert.equal(galon.isRecipeIngredient, false);

    // A bahan first bought on a belanja nota is a bahan resep: Tambah Belanja lists only those.
    const nota = await request("POST", "/api/shopping/purchases", {
      as: "admin",
      body: {
        requestId: "recipe-flag-0000000001",
        date: "2026-10-30",
        suplierName: "Toko Resep",
        paymentSourceId: 1,
        items: [
          { itemName: "Tisu Belanja", quantity: 2, unit: "pcs", unitPrice: 5000 },
          { itemName: "Plastik Belanja", quantity: 1, unit: "pcs", unitPrice: 3000 },
        ],
      },
    });
    assert.equal(nota.status, 201);
    const tisu = await byName("Tisu Belanja");
    assert.equal(tisu.isRecipeIngredient, true);
    assert.equal((await toggle(tisu.id, false)).body.data.isRecipeIngredient, false);

    assert.equal((await toggle(galon.id, true, "cashier")).status, 403);
    assert.equal((await toggle(999999, true)).status, 404);
    const marked = await toggle(galon.id, true);
    assert.deepEqual([marked.status, marked.body.data.isRecipeIngredient], [200, true]);
    assert.equal((await toggle(galon.id, false)).body.data.isRecipeIngredient, false);

    // Saving a recipe marks its bahan; a bahan a recipe uses cannot be turned off.
    const [[category]] = await db.query("SELECT id FROM categories ORDER BY id LIMIT 1");
    const menu = await request("POST", "/api/menu-item", {
      as: "admin",
      body: {
        categoryId: category.id,
        name: "Latte Resep",
        price: 20000,
        ingredients: [{ stockItemId: susu.id, quantity: 150 }, { stockItemId: tisu.id, quantity: 1 }],
      },
    });
    assert.equal(menu.status, 201);
    assert.equal((await byName("Tisu Belanja")).isRecipeIngredient, true);
    const semi = await request("POST", "/api/stock-item/semi", {
      as: "admin",
      body: { name: "Es Batu Resep", unit: "porsi", portionSize: 1, components: [{ stockItemId: galon.id, quantity: 1 }] },
    });
    assert.equal(semi.status, 201);
    assert.equal((await byName("Galon Bukan Resep")).isRecipeIngredient, true);
    const blocked = await toggle(susu.id, false);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.message, "Bahan masih dipakai di resep: Latte Resep. Hapus dari resep terlebih dahulu.");
    assert.equal((await toggle(galon.id, false)).body.message, "Bahan masih dipakai di resep: Es Batu Resep. Hapus dari resep terlebih dahulu.");

    // Adding the column marks only the bahan the recipes already use.
    await db.query("ALTER TABLE stock_raw_items DROP COLUMN is_recipe_ingredient");
    await restartServer();
    const flags = [];
    for (const name of ["Susu Resep", "Tisu Belanja", "Galon Bukan Resep", "Plastik Belanja"]) {
      flags.push((await byName(name)).isRecipeIngredient);
    }
    assert.deepEqual(flags, [true, true, true, false]);
  });

  it("changes the unit of a bahan baku with its stock, COGS, recipes and purchase lines (1 galon = 19.000 ml)", async () => {
    const byName = async (name) =>
      (await request("GET", "/api/stock-item", { as: "admin" })).body.data.find((item) => item.name === name);
    const convert = (id, body, as = "admin") => request("PATCH", `/api/stock-item/${id}/unit`, { as, body });
    const buy = (requestId, item) =>
      request("POST", "/api/shopping/purchases", {
        as: "admin",
        body: { requestId, date: "2026-10-30", suplierName: "Depot Air Uji", paymentSourceId: 1, items: [item] },
      });

    // Bought by the galon (from the rekap import too): its stock unit is galon.
    assert.equal((await buy("unit-galon-000000001", { itemName: "Air Galon Uji", quantity: 2, unit: "galon", unitPrice: 8000 })).status, 201);
    const galon = await byName("Air Galon Uji");
    assert.deepEqual([galon.unit, galon.stock, galon.averageCost, galon.stockValue], ["galon", 2, 8000, 16000]);
    const [[category]] = await db.query("SELECT id FROM categories ORDER BY id LIMIT 1");
    const menu = await request("POST", "/api/menu-item", {
      as: "admin",
      body: { categoryId: category.id, name: "Es Teh Galon", price: 5000, ingredients: [{ stockItemId: galon.id, quantity: 0.5 }] },
    });
    assert.equal(menu.status, 201);
    // ml cannot be bought for a galon bahan.
    assert.equal((await buy("unit-galon-000000002", { stockItemId: galon.id, quantity: 19000, unit: "ml", unitPrice: 0.42 })).status, 400);

    assert.equal((await convert(galon.id, { unit: "ml", factor: 19000 }, "cashier")).status, 403);
    assert.equal((await convert(999999, { unit: "ml", factor: 19000 })).status, 404);
    const noFactor = await convert(galon.id, { unit: "ml" });
    assert.deepEqual([noFactor.status, noFactor.body.message], [400, "Isi konversinya: 1 galon = berapa ml?"]);
    assert.equal((await convert(galon.id, { unit: "Galon", factor: 1 })).status, 400);

    const converted = await convert(galon.id, { unit: "ml", factor: 19000 });
    assert.equal(converted.status, 200);
    assert.equal(
      converted.body.message,
      "Satuan Air Galon Uji dikonversi: 1 galon = 19.000 ml. Stok, resep, dan riwayat belanja ikut disesuaikan."
    );
    // Same worth: Rp 16.000 of water, now 38.000 ml (COGS rounds to whole rupiah).
    const { unit, stock, averageCost, stockValue } = converted.body.data;
    assert.deepEqual({ unit, stock, averageCost, stockValue }, { unit: "ml", stock: 38000, averageCost: 0, stockValue: 16000 });
    const [[recipe]] = await db.query("SELECT quantity FROM menu_item_recipes WHERE stock_item_id = ?", [galon.id]);
    assert.equal(Number(recipe.quantity), 9500);
    const [[line]] = await db.query(
      "SELECT id, quantity, unit, pack_size, stock_quantity, stock_unit, stock_unit_cost FROM history_stock_raw_purchase_items WHERE stock_item_id = ?",
      [galon.id]
    );
    assert.deepEqual(
      [Number(line.quantity), line.unit, Number(line.pack_size), Number(line.stock_quantity), line.stock_unit, line.stock_unit_cost],
      [2, "galon", 19000, 38000, "ml", 0]
    );

    // From now on the gramasi is in ml, at the harga total typed (19.000 x Rp 0,42
    // would be Rp 7.980); the old line stays editable as 1 galon isi 19.000 ml.
    const inMl = await buy("unit-galon-000000003", { stockItemId: galon.id, quantity: 19000, unit: "ml", unitPrice: 0.42, total: 8000 });
    assert.equal(inMl.status, 201, JSON.stringify(inMl.body));
    const mlLineOf = async () =>
      (await db.query("SELECT id, total, cost_total FROM history_stock_raw_purchase_items WHERE stock_item_id = ? AND unit = 'ml'", [galon.id]))[0][0];
    const mlLine = await mlLineOf();
    assert.deepEqual([Number(mlLine.total), Number(mlLine.cost_total)], [8000, 8000]);
    // Editing a line keeps its harga total too.
    const reprice = await request("PUT", `/api/shopping/purchase-items/${mlLine.id}`, {
      as: "admin",
      body: { quantity: 19000, unit: "ml", unitPrice: 0.47, total: 9000 },
    });
    assert.equal(reprice.status, 200, JSON.stringify(reprice.body));
    assert.equal(Number((await mlLineOf()).total), 9000);
    assert.equal((await byName("Air Galon Uji")).stockValue, 25000);
    const edited = await request("PUT", `/api/shopping/purchase-items/${line.id}`, {
      as: "admin",
      body: { quantity: 1, unit: "galon", unitPrice: 8000 },
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal((await byName("Air Galon Uji")).stock, 38000);

    // Back to a unit too big for the ml lines: refused, nothing changed.
    const tooBig = await convert(galon.id, { unit: "galon", factor: 1 / 19000 });
    assert.equal(tooBig.status, 400);
    assert.match(tooBig.body.message, /galon terlalu besar untuk riwayat belanja Air Galon Uji/);
    assert.equal((await byName("Air Galon Uji")).unit, "ml");

    // Units the server converts take their own factor: 2 kg = 2.000 gr.
    const gula = (
      await request("POST", "/api/stock-item", { as: "admin", body: { name: "Gula Kg Uji", category: "Bahan", unit: "kg", stock: 2, minimumStock: 1 } })
    ).body.data;
    const toGram = await convert(gula.id, { unit: "gr", factor: 5 });
    assert.equal(toGram.body.message, "Satuan Gula Kg Uji dikonversi: 1 kg = 1.000 gr. Stok, resep, dan riwayat belanja ikut disesuaikan.");
    assert.deepEqual([toGram.body.data.unit, toGram.body.data.stock, toGram.body.data.minimumStock], ["gr", 2000, 1000]);
  });

  it("Modul 2: sells bahan olahan before the Daily Prep, spreads the day's cooking cost and locks the HPP at the daily recap", async () => {
    const day = "2026-03-10";
    const quietDay = "2026-03-11";
    const addRaw = async (name, unit, averageCost) => {
      const created = await request("POST", "/api/stock-item", {
        as: "admin",
        body: { name, category: "Bahan", unit, stock: 100 },
      });
      await request("PATCH", `/api/stock-item/${created.body.data.id}/cogs`, { as: "admin", body: { averageCost } });
      return created.body.data.id;
    };
    const berasId = await addRaw("Beras Modul", "kg", 15000);
    const telurId = await addRaw("Telur Modul", "pcs", 2000);
    const nasi = (
      await request("POST", "/api/stock-item/semi", {
        as: "admin",
        body: { name: "Nasi Modul", unit: "porsi", components: [{ stockItemId: berasId, quantity: 1 }] },
      })
    ).body.data;
    const [[category]] = await db.query("SELECT id FROM categories ORDER BY id LIMIT 1");
    const addMenu = async (name, ingredients) =>
      (await request("POST", "/api/menu-item", { as: "admin", body: { categoryId: category.id, name, price: 20000, ingredients } }))
        .body.data.id;
    const nasiTelur = await addMenu("Nasi Telur Modul", [{ semiItemId: nasi.id, quantity: 1 }, { stockItemId: telurId, quantity: 1 }]);
    const telurRebus = await addMenu("Telur Rebus Modul", [{ stockItemId: telurId, quantity: 1 }]);
    const sell = (orderDate, menuItemId, name, quantity) =>
      request("POST", "/api/order", {
        as: "cashier",
        body: {
          customerDetails: { name: "Modul 2" },
          orderType: "Online",
          orderPlatform: "GoFood",
          orderDate,
          orderStatus: "In Progress",
          bills: { total: 20000 * quantity, tax: 0, totalWithTax: 20000 * quantity },
          items: [{ id: `${category.id}-${menuItemId}`, sourceMenuItemId: menuItemId, name, quantity, pricePerQuantity: 20000, price: 20000 * quantity }],
          paymentMethod: "Cash",
        },
      });
    // [bahan, cost per portion, cost, Pending Flag, HPP of the order item]
    const linesOf = async (orderId) =>
      (
        await db.query(
          `SELECT c.stock_item_name AS name, c.unit_cost, c.cost, c.is_pending, oi.hpp_cost
           FROM order_item_costs c JOIN order_items oi ON oi.id = c.order_item_id
           WHERE oi.order_id = ? ORDER BY c.stock_item_name`,
          [orderId]
        )
      )[0].map((row) => [row.name, row.unit_cost, row.cost, Boolean(row.is_pending), Number(row.hpp_cost)]);
    const statusOf = async (orderId) => {
      const [[row]] = await db.query("SELECT hpp_status, hpp_closed_at FROM orders WHERE id = ?", [orderId]);
      return [row.hpp_status, row.hpp_closed_at !== null];
    };
    const prep = (body) =>
      request("POST", `/api/stock-item/semi/${nasi.id}/productions`, { as: "cashier", body: { producedDate: day, ...body } });

    // Sold before the kitchen cooked: no Nasi yet, the sale goes through, the
    // telur (barang standar) has its HPP and the Nasi line waits (Pending Flag).
    const first = await sell(day, nasiTelur, "Nasi Telur Modul", 2);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.data.hppStatus, "pending");
    assert.deepEqual(await linesOf(first.body.data.id), [
      ["Nasi Modul", 0, 0, true, 2000],
      ["Telur Modul", 2000, 2000, false, 2000],
    ]);
    // Only barang standar: final at the sale.
    const telurOnly = await sell(day, telurRebus, "Telur Rebus Modul", 1);
    assert.equal(telurOnly.body.data.hppStatus, "closed");
    assert.notEqual(telurOnly.body.data.hppClosedAt, null);

    // Daily Prep at the end of the shift: 5 kg beras gave 40 portions, Rp 1.875
    // each. The 2 portions sold before take that cost and, now that the stock
    // covers them (38 left), are settled: the nota is no longer pending.
    const firstPrep = await prep({ items: [{ stockItemId: berasId, quantity: 5 }], portionQuantity: 40 });
    assert.equal(firstPrep.status, 201, JSON.stringify(firstPrep.body));
    const { stock, stockValue, averageCost } = firstPrep.body.data;
    assert.deepEqual({ stock, stockValue, averageCost }, { stock: 38, stockValue: 71250, averageCost: 1875 });
    assert.deepEqual(await linesOf(first.body.data.id), [
      ["Nasi Modul", 1875, 1875, false, 3875],
      ["Telur Modul", 2000, 2000, false, 3875],
    ]);
    assert.deepEqual(await statusOf(first.body.data.id), ["closed", true]);
    // Sold with Nasi in stock: the day's cost at once, no Pending Flag.
    const later = await sell(day, nasiTelur, "Nasi Telur Modul", 1);
    assert.equal(later.body.data.hppStatus, "closed");
    assert.deepEqual((await linesOf(later.body.data.id))[0], ["Nasi Modul", 1875, 1875, false, 3875]);
    // A second cooking that day (1 kg, 10 portions) leaves settled lines as they are.
    assert.equal((await prep({ items: [{ stockItemId: berasId, quantity: 1 }], portionQuantity: 10 })).status, 201);
    assert.deepEqual((await linesOf(first.body.data.id))[0], ["Nasi Modul", 1875, 1875, false, 3875]);
    assert.deepEqual((await linesOf(later.body.data.id))[0], ["Nasi Modul", 1875, 1875, false, 3875]);
    // Metrik splits the HPP: the Nasi part (olahan) per portion, the rest standar.
    const splitOf = async (orderId) =>
      (await request("GET", `/api/order/${orderId}`, { as: "admin" })).body.data.items.map((item) => [item.hppCost, item.hppOlahan]);
    assert.deepEqual(await splitOf(first.body.data.id), [[3875, 1875]]);
    assert.deepEqual(await splitOf(telurOnly.body.data.id), [[2000, 0]]);
    const listed = (await request("GET", "/api/order", { as: "admin" })).body.data.find((order) => order.id === first.body.data.id);
    assert.deepEqual(listed.items.map((item) => item.hppOlahan), [1875]);

    // A day without Daily Prep, Nasi still in stock: final at once, at the cost it was sold with.
    const quiet = await sell(quietDay, nasiTelur, "Nasi Telur Modul", 1);
    assert.equal(quiet.body.data.hppStatus, "closed");
    const [quietNasi] = await linesOf(quiet.body.data.id);
    assert.equal(quietNasi[3], false);

    // The daily recap locks the day; nothing was left pending.
    const recap = await request("POST", "/api/recap/daily", { as: "admin", body: { recapDate: day } });
    assert.equal(recap.status, 201);
    assert.deepEqual(recap.body.data.hppClosed, { closedOrders: 0, items: [] });
    assert.deepEqual(await linesOf(first.body.data.id), [
      ["Nasi Modul", 1875, 1875, false, 3875],
      ["Telur Modul", 2000, 2000, false, 3875],
    ]);
    assert.deepEqual(await statusOf(first.body.data.id), ["closed", true]);
    assert.deepEqual(await statusOf(later.body.data.id), ["closed", true]);
    // Each line says what it is and where its cost comes from.
    const typesOf = async (orderId) =>
      (
        await db.query(
          `SELECT c.stock_item_name, c.hpp_type, c.hpp_source FROM order_item_costs c
           JOIN order_items oi ON oi.id = c.order_item_id WHERE oi.order_id = ? ORDER BY c.stock_item_name`,
          [orderId]
        )
      )[0].map((row) => [row.stock_item_name, row.hpp_type, row.hpp_source]);
    assert.deepEqual(await typesOf(first.body.data.id), [
      ["Nasi Modul", "olahan", "dapur"],
      ["Telur Modul", "standar", "penjualan"],
    ]);
    const order = await request("GET", `/api/order/${first.body.data.id}`, { as: "cashier" });
    assert.equal(order.body.data.hppStatus, "closed");
    // ...and no Daily Prep can change it any more.
    const tooLate = await prep({ items: [{ stockItemId: berasId, quantity: 1 }], portionQuantity: 10 });
    assert.equal(tooLate.status, 409);
    assert.equal(tooLate.body.message, `Hari ${day} sudah ditutup. HPP hari itu sudah dikunci.`);
    assert.equal((await prep({ items: [{ stockItemId: berasId, quantity: 1 }], portionQuantity: 1, producedDate: "2999-01-01" })).status, 400);

    const quietRecap = await request("POST", "/api/recap/daily", { as: "admin", body: { recapDate: quietDay } });
    assert.deepEqual(quietRecap.body.data.hppClosed, { closedOrders: 0, items: [] });
    assert.deepEqual(await linesOf(quiet.body.data.id), [
      ["Nasi Modul", quietNasi[1], quietNasi[2], false, quietNasi[4]],
      ["Telur Modul", 2000, 2000, false, quietNasi[4]],
    ]);
    assert.deepEqual(await statusOf(quiet.body.data.id), ["closed", true]);
    // No Daily Prep that day: the olahan line kept its cost at the sale (fallback).
    assert.deepEqual((await typesOf(quiet.body.data.id))[0], ["Nasi Modul", "olahan", "penjualan"]);

    // Sold with no Nasi cooked (stock below 0): pending until the recap locks
    // it at the cost it was sold with; the next day starts from 0.
    const semiStock = async () => Number((await db.query("SELECT stock FROM stock_semi_items WHERE id = ?", [nasi.id]))[0][0].stock);
    assert.equal(await semiStock(), 0, "the day's leftover was written off");
    const short = await sell("2026-03-12", nasiTelur, "Nasi Telur Modul", 3);
    assert.equal(short.status, 201);
    assert.equal(short.body.data.hppStatus, "pending");
    assert.equal(await semiStock(), -3);
    const shortRecap = await request("POST", "/api/recap/daily", { as: "admin", body: { recapDate: "2026-03-12" } });
    assert.deepEqual(shortRecap.body.data.writtenOff, []);
    assert.equal(shortRecap.body.data.hppClosed.closedOrders, 1);
    assert.deepEqual(await statusOf(short.body.data.id), ["closed", true]);
    assert.equal(await semiStock(), 0);

    // Adding the columns types the lines already sold (olahan: a bahan olahan).
    await db.query("ALTER TABLE order_item_costs DROP COLUMN hpp_source, DROP COLUMN hpp_type");
    await restartServer();
    assert.deepEqual(await typesOf(first.body.data.id), [
      ["Nasi Modul", "olahan", "penjualan"],
      ["Telur Modul", "standar", "penjualan"],
    ]);
  });

  it("closes each business day by itself at 00:00: HPP locked, Nasi reset, once", async () => {
    const { autoCloseDays } = require("../../src/modules/recaps/dayClosing");
    const day = "2026-05-20";
    const raw = await request("POST", "/api/stock-item", {
      as: "admin",
      body: { name: "Beras Tutup", category: "Bahan", unit: "kg", stock: 100 },
    });
    await request("PATCH", `/api/stock-item/${raw.body.data.id}/cogs`, { as: "admin", body: { averageCost: 10000 } });
    const nasi = (
      await request("POST", "/api/stock-item/semi", {
        as: "admin",
        body: { name: "Nasi Tutup", unit: "porsi", components: [{ stockItemId: raw.body.data.id, quantity: 1 }] },
      })
    ).body.data;
    const [[category]] = await db.query("SELECT id FROM categories ORDER BY id LIMIT 1");
    const menuItemId = (
      await request("POST", "/api/menu-item", {
        as: "admin",
        body: { categoryId: category.id, name: "Nasi Putih Tutup", price: 5000, ingredients: [{ semiItemId: nasi.id, quantity: 1 }] },
      })
    ).body.data.id;
    const sell = async (orderDate, quantity) =>
      (
        await request("POST", "/api/order", {
          as: "cashier",
          body: {
            customerDetails: { name: "Tutup Hari" },
            orderType: "Online",
            orderPlatform: "GoFood",
            orderDate,
            orderStatus: "In Progress",
            bills: { total: 5000 * quantity, tax: 0, totalWithTax: 5000 * quantity },
            items: [{ id: `${category.id}-${menuItemId}`, sourceMenuItemId: menuItemId, name: "Nasi Putih Tutup", quantity, pricePerQuantity: 5000, price: 5000 * quantity }],
            paymentMethod: "Cash",
          },
        })
      ).body.data.id;
    const hppOf = async (orderId) => {
      const [[row]] = await db.query(
        `SELECT o.hpp_status, c.unit_cost, c.is_pending
         FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN order_item_costs c ON c.order_item_id = oi.id
         WHERE o.id = ?`,
        [orderId]
      );
      return [row.hpp_status, row.unit_cost, Boolean(row.is_pending)];
    };
    const prep = (producedDate) =>
      request("POST", `/api/stock-item/semi/${nasi.id}/productions`, {
        as: "cashier",
        body: { items: [{ stockItemId: raw.body.data.id, quantity: 1 }], portionQuantity: 10, producedDate },
      });

    // Sold before the Daily Prep (pending), then cooked: Rp 10.000 / 10
    // portions, and the stock covers them again, so they are settled.
    const sold = await sell(day, 3);
    assert.equal((await hppOf(sold))[2], true);
    assert.equal((await prep(day)).status, 201);
    assert.deepEqual(await hppOf(sold), ["closed", 1000, false]);
    // An online order booked on an older day, more than the 7 portions left.
    const late = await sell("2026-05-10", 9);
    assert.deepEqual(await hppOf(late), ["pending", 1000, true]);

    // 20 May, 23:30: the 20th is still open.
    const early = await autoCloseDays(db, { now: new Date("2026-05-20T23:30:00+07:00") });
    assert.equal(early.day, "2026-05-19");
    assert.equal(early.lateOrders, 1, "the older day's nota is locked");
    assert.deepEqual(await hppOf(late), ["closed", 1000, false]);
    assert.equal((await prep(day)).status, 201, "the 20th still takes Daily Prep");
    // Sold with Nasi in stock: final at once.
    const ready = await sell(day, 1);
    assert.deepEqual(await hppOf(ready), ["closed", 1000, false]);

    // 21 May, 00:00: the 20th closes, nothing pending. Its leftover is reset:
    // closing the 19th set the Nasi below 0 back to 0, then 10 cooked - 1 sold.
    const closing = await autoCloseDays(db, { now: new Date("2026-05-21T00:00:00+07:00") });
    assert.equal(closing.day, day);
    assert.equal(closing.firstClose, true);
    assert.equal(closing.hppClosed.closedOrders, 0);
    assert.deepEqual(
      closing.writtenOff.filter((item) => item.name === "Nasi Tutup").map((item) => [item.quantity, item.cost]),
      [[9, 9000]]
    );
    const [[row]] = await db.query("SELECT source FROM business_day_closings WHERE business_date = ?", [day]);
    assert.equal(row.source, "auto");
    const refused = await prep(day);
    assert.deepEqual([refused.status, refused.body.message], [409, `Hari ${day} sudah ditutup. HPP hari itu sudah dikunci.`]);

    // Once: running again, or saving the day's recap later, closes nothing more.
    const again = await autoCloseDays(db, { now: new Date("2026-05-21T06:00:00+07:00") });
    assert.deepEqual([again.firstClose, again.hppClosed.closedOrders, again.writtenOff], [false, 0, []]);
    const recap = await request("POST", "/api/recap/daily", { as: "admin", body: { recapDate: day } });
    assert.equal(recap.status, 201);
    assert.deepEqual([recap.body.data.writtenOff, recap.body.data.hppClosed.closedOrders], [[], 0]);
  });
});
