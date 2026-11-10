const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { bestSellerGroupOf } = require("../../src/modules/categories/bestSeller");

describe("Best Seller group of a category", () => {
  const fromName = (name, isBundle = false) => bestSellerGroupOf({ group: null, name, isBundle });

  it("follows the category name until an admin sets it", () => {
    assert.deepEqual(
      ["Hot White Coffee", "Non-Coffee", "Tea Based", "Matcha Series", "Minuman Botol", "Rice Bowl", "Nasi Goreng", "ROTI KUKUS", "Snack"].map((name) => fromName(name)),
      ["Minuman", "Minuman", "Minuman", "Minuman", "Minuman", "Makanan", "Makanan", "Snack", "Snack"]
    );
    // Catering has its own panel; promo packages and add-ons are not ranked.
    assert.deepEqual([fromName("Catering"), fromName("Add Ons"), fromName("PROMO", true)], [null, null, null]);
  });

  it("keeps what the admin chose, '' being not shown", () => {
    assert.equal(bestSellerGroupOf({ group: "Snack", name: "Black Coffee" }), "Snack");
    assert.equal(bestSellerGroupOf({ group: "", name: "Black Coffee" }), null);
    assert.equal(bestSellerGroupOf({ group: "Lainnya", name: "Black Coffee" }), null);
  });
});
