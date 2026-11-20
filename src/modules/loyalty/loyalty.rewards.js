// Loyalty rewards claimed in the POS order. A reward is given as a Kategori
// Promo menu set as Promo loyalty (menu_items.is_loyalty_promo), a free promo
// whose choice the cashier picks (the coffee, the rice bowl) like any promo
// package. Which reward a promo menu is for is set in the loyalty app
// (Program Promo: the reward's promo_menu_item_id). It is
// checked with the loyalty app before the order is saved, made free, and
// redeemed (linked to the order and the promo menu) right after.
const createHttpError = require("http-errors");
const { pool } = require("../../infrastructure/database/pool");
const logger = require("../../shared/logger");
const { getSourceMenuItemId } = require("../orders/order.items");
const { LoyaltyRefusedError } = require("./loyalty.client");
const loyaltyService = require("./loyalty.service");

const REWARD_ORDER_TYPE = "Offline";

// The Promo loyalty menus among these: id -> { name }.
const findRewardMenus = async (menuItemIds) => {
  if (!menuItemIds.length) return new Map();

  const [rows] = await pool.query(
    "SELECT id, name FROM menu_items WHERE id IN (?) AND is_loyalty_promo = TRUE",
    [menuItemIds]
  );
  return new Map(rows.map((row) => [Number(row.id), { name: row.name }]));
};

// Program Promo links a reward to a menu only if it is a Promo loyalty menu.
const assertLoyaltyPromoMenu = async (menuItemId, deps = { findRewardMenus }) => {
  const menus = await deps.findRewardMenus([Number(menuItemId)]);
  if (!menus.has(Number(menuItemId))) {
    throw refuse(400, "Pilih menu PROMO yang jenisnya Promo loyalty.");
  }
};

const defaultDeps = {
  lookupCustomer: loyaltyService.lookupCustomer,
  redeemReward: loyaltyService.redeemReward,
  findRewardMenus,
};

function refuse(status, message) {
  return createHttpError(status, message);
}
const wholeQuantity = (item) => Math.max(Math.trunc(Number(item.quantity) || 0), 1);

// Before the order is saved. A line is a reward when its menu is a Promo
// loyalty menu in the database, whatever the client says; it counts for the
// ready reward linked to that menu. Returns the order with those lines made
// free and what to redeem once it is saved; an order without rewards comes
// back as it is, without asking loyalty.
const prepareRewardOrder = async (orderData, deps = defaultDeps) => {
  const items = orderData?.items || [];
  const menuIds = [...new Set(items.map((item) => Number(getSourceMenuItemId(item))).filter(Boolean))];
  const rewardMenus = await deps.findRewardMenus(menuIds);
  const rewardMenuOf = (item) => rewardMenus.get(Number(getSourceMenuItemId(item)));

  const flaggedButNotReward = items.find((item) => item.loyaltyReward && !rewardMenuOf(item));
  if (flaggedButNotReward) {
    throw refuse(422, `${flaggedButNotReward.name || "Menu ini"} bukan menu Promo loyalty.`);
  }

  const rewardLines = items.filter(rewardMenuOf);
  if (!rewardLines.length) return { orderData, claims: [] };

  const phone = String(orderData.customerDetails?.phone || "").trim();
  if ((orderData.orderType || REWARD_ORDER_TYPE) !== REWARD_ORDER_TYPE || !phone) {
    throw refuse(400, "Hadiah loyalty hanya untuk order Offline dengan nomor HP.");
  }

  let customer;
  try {
    customer = await deps.lookupCustomer(phone);
  } catch (error) {
    if (error instanceof LoyaltyRefusedError) throw refuse(422, error.message);
    throw refuse(503, "Loyalty tidak dapat dihubungi. Hadiah belum bisa ditukar.");
  }
  // Switched off in Program Promo.
  if (customer?.program_active === false) {
    throw refuse(422, "Program Stamp Card sedang tidak aktif.");
  }
  if (!customer?.registered) {
    throw refuse(422, "Nomor ini belum punya kartu stamp.");
  }

  const readyRewards = customer.ready_rewards || [];
  const claims = [];
  const claimedPerReward = new Map();
  for (const item of rewardLines) {
    const menu = rewardMenuOf(item);
    const menuItemId = Number(getSourceMenuItemId(item));
    const quantity = wholeQuantity(item);
    const leftOf = (reward) => (Number(reward.count) || 0) - (claimedPerReward.get(Number(reward.stamps)) || 0);
    // The ready rewards linked to this promo menu; the one the cashier
    // tapped Tukar for first.
    const linked = readyRewards.filter((reward) => Number(reward.promo_menu_item_id) === menuItemId);
    const reward =
      linked.find((candidate) => Number(candidate.stamps) === Number(item.loyaltyReward?.stamps) && leftOf(candidate) >= quantity) ||
      linked.find((candidate) => leftOf(candidate) >= quantity);

    if (!reward) {
      throw refuse(422, `${item.loyaltyReward?.label || menu.name} belum bisa ditukar.`);
    }
    claimedPerReward.set(Number(reward.stamps), (claimedPerReward.get(Number(reward.stamps)) || 0) + quantity);
    claims.push({
      stamps: Number(reward.stamps),
      label: reward.label,
      quantity,
      lineId: item.id,
      menuItemId,
      menuName: menu.name,
    });
  }

  return {
    orderData: {
      ...orderData,
      items: items.map((item) =>
        rewardMenuOf(item) ? { ...item, quantity: wholeQuantity(item), discountPercent: 100, price: 0 } : item
      ),
    },
    claims,
  };
};

// "Loyalty Minuman Gratis (Americano)": the promo menu and what was picked
// in it, as the saved order line has them.
const givenNameOf = (order, claim) => {
  const line = (order?.items || []).find((item) => String(item.id) === String(claim.lineId));
  const picked = (line?.bundleChoices || [])
    .map((choice) => (Number(choice.quantity) > 1 ? `${choice.quantity}x ${choice.name}` : choice.name))
    .join(", ");
  return (picked ? `${claim.menuName} (${picked})` : claim.menuName).slice(0, 120);
};

// After the order is saved: one redemption per reward given, linked to the
// order and the promo menu. The order stands either way; a refusal here
// (another cashier just took the same reward) is reported back and logged.
const redeemClaims = async (order, claims, cashierId, deps = defaultDeps) => {
  const phone = String(order?.customerDetails?.phone || "").trim();
  const redeemed = [];
  const warnings = [];

  for (const claim of claims) {
    const menuName = givenNameOf(order, claim);
    for (let unit = 0; unit < claim.quantity; unit++) {
      try {
        await deps.redeemReward({
          phone,
          rewardStamps: claim.stamps,
          cashierId,
          orderId: order.id,
          menuItemId: claim.menuItemId,
          menuName,
        });
        redeemed.push({ label: claim.label, menuName });
      } catch (error) {
        logger.warn("Loyalty reward not redeemed", {
          orderId: order.id,
          reward: claim.label,
          reason: error.reason || "",
          error: error.message,
        });
        warnings.push(`${claim.label} (${menuName}) belum tercatat di loyalty: ${error.message}`);
      }
    }
  }

  return { redeemed, warnings };
};

module.exports = { assertLoyaltyPromoMenu, prepareRewardOrder, redeemClaims };
