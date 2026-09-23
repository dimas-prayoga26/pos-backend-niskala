const router = require("express").Router();
const createError = require("http-errors");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const shopping = require("../models/shoppingModel");
const { emitRealtimeEvent } = require("../config/socket");
router.use(isVerifiedUser);
const handler = fn => async (req,res,next) => { try { await fn(req,res); } catch (error) { next(error); } };
const admin = (req,res,next) => req.user?.role?.toLowerCase() === "admin" ? next() : next(createError(403,"Hanya admin yang bisa mengelola belanja dan suplier."));
router.get("/suppliers", handler(async (req,res) => res.json({success:true,data:await shopping.suppliers()})));
// Explicit saves from Settings; shopping Select2 keeps new names local until purchase save.
router.post("/suppliers", admin, handler(async (req,res) => {
  const data = await shopping.saveSupplier({ name: req.body?.name });
  emitRealtimeEvent("shopping:changed", {action:"supplier-created"});
  res.status(201).json({success:true,data});
}));
router.put("/suppliers/:id", admin, handler(async (req,res) => {
  const data = await shopping.saveSupplier({ id: req.params.id, name: req.body?.name });
  emitRealtimeEvent("shopping:changed", {action:"supplier-updated"});
  res.json({success:true,data});
}));
router.get("/purchases", handler(async (req,res) => res.json({success:true,data:await shopping.list(req.query)})));
router.post("/purchases", admin, handler(async (req,res) => {
  const data = await shopping.save(req.body, req.user);
  if (!data.duplicate) {
    emitRealtimeEvent("stock:changed", {action:"purchase-received"});
    emitRealtimeEvent("shopping:changed", {action:"purchase-created"});
  }
  res.status(data.duplicate ? 200 : 201).json({success:true,data});
}));
router.put("/purchase-items/:id", admin, handler(async (req,res) => {
  const data = await shopping.updateItem(req.params.id, req.body, req.user);
  emitRealtimeEvent("stock:changed", {action:"purchase-item-updated"});
  emitRealtimeEvent("shopping:changed", {action:"purchase-item-updated"});
  res.json({success:true,data});
}));
router.delete("/purchase-items/:id", admin, handler(async (req,res) => {
  const data = await shopping.deleteItem(req.params.id, req.user);
  emitRealtimeEvent("stock:changed", {action:"purchase-item-deleted"});
  emitRealtimeEvent("shopping:changed", {action:"purchase-item-deleted"});
  res.json({success:true,data});
}));
module.exports = router;
