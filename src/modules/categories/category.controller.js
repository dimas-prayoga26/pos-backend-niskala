const createHttpError = require("http-errors");
const { emitRealtimeEvent } = require("../../infrastructure/realtime/socket");
const asyncHandler = require("../../shared/http/asyncHandler");
const { isAdmin } = require("../../shared/middleware/authorize");
const Category = require("./category.repository");
const { BEST_SELLER_GROUPS } = require("./bestSeller");

// Returns null for "no tax", undefined for an invalid value.
const parseCategoryTax = (value) => {
  if (value === undefined || value === null || value === "") return null;

  const taxRate = Number(value);

  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
    return undefined;
  }

  return taxRate;
};

const parseCategoryStatus = (value) => {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;

  const normalizedValue = String(value).toLowerCase();

  if (["true", "1", "active", "aktif"].includes(normalizedValue)) return true;
  if (["false", "0", "inactive", "nonaktif"].includes(normalizedValue)) {
    return false;
  }

  return Boolean(value);
};

// Kategori Promo flag; undefined when the request leaves it out.
const parseBundleFlag = (body) => {
  if (!Object.prototype.hasOwnProperty.call(body, "isBundle")) return undefined;
  const value = body.isBundle;
  return value === true || value === 1 || ["true", "1"].includes(String(value).toLowerCase());
};

const validateCategoryBody = ({ name }, taxRate) => {
  if (!name) return createHttpError(400, "Category name is required!");
  if (taxRate === undefined) {
    return createHttpError(400, "Category tax must be between 0 and 100.");
  }

  return null;
};

const getCategories = asyncHandler(async (req, res) => {
  const includeInactive = req.query.includeInactive === "true" && isAdmin(req);
  const categories = await Category.findAll({ includeInactive });

  res.status(200).json({ success: true, data: categories });
});

const addCategory = asyncHandler(async (req, res, next) => {
  const { name, icon } = req.body;
  const taxRate = parseCategoryTax(req.body.taxRate ?? req.body.tax);
  const validationError = validateCategoryBody(req.body, taxRate);

  if (validationError) return next(validationError);

  const category = await Category.create({
    name,
    icon,
    taxRate,
    isBundle: Boolean(parseBundleFlag(req.body)),
  });
  emitRealtimeEvent("menu:changed", {
    action: "category-created",
    categoryId: category.id,
  });
  res.status(201).json({ success: true, message: "Category added!", data: category });
});

const updateCategory = asyncHandler(async (req, res, next) => {
  const { name, icon } = req.body;
  const isActive = Object.prototype.hasOwnProperty.call(req.body, "isActive")
    ? parseCategoryStatus(req.body.isActive)
    : undefined;
  const taxRate = parseCategoryTax(req.body.taxRate ?? req.body.tax);
  const validationError = validateCategoryBody(req.body, taxRate);

  if (validationError) return next(validationError);

  const isBundle = parseBundleFlag(req.body);
  if (isBundle) {
    const choiceBundleNames = await Category.findChoiceBundleNames(req.params.id);
    if (choiceBundleNames.length) {
      return next(
        createHttpError(
          400,
          `Category ini jadi pilihan di paket ${choiceBundleNames.join(", ")}, jadi tidak bisa dijadikan Kategori Promo.`
        )
      );
    }
  }

  const category = await Category.update(req.params.id, {
    name,
    icon,
    taxRate,
    isActive,
    isBundle,
  });

  if (!category) {
    return next(createHttpError(404, "Category not found!"));
  }

  emitRealtimeEvent("menu:changed", {
    action: "category-updated",
    categoryId: category.id,
  });
  res.status(200).json({ success: true, message: "Category updated!", data: category });
});

const updateCategoryPositions = asyncHandler(async (req, res, next) => {
  const categoryIds = Array.isArray(req.body.categoryIds)
    ? req.body.categoryIds.map(Number).filter(Boolean)
    : [];

  if (!categoryIds.length) {
    return next(createHttpError(400, "Category positions are required!"));
  }

  const categories = await Category.updatePositions(categoryIds);

  emitRealtimeEvent("menu:changed", { action: "category-positions-updated" });
  res.status(200).json({
    success: true,
    message: "Category positions updated!",
    data: categories,
  });
});

// Pengaturan → Best Seller: { groups: { Makanan: [ids], Minuman: [ids], Snack: [ids] } },
// each category in at most one group; the rest are not shown.
const parseBestSellerGroups = (body) => {
  const input = body?.groups;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createHttpError(400, "Kategori Best Seller wajib diisi.");
  }
  const unknown = Object.keys(input).find((group) => !BEST_SELLER_GROUPS.includes(group));
  if (unknown) throw createHttpError(400, `Kolom Best Seller harus ${BEST_SELLER_GROUPS.join(", ")}.`);

  const seen = new Set();
  return Object.fromEntries(
    BEST_SELLER_GROUPS.map((group) => {
      const ids = input[group] ?? [];
      if (!Array.isArray(ids)) throw createHttpError(400, `Kategori ${group} harus berupa daftar.`);
      return [
        group,
        ids.map((value) => {
          const id = Number(value);
          if (!Number.isInteger(id) || id <= 0) throw createHttpError(400, "ID kategori tidak valid.");
          if (seen.has(id)) throw createHttpError(400, "Satu kategori hanya bisa masuk satu kolom.");
          seen.add(id);
          return id;
        }),
      ];
    })
  );
};

const updateBestSellerGroups = asyncHandler(async (req, res) => {
  const categories = await Category.updateBestSellerGroups(parseBestSellerGroups(req.body));

  emitRealtimeEvent("menu:changed", { action: "category-best-seller-updated" });
  res.status(200).json({
    success: true,
    message: "Kategori Best Seller disimpan.",
    data: categories,
  });
});

const deleteCategory = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const bundleNames = await Category.findBundleNamesUsing(id);

  if (bundleNames.length) {
    return next(
      createHttpError(
        409,
        `Menu di category ini dipakai di paket ${bundleNames.join(", ")}. Hapus dari paket dulu.`
      )
    );
  }

  const wholeChoiceNames = await Category.findWholeCategoryChoiceBundleNames(id);
  if (wholeChoiceNames.length) {
    return next(
      createHttpError(
        409,
        `Category ini jadi pilihan di paket ${wholeChoiceNames.join(", ")}. Pilih menu pilihannya dulu di paket.`
      )
    );
  }

  const deleted = await Category.remove(id);

  if (!deleted) {
    return next(createHttpError(404, "Category not found!"));
  }

  emitRealtimeEvent("menu:changed", {
    action: "category-deleted",
    categoryId: Number(id),
  });
  res.status(200).json({ success: true, message: "Category deleted!" });
});

module.exports = {
  addCategory,
  deleteCategory,
  getCategories,
  updateBestSellerGroups,
  updateCategory,
  updateCategoryPositions,
};
