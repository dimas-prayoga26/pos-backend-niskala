// Loyalty stamps for POS orders. The loyalty app owns every loyalty rule and
// row (loyalty_* tables); the POS only tells it which order was saved and
// which reward the cashier handed over.
const logger = require("../../shared/logger");
const client = require("./loyalty.client");

const STAMP_ORDER_TYPE = "Offline";

// Program Promo on/off as last heard from the loyalty app. Off, a saved
// order is not sent for a stamp at all. Every answer that carries it
// refreshes it; after PROGRAM_STATE_TTL_MS it is asked again.
const PROGRAM_STATE_TTL_MS = 60 * 1000;
let programState = null;

const rememberProgramActive = (active) => {
  if (typeof active === "boolean") programState = { active, at: Date.now() };
};

const forgetProgramState = () => {
  programState = null;
};

const lookupCustomer = async (phone, deps) => {
  const { data } = await client.request(
    "GET",
    `/customers/${encodeURIComponent(String(phone || "").trim())}`,
    undefined,
    deps
  );
  rememberProgramActive(data?.program_active);
  return data;
};

// orderId / menuItemId / menuName: the order the reward went out with and
// the menu given, when it is claimed in the POS.
const redeemReward = async ({ phone, rewardStamps, cashierId, orderId, menuItemId, menuName }, deps) => {
  const { data } = await client.request(
    "POST",
    "/redemptions",
    {
      phone,
      reward_stamps: rewardStamps,
      cashier_id: cashierId ?? null,
      ...(orderId ? { order_id: orderId } : {}),
      ...(menuItemId ? { menu_item_id: menuItemId } : {}),
      ...(menuName ? { menu_name: menuName } : {}),
    },
    deps
  );
  return data;
};

// Program Promo: the stamp card (on/off, rules) and its
// rewards. Every call answers with the whole program.
const programRequest = async (method, path, body, deps) => {
  const { data } = await client.request(method, path, body, deps);
  rememberProgramActive(data?.active);
  return data;
};

const getProgram = (deps) => programRequest("GET", "/program", undefined, deps);

const setProgramActive = (active, deps) => programRequest("PUT", "/program", { active: Boolean(active) }, deps);

const addReward = ({ stamps, label, short }, deps) =>
  programRequest("POST", "/rewards", { stamps, label, ...(short ? { short } : {}) }, deps);

// patch: { active?, label?, short?, promo_menu_item_id? }
const updateReward = (rewardId, patch, deps) =>
  programRequest("PUT", `/rewards/${encodeURIComponent(rewardId)}`, patch, deps);

// Program Promo → Riwayat: the rewards handed over, newest first.
// { data, meta: { page, per_page, total, last_page } }; q: phone, code or name.
const listRedemptions = async ({ page = 1, perPage = 20, q = "" } = {}, deps) => {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (String(q).trim()) params.set("q", String(q).trim());
  return (await client.request("GET", `/redemptions?${params}`, undefined, deps)).data;
};

// true / false; null when loyalty can't say, and the loyalty app's own
// rules then decide.
const isProgramActive = async (deps) => {
  if (programState && Date.now() - programState.at < PROGRAM_STATE_TTL_MS) return programState.active;
  try {
    const program = await getProgram(deps);
    return typeof program?.active === "boolean" ? program.active : null;
  } catch {
    return null;
  }
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
// response; with the stamp card off it asks nothing. A lost call is picked
// up by the loyalty app's loyalty:sync-stamps, so a failure is only logged.
const stampOrderInBackground = async (order, cashierId, deps) => {
  if (!shouldStamp(order)) return null;
  if ((await isProgramActive(deps)) === false) return null;

  try {
    return await stampOrder(order.id, cashierId, deps);
  } catch (error) {
    logger.warn("Loyalty stamp not given", {
      orderId: order.id,
      reason: error.reason || "",
      error: error.message,
    });
    return null;
  }
};

module.exports = {
  addReward,
  forgetProgramState,
  getProgram,
  isProgramActive,
  listRedemptions,
  lookupCustomer,
  redeemReward,
  setProgramActive,
  updateReward,
  shouldStamp,
  stampOrder,
  stampOrderInBackground,
};
