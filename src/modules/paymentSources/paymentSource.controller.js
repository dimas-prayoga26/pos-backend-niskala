const { emitRealtimeEvent } = require("../../infrastructure/realtime/socket");
const asyncHandler = require("../../shared/http/asyncHandler");
const { isAdmin } = require("../../shared/middleware/authorize");
const PaymentSource = require("./paymentSource.service");

// Balances change with purchases too, so clients refresh them on shopping:changed.
const notify = (action) => emitRealtimeEvent("shopping:changed", { action });

// Kasir get the active sources only, with balance null.
const getPaymentSources = asyncHandler(async (req, res) => {
  const admin = isAdmin(req);
  const data = await PaymentSource.list({ includeInactive: admin && req.query.includeInactive === "true" });
  res.json({ success: true, data: admin ? data : data.map((source) => ({ ...source, balance: null })) });
});

const addPaymentSource = asyncHandler(async (req, res) => {
  const data = await PaymentSource.save({ name: req.body?.name, isActive: req.body?.isActive !== false });
  notify("payment-source-created");
  res.status(201).json({ success: true, data });
});

// Sources are deactivated, never deleted: their mutations stay in the history.
const updatePaymentSource = asyncHandler(async (req, res) => {
  const data = await PaymentSource.save({
    id: req.params.id,
    name: req.body?.name,
    isActive: req.body?.isActive !== false,
  });
  notify("payment-source-updated");
  res.json({ success: true, data });
});

const getPaymentSourceMutations = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await PaymentSource.listMutations(req.params.id, req.query) });
});

const addPaymentSourceMutation = asyncHandler(async (req, res) => {
  const data = await PaymentSource.recordMutation(req.params.id, req.body, req.user?.id);
  notify("payment-source-mutation");
  res.status(201).json({ success: true, data });
});

module.exports = {
  addPaymentSource,
  addPaymentSourceMutation,
  getPaymentSourceMutations,
  getPaymentSources,
  updatePaymentSource,
};
