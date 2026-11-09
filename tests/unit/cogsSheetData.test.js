// The COGS sheet seed data stays consistent (see bootstrap/cogsSheetData.js).
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  cogsExtraMenus,
  cogsExtraStockItems,
  cogsHotMenus,
  cogsMenus,
  cogsStockItems,
} = require("../../src/infrastructure/database/bootstrap/cogsSheetData");

const keyOf = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, "");

describe("COGS sheet seed data", () => {
  it("lists each bahan once with a unit and a pack price", () => {
    const keys = cogsStockItems.map(([name]) => keyOf(name));
    assert.equal(new Set(keys).size, keys.length);
    for (const [name, , unit, packSize, packPrice] of cogsStockItems) {
      assert.ok(["gr", "ml", "pcs", "porsi"].includes(unit), `${name}: ${unit}`);
      assert.ok(packSize > 0 && packPrice > 0, name);
    }
  });

  it("names each menu once, with a price and recipes of known bahan", () => {
    const bahan = new Set(cogsStockItems.map(([name]) => keyOf(name)));
    const names = cogsMenus.flatMap((menu) => [menu.name, ...menu.aliases].map(keyOf));
    const menuKeys = cogsMenus.map((menu) => keyOf(menu.name));
    assert.equal(new Set(menuKeys).size, menuKeys.length);
    assert.ok(names.length >= menuKeys.length);

    for (const menu of cogsMenus) {
      assert.ok(["Coffee", "Non-Coffee", "Snack", "Main Course", "Roti Kukus"].includes(menu.category), menu.name);
      assert.ok(menu.price > 0, menu.name);
      for (const [name, quantity] of menu.recipe || []) {
        assert.ok(bahan.has(keyOf(name)), `${menu.name}: ${name}`);
        assert.ok(quantity > 0, `${menu.name}: ${name}`);
      }
    }
  });

  it("adds the missed bahan once, and the missed menus with recipes of known bahan", () => {
    const keys = [...cogsStockItems, ...cogsExtraStockItems].map(([name]) => keyOf(name));
    assert.equal(new Set(keys).size, keys.length);
    for (const [name, , unit, packSize, packPrice] of cogsExtraStockItems) {
      assert.ok(["gr", "ml", "pcs", "porsi"].includes(unit), `${name}: ${unit}`);
      assert.ok(packSize > 0 && packPrice > 0, name);
    }

    const bahan = new Set(keys);
    const menuNames = new Set(cogsMenus.flatMap((menu) => [menu.name, ...menu.aliases].map(keyOf)));
    for (const menu of cogsExtraMenus) {
      assert.ok(!menuNames.has(keyOf(menu.name)), menu.name);
      assert.ok(menu.price > 0 && menu.recipe.length, menu.name);
      for (const [name, quantity] of menu.recipe) {
        assert.ok(bahan.has(keyOf(name)) && quantity > 0, `${menu.name}: ${name}`);
      }
    }
  });

  it("copies only Ice menus into the Hot tabs, with recipes of known bahan", () => {
    const bahan = new Set(cogsStockItems.map(([name]) => keyOf(name)));
    const menuNames = new Set(cogsMenus.map((menu) => keyOf(menu.name)));
    const keys = cogsHotMenus.map((menu) => `${menu.category}|${keyOf(menu.name)}`);
    assert.equal(new Set(keys).size, keys.length);

    for (const menu of cogsHotMenus) {
      assert.ok(["Hot Black Coffee", "Hot White Coffee"].includes(menu.category), menu.name);
      assert.ok(menuNames.has(keyOf(menu.name)), menu.name);
      assert.ok(menu.price > 0 && menu.recipe.length, menu.name);
      for (const [name, quantity] of menu.recipe) {
        assert.ok(bahan.has(keyOf(name)), `${menu.name}: ${name}`);
        assert.ok(quantity > 0, `${menu.name}: ${name}`);
      }
    }
  });

  it("leaves the sheet's copied recipes out", () => {
    const withoutRecipe = cogsMenus.filter((menu) => !menu.recipe).map((menu) => menu.name);
    assert.deepEqual(withoutRecipe.sort(), [
      "Ayam Sambel Orek",
      "Beef Basir",
      "Beef Teriyaki Rice Bowl",
      "Blueberry Milk",
      "Milo Dino",
      "Strawberry Milk",
      "Udang Salted",
    ]);
  });
});
