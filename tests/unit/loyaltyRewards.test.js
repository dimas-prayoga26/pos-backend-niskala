const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { LoyaltyRefusedError, LoyaltyUnavailableError } = require("../../src/modules/loyalty/loyalty.client");
const {
  assertLoyaltyPromoMenu,
  prepareRewardOrder,
  redeemClaims,
} = require("../../src/modules/loyalty/loyalty.rewards");

// Program Promo links stamp 5 to Promo loyalty menu 50 (stamp 10 to 60).
const DRINK = { stamps: 5, label: "Minuman gratis", count: 1, promo_menu_item_id: 50 };
// The Promo loyalty menus (menu_items.is_loyalty_promo).
const REWARD_MENUS = new Map([
  [50, { name: "Loyalty Minuman Gratis" }],
  [60, { name: "Loyalty Makanan Gratis" }],
]);

const paidLine = { id: "3-40", sourceMenuItemId: 40, name: "Salted Creamy Latte", quantity: 1, price: 25000 };
const rewardLine = (overrides = {}) => ({
  id: "loyalty-5-50-1",
  sourceMenuItemId: 50,
  name: "Loyalty Minuman Gratis",
  quantity: 1,
  pricePerQuantity: 0,
  price: 0,
  bundleChoices: [{ menuItemId: 11, name: "Americano", quantity: 1 }],
  loyaltyReward: { stamps: 5, label: "Minuman gratis" },
  ...overrides,
});
const order = (items, overrides = {}) => ({
  orderType: "Offline",
  customerDetails: { name: "Budi", phone: "1234567890" },
  items,
  ...overrides,
});

// Fakes for the loyalty app and the reward menus; records what was asked.
const fakeDeps = ({ customer = { registered: true, ready_rewards: [DRINK] }, lookupError, redeemError } = {}) => {
  const calls = { lookup: [], redeem: [] };
  return {
    calls,
    deps: {
      lookupCustomer: async (phone) => {
        calls.lookup.push(phone);
        if (lookupError) throw lookupError;
        return customer;
      },
      findRewardMenus: async (ids) =>
        new Map(ids.filter((id) => REWARD_MENUS.has(id)).map((id) => [id, REWARD_MENUS.get(id)])),
      redeemReward: async (payload) => {
        calls.redeem.push(payload);
        if (redeemError) throw redeemError;
        return { redeemed: true };
      },
    },
  };
};

describe("loyalty rewards in an order", () => {
  it("leaves an order without reward menus alone, without asking loyalty", async () => {
    const { calls, deps } = fakeDeps();
    const data = order([paidLine]);

    const result = await prepareRewardOrder(data, deps);

    assert.equal(result.orderData, data);
    assert.deepEqual(result.claims, []);
    assert.deepEqual(calls.lookup, []);
  });

  it("makes the reward promo free and lists what to redeem", async () => {
    const { calls, deps } = fakeDeps();

    const { orderData, claims } = await prepareRewardOrder(
      order([paidLine, rewardLine({ price: 18000, discountPercent: 0 })]),
      deps
    );

    assert.deepEqual(calls.lookup, ["1234567890"]);
    // Free whatever the client sent; the paid line is untouched.
    assert.equal(orderData.items[0], paidLine);
    assert.equal(orderData.items[1].price, 0);
    assert.equal(orderData.items[1].discountPercent, 100);
    assert.deepEqual(claims, [
      {
        stamps: 5,
        label: "Minuman gratis",
        quantity: 1,
        lineId: "loyalty-5-50-1",
        menuItemId: 50,
        menuName: "Loyalty Minuman Gratis",
      },
    ]);
  });

  it("knows a reward by its menu, not by what the cashier's screen says", async () => {
    // Added without the flag (e.g. an old screen): still a reward, still checked.
    const notReady = fakeDeps({ customer: { registered: true, ready_rewards: [] } });
    await assert.rejects(prepareRewardOrder(order([rewardLine({ loyaltyReward: undefined })]), notReady.deps), {
      status: 422,
      message: "Loyalty Minuman Gratis belum bisa ditukar.",
    });

    // Flagged, but its menu is not a Promo loyalty menu.
    const { deps } = fakeDeps();
    await assert.rejects(prepareRewardOrder(order([{ ...paidLine, loyaltyReward: { stamps: 5 } }]), deps), {
      status: 422,
      message: "Salted Creamy Latte bukan menu Promo loyalty.",
    });
  });

  it("counts a Promo loyalty menu only for the ready reward Program Promo links it to", async () => {
    // Stamp 5 is ready but linked to another promo menu (70).
    const otherLink = fakeDeps({ customer: { registered: true, ready_rewards: [{ ...DRINK, promo_menu_item_id: 70 }] } });
    await assert.rejects(prepareRewardOrder(order([rewardLine()]), otherLink.deps), {
      status: 422,
      message: "Minuman gratis belum bisa ditukar.",
    });

    // Not linked to any menu yet.
    const unlinked = fakeDeps({ customer: { registered: true, ready_rewards: [{ ...DRINK, promo_menu_item_id: null }] } });
    await assert.rejects(prepareRewardOrder(order([rewardLine()]), unlinked.deps), { status: 422 });
  });

  it("lets Program Promo link only a Promo loyalty menu", async () => {
    const { deps } = fakeDeps();

    await assertLoyaltyPromoMenu(50, deps);
    await assert.rejects(assertLoyaltyPromoMenu(40, deps), {
      status: 400,
      message: "Pilih menu PROMO yang jenisnya Promo loyalty.",
    });
  });

  it("refuses a reward while the stamp card is switched off", async () => {
    const off = fakeDeps({ customer: { program_active: false, registered: true, ready_rewards: [DRINK] } });

    await assert.rejects(prepareRewardOrder(order([rewardLine()]), off.deps), {
      status: 422,
      message: "Program Stamp Card sedang tidak aktif.",
    });
  });

  it("refuses a reward outside an Offline order with a phone", async () => {
    const { deps } = fakeDeps();

    await assert.rejects(prepareRewardOrder(order([rewardLine()], { orderType: "Online" }), deps), {
      status: 400,
      message: "Hadiah loyalty hanya untuk order Offline dengan nomor HP.",
    });
    await assert.rejects(prepareRewardOrder(order([rewardLine()], { customerDetails: { phone: "" } }), deps), {
      status: 400,
    });
  });

  it("refuses a reward that is not ready, or more of it than is ready", async () => {
    const { deps } = fakeDeps();
    await assert.rejects(prepareRewardOrder(order([rewardLine(), rewardLine({ id: "loyalty-5-50-2" })]), deps), {
      status: 422,
      message: "Minuman gratis belum bisa ditukar.",
    });
    await assert.rejects(
      prepareRewardOrder(
        order([
          rewardLine({
            id: "loyalty-10-60-1",
            sourceMenuItemId: 60,
            name: "Loyalty Makanan Gratis",
            loyaltyReward: { stamps: 10, label: "Makanan gratis" },
          }),
        ]),
        deps
      ),
      { status: 422, message: "Makanan gratis belum bisa ditukar." }
    );

    const unregistered = fakeDeps({ customer: { registered: false } });
    await assert.rejects(prepareRewardOrder(order([rewardLine()]), unregistered.deps), {
      status: 422,
      message: "Nomor ini belum punya kartu stamp.",
    });
  });

  it("stops the order when loyalty can't be reached, and passes its refusals on", async () => {
    const down = fakeDeps({ lookupError: new LoyaltyUnavailableError("Loyalty tidak dapat dihubungi.") });
    await assert.rejects(prepareRewardOrder(order([rewardLine()]), down.deps), {
      status: 503,
      message: "Loyalty tidak dapat dihubungi. Hadiah belum bisa ditukar.",
    });

    const invalid = fakeDeps({
      lookupError: new LoyaltyRefusedError(422, { message: "Nomor HP tidak valid.", reason: "invalid_phone" }),
    });
    await assert.rejects(prepareRewardOrder(order([rewardLine()]), invalid.deps), {
      status: 422,
      message: "Nomor HP tidak valid.",
    });
  });

  it("redeems each reward with the saved order, the promo menu and what was picked", async () => {
    const { calls, deps } = fakeDeps();
    const saved = {
      id: 88,
      customerDetails: { phone: "1234567890" },
      items: [{ id: "loyalty-5-50-1", bundleChoices: [{ menuItemId: 11, name: "Americano", quantity: 1 }] }],
    };
    const claims = [
      { stamps: 5, label: "Minuman gratis", quantity: 1, lineId: "loyalty-5-50-1", menuItemId: 50, menuName: "Loyalty Minuman Gratis" },
    ];

    const result = await redeemClaims(saved, claims, 7, deps);

    assert.deepEqual(calls.redeem, [
      {
        phone: "1234567890",
        rewardStamps: 5,
        cashierId: 7,
        orderId: 88,
        menuItemId: 50,
        menuName: "Loyalty Minuman Gratis (Americano)",
      },
    ]);
    assert.deepEqual(result, {
      redeemed: [{ label: "Minuman gratis", menuName: "Loyalty Minuman Gratis (Americano)" }],
      warnings: [],
    });
  });

  it("reports a reward loyalty would not record, the order standing", async () => {
    const { deps } = fakeDeps({
      redeemError: new LoyaltyRefusedError(422, { message: "Minuman gratis belum bisa ditukar.", reason: "reward_not_ready" }),
    });
    const claims = [
      { stamps: 5, label: "Minuman gratis", quantity: 1, lineId: "x", menuItemId: 50, menuName: "Loyalty Minuman Gratis" },
    ];

    const result = await redeemClaims({ id: 89, customerDetails: { phone: "1234567890" }, items: [] }, claims, 7, deps);

    assert.deepEqual(result.redeemed, []);
    assert.deepEqual(result.warnings, [
      "Minuman gratis (Loyalty Minuman Gratis) belum tercatat di loyalty: Minuman gratis belum bisa ditukar.",
    ]);
  });
});
