process.env.PUBLIC_API_KEY = "unit-key";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { finalPriceOf, rankDrinks, toImageUrl } = require("../../src/modules/public/bestDrinks.service");
const { requirePublicApiKey } = require("../../src/modules/public/public.controller");

const menu = (id, name, categoryName, group, extra = {}) => ({
  id,
  name,
  categoryId: id * 10,
  category: { name: categoryName, bestSellerGroup: group },
  regularPrice: 20000,
  discountPercent: 0,
  imagePath: `/uploads/menu/${id}.jpg`,
  hppCost: 5000,
  ...extra,
});

// Sellable menus in the POS order: the Ice copy comes before the Hot one.
const menus = [
  menu(1, "Americano", "Black Coffee", "Minuman", { regularPrice: 15000 }),
  menu(2, "Butterscotch Latte", "White Coffee", "Minuman"),
  menu(3, "Aren Latte", "White Coffee", "Minuman"),
  menu(4, "Americano", "Hot Black Coffee", "Minuman", { regularPrice: 15000 }),
  menu(5, "Rice Bowl Katsu", "Rice Bowl", "Makanan"),
  menu(6, "Matcha Latte", "Matcha Series", "Minuman", { discountPercent: 10 }),
];

const options = { limit: 4, baseUrl: "https://api.example.com" };

describe("best-selling drinks", () => {
  it("ranks drinks by quantity, Ice and Hot of a menu together, food left out", () => {
    const sales = [
      { menuItemId: 2, name: "Butterscotch Latte", quantity: 30 },
      { menuItemId: 1, name: "Americano", quantity: 20 },
      { menuItemId: 4, name: "Americano", quantity: 15 }, // Hot copy
      { menuItemId: 5, name: "Rice Bowl Katsu", quantity: 99 },
      { menuItemId: 3, name: "Aren Latte", quantity: 10 },
    ];

    assert.deepEqual(
      rankDrinks(sales, menus, options).map((drink) => [drink.rank, drink.name, drink.category]),
      [
        [1, "Americano", "Black Coffee"],
        [2, "Butterscotch Latte", "White Coffee"],
        [3, "Aren Latte", "White Coffee"],
      ]
    );
  });

  it("matches a line without a menu id by its name, and drops menus no longer sold", () => {
    const sales = [
      { menuItemId: null, name: " aren latte ", quantity: 5 },
      { menuItemId: 999, name: "Kopi Lama", quantity: 50 },
    ];

    assert.deepEqual(rankDrinks(sales, menus, options).map((drink) => drink.name), ["Aren Latte"]);
  });

  it("returns at most limit drinks, ties by name, with only public fields", () => {
    const sales = menus.map((item) => ({ menuItemId: item.id, name: item.name, quantity: 4 }));
    const drinks = rankDrinks(sales, menus, { ...options, limit: 2 });

    assert.deepEqual(drinks, [
      {
        rank: 1,
        id: 1,
        name: "Americano",
        category: "Black Coffee",
        price: 15000,
        imageUrl: "https://api.example.com/uploads/menu/1.jpg",
      },
      {
        rank: 2,
        id: 3,
        name: "Aren Latte",
        category: "White Coffee",
        price: 20000,
        imageUrl: "https://api.example.com/uploads/menu/3.jpg",
      },
    ]);
    assert.doesNotMatch(JSON.stringify(drinks), /hpp|quantity|sold|cost/i);
  });

  it("charges a discounted drink like the cashier's menu card", () => {
    const [matcha] = rankDrinks([{ menuItemId: 6, name: "Matcha Latte", quantity: 1 }], menus, options);
    assert.equal(matcha.price, 18000);
    assert.equal(finalPriceOf(19999, 10), 17999);
    assert.equal(finalPriceOf(null, 10), null);
  });

  it("builds image URLs from the base, keeping absolute ones", () => {
    assert.equal(toImageUrl("/uploads/menu/a.jpg", "https://x.test"), "https://x.test/uploads/menu/a.jpg");
    assert.equal(toImageUrl("https://cdn.test/a.jpg", "https://x.test"), "https://cdn.test/a.jpg");
    assert.equal(toImageUrl(null, "https://x.test"), null);
  });

  it("asks for X-API-Key when PUBLIC_API_KEY is set", () => {
    const run = (key) => {
      let passed;
      requirePublicApiKey({ get: (name) => (name === "x-api-key" ? key : undefined) }, {}, (error) => {
        passed = error;
      });
      return passed;
    };

    assert.equal(run("unit-key"), undefined);
    assert.equal(run("wrong").status, 401);
    assert.equal(run(undefined).status, 401);
  });
});
