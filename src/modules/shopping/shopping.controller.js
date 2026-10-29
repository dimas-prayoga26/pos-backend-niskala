const createHttpError = require("http-errors");
const { emitRealtimeEvent } = require("../../infrastructure/realtime/socket");
const asyncHandler = require("../../shared/http/asyncHandler");
const { isAdmin } = require("../../shared/middleware/authorize");
const attachments = require("./shopping.attachments");
const shopping = require("./shopping.service");
const supplyShopping = require("./shopping.supply");

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

// Staff save drafts ("Simpan Draft"); posting moves stock and saldo, so only
// admins post ("Simpan & Posting" or approving a draft).
const requirePostingRight = (req) => {
  if (req.body?.status !== "draft" && !isAdmin(req)) {
    throw createHttpError(403, "Hanya admin yang bisa memposting belanja. Simpan sebagai draft.");
  }
};
const notifyNota = (prefix, action, movedStock) => {
  if (movedStock) {
    emitRealtimeEvent("stock:changed", { action: `${prefix}-${action === "created" ? "received" : action}` });
  }
  emitRealtimeEvent("shopping:changed", { action: `${prefix}-${action}` });
};

// Handlers for one kind of nota (belanja bahan baku or perlengkapan).
const notaHandlers = (service, prefix) => ({
  list: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.list(req.query) });
  }),
  listDrafts: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.listDrafts() });
  }),
  // A replayed request (same requestId and payload) returns 200 without side effects.
  create: asyncHandler(async (req, res) => {
    requirePostingRight(req);
    const data = await service.save(req.body, req.user);
    if (!data.duplicate) notifyNota(prefix, "created", data.status === "posted");
    res.status(data.duplicate ? 200 : 201).json({ success: true, data });
  }),
  updateDraft: asyncHandler(async (req, res) => {
    requirePostingRight(req);
    const data = await service.updateDraft(req.params.id, req.body, req.user);
    notifyNota(prefix, data.status === "posted" ? "posted" : "draft-updated", data.status === "posted");
    res.json({ success: true, data });
  }),
  removeDraft: asyncHandler(async (req, res) => {
    const data = await service.removeDraft(req.params.id);
    notifyNota(prefix, "draft-deleted", false);
    res.json({ success: true, data });
  }),
  updateItem: asyncHandler(async (req, res) => {
    const data = await service.updateItem(req.params.id, req.body, req.user);
    notifyNota(prefix, "item-updated", true);
    res.json({ success: true, data });
  }),
  deleteItem: asyncHandler(async (req, res) => {
    const data = await service.deleteItem(req.params.id, req.user);
    notifyNota(prefix, "item-deleted", true);
    res.json({ success: true, data });
  }),
});
const raw = notaHandlers(shopping, "purchase");
const supply = notaHandlers(supplyShopping, "supply-purchase");

// Bukti nota handlers for one kind of nota. Staff may change the photos of
// a draft; only admins those of a posted nota.
const receiptHandlers = (receipts) => ({
  add: asyncHandler(async (req, res) => {
    const data = await receipts.add(req.params.id, req.files, req.user?.id, { onlyDraft: !isAdmin(req) });
    emitRealtimeEvent("shopping:changed", { action: "purchase-attachments-added" });
    res.status(201).json({ success: true, data });
  }),
  // Served inline to logged-in users only; the photo never changes, so the
  // browser may cache it privately.
  get: asyncHandler(async (req, res) => {
    const attachment = await receipts.find(req.params.id);
    res.set({
      "Cache-Control": "private, max-age=86400",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    });
    res.type(attachment.mimeType);
    res.sendFile(attachment.filePath, (error) => {
      if (error && !res.headersSent) {
        res.status(404).json({ status: 404, message: "File bukti nota tidak ditemukan." });
      }
    });
  }),
  remove: asyncHandler(async (req, res) => {
    const data = await receipts.remove(req.params.id, { onlyDraft: !isAdmin(req) });
    emitRealtimeEvent("shopping:changed", { action: "purchase-attachment-deleted" });
    res.json({ success: true, data });
  }),
});
const rawReceipts = receiptHandlers(attachments);
const supplyReceipts = receiptHandlers(attachments.supply);

module.exports = {
  addPurchaseAttachments: rawReceipts.add,
  addSupplyPurchaseAttachments: supplyReceipts.add,
  createPurchase: raw.create,
  createSupplier,
  createSupplyPurchase: supply.create,
  deletePurchaseAttachment: rawReceipts.remove,
  deletePurchaseDraft: raw.removeDraft,
  deletePurchaseItem: raw.deleteItem,
  deleteSupplyPurchaseAttachment: supplyReceipts.remove,
  deleteSupplyPurchaseDraft: supply.removeDraft,
  deleteSupplyPurchaseItem: supply.deleteItem,
  getPurchaseAttachment: rawReceipts.get,
  getPurchaseDrafts: raw.listDrafts,
  getPurchases: raw.list,
  getSupplyPurchaseAttachment: supplyReceipts.get,
  getSupplyPurchaseDrafts: supply.listDrafts,
  getSupplyPurchases: supply.list,
  getSuppliers,
  updatePurchaseDraft: raw.updateDraft,
  updatePurchaseItem: raw.updateItem,
  updateSupplier,
  updateSupplyPurchaseDraft: supply.updateDraft,
  updateSupplyPurchaseItem: supply.updateItem,
};
