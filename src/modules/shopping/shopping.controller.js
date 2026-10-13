const { emitRealtimeEvent } = require("../../infrastructure/realtime/socket");
const asyncHandler = require("../../shared/http/asyncHandler");
const shopping = require("./shopping.service");

const getSuppliers = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await shopping.suppliers() });
});

// Explicit saves from Settings; the shopping form keeps new names local until purchase save.
const createSupplier = asyncHandler(async (req, res) => {
  const data = await shopping.saveSupplier({ name: req.body?.name });
  emitRealtimeEvent("shopping:changed", { action: "supplier-created" });
  res.status(201).json({ success: true, data });
});

const updateSupplier = asyncHandler(async (req, res) => {
  const data = await shopping.saveSupplier({ id: req.params.id, name: req.body?.name });
  emitRealtimeEvent("shopping:changed", { action: "supplier-updated" });
  res.json({ success: true, data });
});

const getPurchases = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await shopping.list(req.query) });
});

// A replayed request (same requestId and payload) returns 200 without side effects.
const createPurchase = asyncHandler(async (req, res) => {
  const data = await shopping.save(req.body, req.user);
  if (!data.duplicate) {
    emitRealtimeEvent("stock:changed", { action: "purchase-received" });
    emitRealtimeEvent("shopping:changed", { action: "purchase-created" });
  }
  res.status(data.duplicate ? 200 : 201).json({ success: true, data });
});

const updatePurchaseItem = asyncHandler(async (req, res) => {
  const data = await shopping.updateItem(req.params.id, req.body, req.user);
  emitRealtimeEvent("stock:changed", { action: "purchase-item-updated" });
  emitRealtimeEvent("shopping:changed", { action: "purchase-item-updated" });
  res.json({ success: true, data });
});

const deletePurchaseItem = asyncHandler(async (req, res) => {
  const data = await shopping.deleteItem(req.params.id, req.user);
  emitRealtimeEvent("stock:changed", { action: "purchase-item-deleted" });
  emitRealtimeEvent("shopping:changed", { action: "purchase-item-deleted" });
  res.json({ success: true, data });
});

module.exports = {
  createPurchase,
  createSupplier,
  deletePurchaseItem,
  getPurchases,
  getSuppliers,
  updatePurchaseItem,
  updateSupplier,
};
