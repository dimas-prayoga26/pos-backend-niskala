const createHttpError = require("http-errors");
const asyncHandler = require("../../shared/http/asyncHandler");
const { LoyaltyRefusedError, LoyaltyUnavailableError } = require("./loyalty.client");
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

module.exports = { getCustomer, redeemReward };
