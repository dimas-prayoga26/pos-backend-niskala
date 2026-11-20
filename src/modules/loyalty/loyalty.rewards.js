// Loyalty rewards claimed in the POS order. A reward is given as a Kategori
// Promo menu marked for its stamp (menu_items.loyalty_reward_stamps: 5
// Minuman gratis, 10 Makanan gratis), a free promo whose choice the cashier
// picks (the coffee, the rice bowl) like any promo package. It is checked
// with the loyalty app before the order is saved, made free, and redeemed
// (linked to the order and the promo menu) right after.
const createHttpError = require("http-errors");
const { pool } = require("../../infrastructure/database/pool");
const logger = require("../../shared/logger");
const { getSourceMenuItemId } = require("../orders/order.items");
const { LoyaltyRefusedError } = require("./loyalty.client");
const loyaltyService = require("./loyalty.service");

const REWARD_ORDER_TYPE = "Offline";

// The promo menus among these that are a loyalty reward: id -> { name, stamps }.
const findRewardMenus = async (menuItemIds) => {
  if (!menuItemIds.length) return new Map();

  const [rows] = await pool.query(
    "SELECT id, name, loyalty_reward_stamps FROM menu_items WHERE id IN (?) AND loyalty_reward_stamps IS NOT NULL",
    [menuItemIds]
  );
  return new Map(rows.map((row) => [Number(row.id), { name: row.name, stamps: Number(row.loyalty_reward_stamps) }]));
};

const defaultDeps = {
  lookupCustomer: loyaltyService.lookupCustomer,
  redeemReward: loyaltyService.redeemReward,
  findRewardMenus,
};

const refuse = (status, message) => createHttpError(status, message);
const wholeQuantity = (item) => Math.max(Math.trunc(Number(item.quantity) || 0), 1);

// Before the order is saved. A line is a reward when its menu is marked as
// one in the database, whatever the client says. Returns the order with
// those lines made free and what to redeem once it is saved; an order
// without rewards comes back as it is, without asking loyalty.
const prepareRewardOrder = async (orderData, deps = defaultDeps) => {
  const items = orderData?.items || [];
  const menuIds = [...new Set(items.map((item) => Number(getSourceMenuItemId(item))).filter(Boolean))];
  const rewardMenus = await deps.findRewardMenus(menuIds);
  const rewardMenuOf = (item) => rewardMenus.get(Number(getSourceMenuItemId(item)));

  const flaggedButNotReward = items.find((item) => item.loyaltyReward && !rewardMenuOf(item));
  if (flaggedButNotReward) {
    throw refuse(422, `${flaggedButNotReward.name || "Menu ini"} bukan menu hadiah loyalty.`);
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
  if (!customer?.registered) {
    throw refuse(422, "Nomor ini belum punya kartu stamp.");
  }

  const readyRewards = new Map((customer.ready_rewards || []).map((reward) => [Number(reward.stamps), reward]));
  const claims = [];
  const claimedPerReward = new Map();
  for (const item of rewardLines) {
    const menu = rewardMenuOf(item);
    const reward = readyRewards.get(menu.stamps);
    const label = reward?.label || item.loyaltyReward?.label || menu.name;
    const quantity = wholeQuantity(item);
    const claimed = (claimedPerReward.get(menu.stamps) || 0) + quantity;

    if (!reward || claimed > (Number(reward.count) || 0)) {
      throw refuse(422, `${label} belum bisa ditukar.`);
    }
    claimedPerReward.set(menu.stamps, claimed);
    claims.push({
      stamps: menu.stamps,
      label,
      quantity,
      lineId: item.id,
      menuItemId: Number(getSourceMenuItemId(item)),
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

module.exports = { prepareRewardOrder, redeemClaims };
