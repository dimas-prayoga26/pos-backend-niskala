// Receipt printing through the RawBT Android app: an authenticated client
// registers a print job and gets a short-lived URL; RawBT fetches it without a
// session, so the random token in the URL is the only credential.
const createHttpError = require("http-errors");
const asyncHandler = require("../../shared/http/asyncHandler");
const orderService = require("./order.service");
const {
  THERMAL_PRINT_TTL_MS,
  createThermalPrintJob,
  getThermalPrintJob,
  toBluetoothPrintResponse,
} = require("./thermalPrint.store");

const PRINT_DOCUMENT_HEADERS = {
  "Cache-Control": "no-store, private",
  "Content-Type": "application/json; charset=utf-8",
  "X-Robots-Tag": "noindex, nofollow",
};

// Honors reverse-proxy headers so the URL works from the tablet's network.
const getRequestOrigin = (req) => {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const protocol = forwardedProto || req.protocol;
  const host = forwardedHost || req.get("host");

  if (!host) return "";

  return `${protocol}://${host}`;
};

const createThermalPrintUrl = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const order = await orderService.findById(id);
  if (!order) {
    return next(createHttpError(404, "Order not found!"));
  }

  const token = createThermalPrintJob({
    orderId: id,
    payload: req.body?.payload,
    userId: req.user?._id || req.user?.id,
  });
  const origin = getRequestOrigin(req);

  if (!origin) {
    return next(createHttpError(500, "Unable to build thermal print URL."));
  }

  return res.status(201).json({
    success: true,
    data: {
      expiresInSeconds: Math.floor(THERMAL_PRINT_TTL_MS / 1000),
      url: `${origin}/api/order/${id}/thermal-print/${token}`,
    },
  });
});

const getThermalPrintDocument = asyncHandler(async (req, res, next) => {
  const job = getThermalPrintJob({ orderId: req.params.id, token: req.params.token });

  if (!job) {
    return next(createHttpError(404, "Thermal print URL expired or invalid."));
  }

  res.set(PRINT_DOCUMENT_HEADERS);
  return res.status(200).json(toBluetoothPrintResponse(job.payload));
});

module.exports = {
  createThermalPrintUrl,
  getThermalPrintDocument,
};
