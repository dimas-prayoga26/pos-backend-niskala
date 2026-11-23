const createHttpError = require("http-errors");
const asyncHandler = require("../../shared/http/asyncHandler");
const { LoyaltyRefusedError, LoyaltyUnavailableError } = require("./loyalty.client");
const loyaltyRewards = require("./loyalty.rewards");
const loyaltyService = require("./loyalty.service");

// Loyalty errors keep their status; the refusal reason goes in details so
// the cashier screen can tell "not ready" from "loyalty is down".
const toHttpError = (error) => {
  if (error instanceof LoyaltyRefusedError) {
    return createHttpError(error.statusCode, error.message, {
      details: { reason: error.reason, errors: error.details },
    });
  }
  if (error instanceof LoyaltyUnavailableError) {
    return createHttpError(503, "Loyalty sedang tidak tersedia.", {
      details: { reason: "unavailable" },
    });
  }
  return error;
};

const getCustomer = asyncHandler(async (req, res, next) => {
  try {
    const data = await loyaltyService.lookupCustomer(req.params.phone);
    res.set("Cache-Control", "no-store");
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(toHttpError(error));
  }
});

const redeemReward = asyncHandler(async (req, res, next) => {
  const phone = String(req.body?.phone || "").trim();
  const rewardStamps = Number(req.body?.rewardStamps);

  if (!phone || !Number.isInteger(rewardStamps) || rewardStamps <= 0) {
    return next(createHttpError(400, "Nomor HP dan hadiah wajib diisi."));
  }

  try {
    const data = await loyaltyService.redeemReward({
      phone,
      rewardStamps,
      cashierId: req.user?._id,
    });
    res.status(201).json({ success: true, message: "Hadiah ditukar.", data });
  } catch (error) {
    next(toHttpError(error));
  }
});

// Program Promo. Read by every signed-in user (the menu form
// lists the rewards); changed by admins only (routes).
const withLoyalty = (run) =>
  asyncHandler(async (req, res, next) => {
    try {
      const data = await run(req);
      res.set("Cache-Control", "no-store");
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(toHttpError(error));
    }
  });

const getProgram = withLoyalty(() => loyaltyService.getProgram());

const updateProgram = withLoyalty((req) => {
  if (typeof req.body?.active !== "boolean") {
    throw createHttpError(400, "Status program wajib diisi.");
  }
  return loyaltyService.setProgramActive(req.body.active);
});

const addReward = withLoyalty((req) => {
  const stamps = Number(req.body?.stamps);
  const label = String(req.body?.label || "").trim();
  if (!Number.isInteger(stamps) || stamps <= 0 || !label) {
    throw createHttpError(400, "Stamp dan nama hadiah wajib diisi.");
  }
  return loyaltyService.addReward({ stamps, label, short: String(req.body?.short || "").trim() });
});

// Stamp Card → Riwayat: ?page=&perPage=&q= (phone, customer code or name).
const historyQuery = (req) => {
  const page = Number(req.query.page) || 1;
  const perPage = Number(req.query.perPage) || 20;
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
    throw createHttpError(400, "Halaman riwayat tidak valid.");
  }
  return { page, perPage, q: String(req.query.q || "").slice(0, 50) };
};

const listStamps = withLoyalty((req) => loyaltyService.listStamps(historyQuery(req)));

const listRedemptions = withLoyalty((req) => loyaltyService.listRedemptions(historyQuery(req)));

// promoMenuItemId: the Promo loyalty menu Tukar gives for the reward (null:
// none yet), checked against the POS menus before loyalty keeps it.
const updateReward = withLoyalty(async (req) => {
  const patch = {};
  if (typeof req.body?.active === "boolean") patch.active = req.body.active;
  if (req.body?.label !== undefined) patch.label = String(req.body.label).trim();
  if (req.body?.short !== undefined) patch.short = String(req.body.short || "").trim() || null;
  if (req.body?.promoMenuItemId !== undefined) {
    const menuItemId = req.body.promoMenuItemId === null ? null : Number(req.body.promoMenuItemId);
    if (menuItemId !== null) {
      if (!Number.isInteger(menuItemId) || menuItemId <= 0) {
        throw createHttpError(400, "Menu promo tidak valid.");
      }
      await loyaltyRewards.assertLoyaltyPromoMenu(menuItemId);
    }
    patch.promo_menu_item_id = menuItemId;
  }
  if (!Object.keys(patch).length) {
    throw createHttpError(400, "Tidak ada yang diubah.");
  }
  return loyaltyService.updateReward(req.params.id, patch);
});

module.exports = {
  addReward,
  getCustomer,
  getProgram,
  listRedemptions,
  listStamps,
  redeemReward,
  updateProgram,
  updateReward,
};
