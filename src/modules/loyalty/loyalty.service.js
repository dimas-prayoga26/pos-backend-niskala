// Loyalty stamps for POS orders. The loyalty app owns every loyalty rule and
// row (loyalty_* tables); the POS only tells it which order was saved and
// which reward the cashier handed over.
const logger = require("../../shared/logger");
const client = require("./loyalty.client");

const STAMP_ORDER_TYPE = "Offline";

const lookupCustomer = async (phone, deps) => {
  const { data } = await client.request(
    "GET",
    `/customers/${encodeURIComponent(String(phone || "").trim())}`,
    undefined,
    deps
  );
  return data;
};

const redeemReward = async ({ phone, rewardStamps, cashierId }, deps) => {
  const { data } = await client.request(
    "POST",
    "/redemptions",
    { phone, reward_stamps: rewardStamps, cashier_id: cashierId ?? null },
    deps
  );
  return data;
};

const stampOrder = async (orderId, cashierId, deps) => {
  const { data } = await client.request(
    "POST",
    "/stamps",
    { order_id: orderId, cashier_id: cashierId ?? null },
    deps
  );
  return data;
};

// Only Offline orders keep the customer's phone, so only they earn stamps.
const shouldStamp = (order) =>
  client.isConfigured() &&
  Boolean(order?.id) &&
  (order.orderType || STAMP_ORDER_TYPE) === STAMP_ORDER_TYPE &&
  Boolean(String(order.customerDetails?.phone || "").trim());

// After an order is saved: asks for its stamp without holding up the
// response. A lost call is picked up by the loyalty app's
// loyalty:sync-stamps, so a failure is only logged.
const stampOrderInBackground = (order, cashierId, deps) => {
  if (!shouldStamp(order)) return Promise.resolve(null);

  return stampOrder(order.id, cashierId, deps).catch((error) => {
    logger.warn("Loyalty stamp not given", {
      orderId: order.id,
      reason: error.reason || "",
      error: error.message,
    });
    return null;
  });
};

module.exports = {
  lookupCustomer,
  redeemReward,
  shouldStamp,
  stampOrder,
  stampOrderInBackground,
};
