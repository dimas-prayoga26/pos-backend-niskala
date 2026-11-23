const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const MenuItem = require("../../src/modules/menu/menu.repository");
const menuService = require("../../src/modules/menu/menu.service");

// menu_items in memory: id -> is_available; order lines of menu 20.
const rows = new Map([[20, true]]);
MenuItem.setAvailable = async (id, isAvailable) => {
  if (!rows.has(Number(id))) return false;
  rows.set(Number(id), isAvailable);
  return true;
};
MenuItem.findById = async (id) => (rows.has(Number(id)) ? { id: Number(id), isAvailable: rows.get(Number(id)) } : null);
const salesCalls = [];
MenuItem.findSales = async (id, paging) => {
  salesCalls.push([Number(id), paging]);
  return {
    summary: { lines: 45, orders: 40, quantity: 52, revenue: 1820000 },
    rows: [{ id: 9, orderCode: "NSK-9", quantity: 2, price: 70000 }],
  };
};

describe("menu: promo card", () => {
  it("switches a menu on or off at the cashier (Tersedia), nothing else", async () => {
    assert.deepEqual(await menuService.setAvailable("20", false), { id: 20, isAvailable: false });
    assert.equal(rows.get(20), false);
    assert.deepEqual(await menuService.setAvailable("20", true), { id: 20, isAvailable: true });

    await assert.rejects(menuService.setAvailable("20", "false"), /Status tersedia wajib diisi/);
    assert.equal(await menuService.setAvailable("99", true), null);
  });

  it("lists who bought it page by page, with totals over every sale", async () => {
    const sales = await menuService.listSales("20", { page: 2, perPage: 20 });

    assert.deepEqual(salesCalls, [[20, { page: 2, perPage: 20 }]]);
    assert.deepEqual(sales, {
      data: [{ id: 9, orderCode: "NSK-9", quantity: 2, price: 70000 }],
      meta: { page: 2, perPage: 20, total: 45, lastPage: 3 },
      summary: { orders: 40, quantity: 52, revenue: 1820000 },
    });
    assert.equal(await menuService.listSales("99"), null);
  });
});
