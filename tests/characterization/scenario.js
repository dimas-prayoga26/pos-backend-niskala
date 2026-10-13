// End-to-end scenario covering every endpoint, role path and main error branch.
// Steps run in order against a fresh database; ids are deterministic.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const today = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

module.exports = async function scenario(api) {
  const { call, upload } = api;

  await call("root", "GET", "/");

  // --- users / auth -------------------------------------------------------
  await call("register missing fields", "POST", "/api/user/register", {
    body: { name: "X" },
  });
  await call("register invalid role", "POST", "/api/user/register", {
    body: { name: "X", phone: "1", email: "x@test.local", password: "secret", role: "chef" },
  });
  await call("register admin", "POST", "/api/user/register", {
    body: { name: "Admin Uji", phone: "0811", email: "admin@test.local", password: "admin-pass", role: "ADMIN" },
  });
  await call("register cashier", "POST", "/api/user/register", {
    body: { name: "Kasir Uji", phone: "0812", email: "kasir@test.local", password: "kasir-pass", role: "cashier" },
  });
  await call("register duplicate", "POST", "/api/user/register", {
    body: { name: "Admin Uji", phone: "0811", email: "admin@test.local", password: "x", role: "admin" },
  });
  await call("login missing fields", "POST", "/api/user/login", { body: { email: "admin@test.local" } });
  await call("login unknown user", "POST", "/api/user/login", {
    body: { email: "nobody@test.local", password: "x" },
  });
  await call("login wrong password", "POST", "/api/user/login", {
    body: { email: "admin@test.local", password: "wrong" },
  });
  await call("login admin", "POST", "/api/user/login", {
    body: { email: "admin@test.local", password: "admin-pass" },
    as: "admin",
    keepCookie: true,
  });
  await call("login cashier", "POST", "/api/user/login", {
    body: { email: "kasir@test.local", password: "kasir-pass" },
    as: "cashier",
    keepCookie: true,
  });
  await call("me without token", "GET", "/api/user");
  await call("me with invalid token", "GET", "/api/user", { cookie: "accessToken=not-a-jwt" });
  await call("me admin", "GET", "/api/user", { as: "admin" });
  await call("users as cashier", "GET", "/api/user/all", { as: "cashier" });
  await call("users as admin", "GET", "/api/user/all", { as: "admin" });

  // --- categories ---------------------------------------------------------
  await call("categories cashier", "GET", "/api/category", { as: "cashier" });
  await call("categories cashier includeInactive ignored", "GET", "/api/category?includeInactive=true", { as: "cashier" });
  await call("category add as cashier", "POST", "/api/category", { as: "cashier", body: { name: "Nope" } });
  await call("category add missing name", "POST", "/api/category", { as: "admin", body: { icon: "x" } });
  await call("category add bad tax", "POST", "/api/category", { as: "admin", body: { name: "Bad", taxRate: 150 } });
  const category = await call("category add", "POST", "/api/category", {
    as: "admin",
    body: { name: "Uji Kategori", icon: "🧪", taxRate: "10" },
  });
  const categoryId = category.body.data.id;
  await call("category update invalid id", "PUT", "/api/category/abc", { as: "admin", body: { name: "A" } });
  await call("category update not found", "PUT", "/api/category/999999", { as: "admin", body: { name: "A" } });
  await call("category update", "PUT", `/api/category/${categoryId}`, {
    as: "admin",
    body: { name: "Uji Kategori 2", icon: "🧫", tax: 11, isActive: "aktif" },
  });
  await call("category positions empty", "PUT", "/api/category/positions", { as: "admin", body: { categoryIds: [] } });
  await call("category positions", "PUT", "/api/category/positions", {
    as: "admin",
    body: { categoryIds: [categoryId, 1, 2] },
  });
  await call("category delete not found", "DELETE", "/api/category/999999", { as: "admin" });
  const tempCategory = await call("category add temp", "POST", "/api/category", {
    as: "admin",
    body: { name: "Kategori Sementara" },
  });
  await call("category deactivate temp", "PUT", `/api/category/${tempCategory.body.data.id}`, {
    as: "admin",
    body: { name: "Kategori Sementara", isActive: false },
  });
  await call("categories admin includeInactive", "GET", "/api/category?includeInactive=true", { as: "admin" });
  await call("category delete temp", "DELETE", `/api/category/${tempCategory.body.data.id}`, { as: "admin" });

  // --- order platforms ----------------------------------------------------
  await call("platforms cashier", "GET", "/api/order-platform", { as: "cashier" });
  await call("platform add as cashier", "POST", "/api/order-platform", { as: "cashier", body: { name: "X" } });
  await call("platform add missing name", "POST", "/api/order-platform", { as: "admin", body: {} });
  const platform = await call("platform add", "POST", "/api/order-platform", {
    as: "admin",
    body: { name: "Uji Food", iconUrl: "/platforms/uji.png", tax: 2500 },
  });
  const platformId = platform.body.data.id;
  await call("platform add duplicate", "POST", "/api/order-platform", { as: "admin", body: { name: "Uji Food" } });
  await call("platform update", "PUT", `/api/order-platform/${platformId}`, {
    as: "admin",
    body: { name: "Uji Food 2", icon_url: "/platforms/uji2.png", taxRate: 3000 },
  });
  await call("platform update duplicate", "PUT", `/api/order-platform/${platformId}`, {
    as: "admin",
    body: { name: "GoFood" },
  });
  await call("platform update not found", "PUT", "/api/order-platform/999999", { as: "admin", body: { name: "Q" } });
  const tempPlatform = await call("platform add temp", "POST", "/api/order-platform", {
    as: "admin",
    body: { name: "Platform Sementara", isActive: false },
  });
  await call("platform delete temp", "DELETE", `/api/order-platform/${tempPlatform.body.data.id}`, { as: "admin" });
  await call("platform delete invalid id", "DELETE", "/api/order-platform/0", { as: "admin" });
  await call("platforms admin includeInactive", "GET", "/api/order-platform?includeInactive=true", { as: "admin" });

  // --- stock items --------------------------------------------------------
  await call("stock list", "GET", "/api/stock-item", { as: "cashier" });
  await call("stock add as cashier", "POST", "/api/stock-item", { as: "cashier", body: { name: "X" } });
  await call("stock add missing fields", "POST", "/api/stock-item", { as: "admin", body: { name: "X" } });
  const beans = await call("stock add beans", "POST", "/api/stock-item", {
    as: "admin",
    body: { name: "Biji Uji", category: "Kopi", unit: "kg", stock: 2, minimumStock: "0.5", supplier: "Roastery" },
  });
  const beansId = beans.body.data.id;
  const cups = await call("stock add cups", "POST", "/api/stock-item", {
    as: "admin",
    body: { name: "Cup Uji", category: "Kemasan", unit: "pcs", stock: 50, minimumStock: 10 },
  });
  const cupsId = cups.body.data.id;
  await call("stock add unlimited", "POST", "/api/stock-item", {
    as: "admin",
    body: { name: "Air Uji", category: "Bahan", unit: "ml", stock: -5, isUnlimited: true },
  });
  await call("stock add duplicate name", "POST", "/api/stock-item", {
    as: "admin",
    body: { name: "Biji Uji", category: "Kopi", unit: "kg" },
  });
  await call("stock update", "PUT", `/api/stock-item/${beansId}`, {
    as: "admin",
    body: { name: "Biji Uji", category: "Kopi", unit: "kg", stock: 3, minimumStock: 1, supplier: "Roastery 2" },
  });
  await call("stock update invalid id", "PUT", "/api/stock-item/x", { as: "admin", body: {} });
  await call("stock cogs", "PATCH", `/api/stock-item/${beansId}/cogs`, {
    as: "admin",
    body: { averageCost: 150000, supplier: "Roastery 3" },
  });
  await call("stock cogs as cashier", "PATCH", `/api/stock-item/${beansId}/cogs`, {
    as: "cashier",
    body: { averageCost: 1 },
  });
  await call("stock quantity as cashier", "PATCH", `/api/stock-item/${cupsId}/stock`, {
    as: "cashier",
    body: { stock: "40" },
  });
  await call("stock quantity not found", "PATCH", "/api/stock-item/999999/stock", { as: "admin", body: { stock: 1 } });
  const tempStock = await call("stock add temp", "POST", "/api/stock-item", {
    as: "admin",
    body: { name: "Stok Sementara", category: "X", unit: "pcs" },
  });
  await call("stock delete temp", "DELETE", `/api/stock-item/${tempStock.body.data.id}`, { as: "admin" });
  await call("stock delete not found", "DELETE", "/api/stock-item/999999", { as: "admin" });

  // --- menu items ---------------------------------------------------------
  await call("menu list cashier", "GET", "/api/menu-item", { as: "cashier" });
  await call("menu list by category", "GET", "/api/menu-item?categoryId=1", { as: "cashier" });
  await call("menu add as cashier", "POST", "/api/menu-item", { as: "cashier", body: { name: "X" } });
  await call("menu add missing price", "POST", "/api/menu-item", {
    as: "admin",
    body: { categoryId, name: "Tanpa Harga" },
  });
  const sized = await call("menu add with sizes", "POST", "/api/menu-item", {
    as: "admin",
    body: {
      categoryId,
      name: "Kopi Uji",
      includeOnlinePlatform: true,
      onlinePrice: 30000,
      sizes: [
        { name: "Regular", price: 20000, hppCost: 6000 },
        { name: "Large", price: 26000, hpp_cost: 8000, gross_profit: 17000 },
        { name: "", price: 1 },
      ],
      variants: ["Hot", " Ice ", ""],
      ingredients: [
        { stockItemId: beansId, sizeName: "Regular", ingredientName: "Biji Uji", quantity: 18, unit: "gr" },
        { stock_item_id: beansId, size_name: "Large", name: "Biji Uji", quantity: 25, unit: "g" },
        { stockItemId: cupsId, ingredientName: "Cup Uji", quantity: 1, unit: "pcs", note: "semua ukuran" },
        { ingredientName: "Tanpa Stok", quantity: 1, unit: "pcs" },
      ],
      isAvailable: true,
    },
  });
  const sizedId = sized.body.data.id;
  const single = await call("menu add single price", "POST", "/api/menu-item", {
    as: "admin",
    body: { categoryId, name: "Roti Uji", price: "15000", hpp: 5000, profit: 10000, largePrice: 99 },
  });
  const singleId = single.body.data.id;
  await call("menu add regularPrice with hppCost only", "POST", "/api/menu-item", {
    as: "admin",
    body: { categoryId, name: "Teh Uji", regularPrice: 12000, hppCost: 3000, isAvailable: false },
  });
  const uploadAsCashier = await upload("menu upload as cashier", "/api/menu-item/upload-image", {
    as: "cashier",
    fileName: "Foto Cashier.png",
    contentType: "image/png",
    data: TINY_PNG,
  });
  void uploadAsCashier;
  await upload("menu upload wrong type", "/api/menu-item/upload-image", {
    as: "admin",
    fileName: "notes.txt",
    contentType: "text/plain",
    data: Buffer.from("hello"),
  });
  const uploaded = await upload("menu upload", "/api/menu-item/upload-image", {
    as: "admin",
    fileName: "Foto Menu Uji!!.PNG",
    contentType: "image/png",
    data: TINY_PNG,
  });
  await call("menu update", "PUT", `/api/menu-item/${singleId}`, {
    as: "admin",
    body: {
      categoryId,
      name: "Roti Uji Bakar",
      regularPrice: 17000,
      hppCost: 6000,
      imagePath: uploaded.body?.data?.imagePath,
      variants: ["Coklat"],
    },
  });
  await call("menu update not found", "PUT", "/api/menu-item/999999", {
    as: "admin",
    body: { categoryId, name: "Q", price: 1 },
  });
  await call("menu update invalid id", "PUT", "/api/menu-item/0", { as: "admin", body: {} });
  await call("menu list admin includeUnavailable", "GET", "/api/menu-item?includeUnavailable=true", { as: "admin" });
  await call("menu list category includeUnavailable", "GET", `/api/menu-item?categoryId=${categoryId}&includeUnavailable=true`, {
    as: "admin",
  });

  // --- shopping -----------------------------------------------------------
  await call("suppliers empty", "GET", "/api/shopping/suppliers", { as: "cashier" });
  await call("supplier add as cashier", "POST", "/api/shopping/suppliers", { as: "cashier", body: { name: "X" } });
  const supplier = await call("supplier add", "POST", "/api/shopping/suppliers", {
    as: "admin",
    body: { name: "  Toko   Uji  " },
  });
  await call("supplier add duplicate", "POST", "/api/shopping/suppliers", { as: "admin", body: { name: "toko uji" } });
  await call("supplier add blank", "POST", "/api/shopping/suppliers", { as: "admin", body: { name: " " } });
  await call("supplier rename", "PUT", `/api/shopping/suppliers/${supplier.body.data.id}`, {
    as: "admin",
    body: { name: "Toko Uji Baru" },
  });
  await call("supplier rename not found", "PUT", "/api/shopping/suppliers/4294967295", {
    as: "admin",
    body: { name: "Hilang" },
  });
  const purchaseBody = {
    requestId: "11111111-2222-3333-4444-555555555555",
    date: "2026-09-15",
    suplierName: "Pasar Uji",
    paymentMethod: "Cash",
    note: "belanja rutin",
    items: [
      { stockItemId: beansId, quantity: 1.5, unit: "kg", unitPrice: 160000 },
      { itemName: "Gula Uji", quantity: 2, unit: "kg", unitPrice: 15000 },
      { stockItemId: cupsId, quantity: 100, unit: "pcs", unitPrice: 500 },
    ],
  };
  await call("purchase as cashier", "POST", "/api/shopping/purchases", { as: "cashier", body: purchaseBody });
  await call("purchase invalid date", "POST", "/api/shopping/purchases", {
    as: "admin",
    body: { ...purchaseBody, requestId: "aaaaaaaaaaaaaaaa-1", date: "2026-02-30" },
  });
  await call("purchase unit mismatch", "POST", "/api/shopping/purchases", {
    as: "admin",
    body: {
      ...purchaseBody,
      requestId: "aaaaaaaaaaaaaaaa-2",
      items: [{ stockItemId: cupsId, quantity: 1, unit: "kg", unitPrice: 1 }],
    },
  });
  await call("purchase create", "POST", "/api/shopping/purchases", { as: "admin", body: purchaseBody });
  await call("purchase replay", "POST", "/api/shopping/purchases", { as: "admin", body: purchaseBody });
  await call("purchase replay changed payload", "POST", "/api/shopping/purchases", {
    as: "admin",
    body: { ...purchaseBody, note: "berbeda" },
  });
  await call("purchase second", "POST", "/api/shopping/purchases", {
    as: "admin",
    body: {
      ...purchaseBody,
      requestId: "22222222-2222-3333-4444-555555555555",
      suplierId: supplier.body.data.id,
      suplierName: undefined,
      items: [{ itemName: "gula uji", quantity: 500, unit: "gr", unitPrice: 20 }],
    },
  });
  const purchases = await call("purchases list", "GET", "/api/shopping/purchases", { as: "cashier" });
  await call("purchases search", "GET", "/api/shopping/purchases?search=Biji&page=1", { as: "admin" });
  await call("purchases page 2", "GET", "/api/shopping/purchases?page=2", { as: "admin" });
  const firstPurchase = (purchases.body?.data?.purchases || []).find((p) => p.items?.length === 3);
  const purchaseItems = firstPurchase ? firstPurchase.items : [];
  if (purchaseItems[2]) {
    await call("purchase item update", "PUT", `/api/shopping/purchase-items/${purchaseItems[2].id}`, {
      as: "admin",
      body: { quantity: 80, unit: "pcs", unitPrice: 550 },
    });
    await call("purchase item update invalid", "PUT", `/api/shopping/purchase-items/${purchaseItems[2].id}`, {
      as: "admin",
      body: { quantity: 0, unit: "pcs", unitPrice: 1 },
    });
  }
  if (purchaseItems[1]) {
    await call("purchase item delete", "DELETE", `/api/shopping/purchase-items/${purchaseItems[1].id}`, {
      as: "admin",
    });
  }
  await call("purchase item delete not found", "DELETE", "/api/shopping/purchase-items/999999", { as: "admin" });
  await call("suppliers after purchases", "GET", "/api/shopping/suppliers", { as: "admin" });
  await call("stock after purchases", "GET", "/api/stock-item", { as: "admin" });

  // --- orders -------------------------------------------------------------
  const baseItem = (overrides) => ({
    id: `${categoryId}-${sizedId}-Regular`,
    menuItemId: `${categoryId}-${sizedId}-Regular`,
    sourceMenuItemId: sizedId,
    name: "Kopi Uji",
    sizeVariant: "Regular",
    variant: "Hot",
    quantity: 2,
    pricePerQuantity: 20000,
    price: 40000,
    ...overrides,
  });
  const offline = await call("order create offline", "POST", "/api/order", {
    as: "cashier",
    body: {
      customerDetails: { name: "", guests: 2 },
      orderType: "Offline",
      orderStatus: "In Progress",
      bills: { total: 57000, tax: 5700, totalWithTax: 62700 },
      items: [
        baseItem(),
        {
          id: `${categoryId}-${singleId}`,
          sourceMenuItemId: singleId,
          name: "Roti Uji Bakar",
          quantity: 1,
          pricePerQuantity: 17000,
          price: 17000,
        },
      ],
      paymentMethod: "Cash",
      note: "tanpa gula",
    },
  });
  const offlineId = offline.body?.data?.id;
  await call("order create guest second", "POST", "/api/order", {
    as: "cashier",
    body: {
      customerDetails: { name: "guest" },
      orderStatus: "In Progress",
      bills: { total: 26000, tax: 0, totalWithTax: 26000 },
      items: [baseItem({ sizeVariant: "Large", quantity: 1, pricePerQuantity: 26000, price: 26000 })],
      paymentMethod: "QRIS",
    },
  });
  await call("order online missing platform", "POST", "/api/order", {
    as: "cashier",
    body: { orderType: "Online", customerDetails: { name: "A" }, bills: {}, items: [] },
  });
  await call("order online invalid date", "POST", "/api/order", {
    as: "cashier",
    body: {
      orderType: "Online",
      orderPlatformId: platformId,
      orderDate: "2026-02-30",
      customerDetails: { name: "A" },
      orderStatus: "In Progress",
      bills: { total: 1, tax: 0, totalWithTax: 1 },
      items: [],
    },
  });
  const online = await call("order create online", "POST", "/api/order", {
    as: "cashier",
    body: {
      customerDetails: { name: "Budi", guests: 1 },
      orderType: "Online",
      orderDate: "2026-01-15",
      orderPlatformId: platformId,
      platformTax: "Rp 4.500",
      orderStatus: "In Progress",
      bills: { total: 30000, onlineOrderCharge: 0, tax: 0, totalWithTax: 25500 },
      items: [baseItem({ quantity: 1, pricePerQuantity: 30000, price: 30000 })],
      paymentMethod: "Online",
    },
  });
  await call("order create online by name", "POST", "/api/order", {
    as: "cashier",
    body: {
      customerDetails: { name: "Sari" },
      orderType: "Online",
      orderDate: "2026-01-15",
      orderPlatform: "Platform Lain",
      platformTax: 1000,
      orderStatus: "In Progress",
      bills: { total: 15000, tax: 0, totalWithTax: 14000 },
      items: [],
      paymentMethod: "Online",
    },
  });
  const cateringDp = await call("order create catering dp", "POST", "/api/order", {
    as: "admin",
    body: {
      customerDetails: { name: "Kantor Uji", guests: 20 },
      orderType: "Catering",
      orderStatus: "In Progress",
      bills: { total: 500000, tax: 0, totalWithTax: 500000, dp: 200000 },
      items: [],
      paymentMethod: "Transfer",
      cateringDetails: {
        institution: "PT Uji",
        whatsapp: "0813",
        orderDate: "2026-09-01",
        eventDate: "2026-09-20",
        deliveryTime: "10:30",
        paymentPlan: "DP",
        dp: 200000,
        isPaid: false,
        note: "kirim pagi",
      },
    },
  });
  const cateringId = cateringDp.body?.data?.id;
  await call("order create catering full", "POST", "/api/order", {
    as: "admin",
    body: {
      customerDetails: { name: "Sekolah Uji" },
      orderType: "Catering",
      orderStatus: "In Progress",
      bills: { total: 100000, tax: 0, totalWithTax: 100000 },
      items: [],
      paymentMethod: "Cash",
      cateringDetails: { paymentPlan: "Full" },
    },
  });
  await call("order insufficient stock", "POST", "/api/order", {
    as: "cashier",
    body: {
      customerDetails: { name: "Borong" },
      orderStatus: "In Progress",
      bills: { total: 1, tax: 0, totalWithTax: 1 },
      items: [baseItem({ quantity: 500 })],
      paymentMethod: "Cash",
    },
  });
  await call("stock after orders", "GET", "/api/stock-item", { as: "admin" });
  await call("orders list", "GET", "/api/order", { as: "cashier" });
  await call("order get", "GET", `/api/order/${offlineId}`, { as: "cashier" });
  await call("order get invalid id", "GET", "/api/order/abc", { as: "cashier" });
  await call("order get not found", "GET", "/api/order/999999", { as: "cashier" });
  await call("order status as admin", "PUT", `/api/order/${offlineId}`, {
    as: "admin",
    body: { orderStatus: "Completed" },
  });
  await call("order status invalid", "PUT", `/api/order/${offlineId}`, {
    as: "cashier",
    body: { orderStatus: "Ready" },
  });
  await call("order status", "PUT", `/api/order/${offlineId}`, {
    as: "cashier",
    body: { orderStatus: "Completed" },
  });
  await call("order status not found", "PUT", "/api/order/999999", {
    as: "cashier",
    body: { orderStatus: "Completed" },
  });
  await call("catering add payment invalid", "PATCH", `/api/order/${cateringId}/catering-payment/add`, {
    as: "cashier",
    body: { amount: 0 },
  });
  await call("catering add payment", "PATCH", `/api/order/${cateringId}/catering-payment/add`, {
    as: "cashier",
    body: { amount: "100000" },
  });
  await call("catering add payment non-catering", "PATCH", `/api/order/${offlineId}/catering-payment/add`, {
    as: "cashier",
    body: { amount: 1 },
  });
  await call("catering status invalid", "PUT", `/api/order/${cateringId}/catering-payment`, {
    as: "admin",
    body: { isPaid: "yes" },
  });
  await call("catering mark unpaid", "PUT", `/api/order/${cateringId}/catering-payment`, {
    as: "admin",
    body: { isPaid: false },
  });
  await call("catering mark paid", "PUT", `/api/order/${cateringId}/catering-payment`, {
    as: "admin",
    body: { isPaid: true },
  });

  // --- thermal printing ---------------------------------------------------
  const printPayload = [
    { type: 0, content: "Niskala", bold: 1, align: 1 },
    { type: 0, content: "Total 62.700", bold: 0, align: 2 },
  ];
  await call("print url invalid id", "POST", "/api/order/abc/thermal-print-url", { as: "cashier", body: { payload: printPayload } });
  await call("print url not found", "POST", "/api/order/999999/thermal-print-url", { as: "cashier", body: { payload: printPayload } });
  await call("print url empty payload", "POST", `/api/order/${offlineId}/thermal-print-url`, { as: "cashier", body: { payload: [] } });
  await call("print url too large", "POST", `/api/order/${offlineId}/thermal-print-url`, {
    as: "cashier",
    body: { payload: Array.from({ length: 201 }, () => ({ type: 0, content: "x" })) },
  });
  const printUrl = await call("print url", "POST", `/api/order/${offlineId}/thermal-print-url`, {
    as: "cashier",
    body: { payload: printPayload },
    headers: { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "pos.example.test" },
  });
  const printPath = new URL(printUrl.body.data.url).pathname;
  await call("print document", "GET", printPath);
  await call("print document wrong order", "GET", printPath.replace(`/order/${offlineId}/`, `/order/${cateringId}/`));
  await call("print document bad token", "GET", `/api/order/${offlineId}/thermal-print/bad-token`);
  const draftUrl = await call("draft print url", "POST", "/api/order/draft/thermal-print-url", {
    as: "cashier",
    body: { payload: printPayload },
  });
  await call("draft print document", "GET", new URL(draftUrl.body.data.url).pathname);
  await call("draft print bad token", "GET", "/api/order/draft/thermal-print/nope");
  await call("draft print url empty", "POST", "/api/order/draft/thermal-print-url", { as: "cashier", body: {} });

  // --- order delete restores stock ---------------------------------------
  const deletable = await call("order create deletable", "POST", "/api/order", {
    as: "cashier",
    body: {
      customerDetails: { name: "Batal" },
      orderStatus: "In Progress",
      bills: { total: 20000, tax: 0, totalWithTax: 20000 },
      items: [baseItem({ quantity: 1, pricePerQuantity: 20000, price: 20000 })],
      paymentMethod: "Cash",
    },
  });
  await call("order delete invalid id", "DELETE", "/api/order/0", { as: "cashier" });
  await call("order delete not found", "DELETE", "/api/order/999999", { as: "cashier" });
  await call("order delete", "DELETE", `/api/order/${deletable.body.data.id}`, { as: "cashier" });
  await call("stock after delete", "GET", "/api/stock-item", { as: "admin" });
  await call("order allow negative stock", "POST", "/api/order", {
    as: "cashier",
    body: {
      customerDetails: { name: "Minus" },
      orderStatus: "In Progress",
      bills: { total: 1, tax: 0, totalWithTax: 1 },
      items: [{ id: `${categoryId}-${sizedId}`, menuItemId: sizedId, name: "Kopi Uji", sizeName: "Large", quantity: 200, pricePerQuantity: 1, price: 1 }],
      allowNegativeStock: true,
      paymentMethod: "Cash",
    },
  });
  await call("stock after negative order", "GET", "/api/stock-item", { as: "admin" });

  // --- menu item delete keeps order history ------------------------------
  await call("menu delete not found", "DELETE", "/api/menu-item/999999", { as: "admin" });
  await call("menu delete", "DELETE", `/api/menu-item/${singleId}`, { as: "admin" });

  // --- recaps -------------------------------------------------------------
  await call("recap meta", "GET", "/api/recap/meta", { as: "cashier" });
  await call("recap meta weekly", "GET", "/api/recap/meta?periodType=weekly", { as: "cashier" });
  await call("recap meta invalid", "GET", "/api/recap/meta?periodType=yearly", { as: "cashier" });
  await call("recap list invalid", "GET", "/api/recap/yearly", { as: "cashier" });
  await call("recap add invalid period", "POST", "/api/recap/yearly", { as: "cashier", body: {} });
  await call("recap daily missing date", "POST", "/api/recap/daily", { as: "cashier", body: {} });
  await call("recap weekly missing period", "POST", "/api/recap/weekly", { as: "admin", body: {} });
  await call("recap monthly missing period", "POST", "/api/recap/monthly", { as: "admin", body: { periodMonth: "x" } });
  await call("recap weekly", "POST", "/api/recap/weekly", {
    as: "admin",
    body: {
      periodStartDate: "2026-09-07",
      periodEndDate: "2026-09-13T00:00:00.000Z",
      totalOmzet: "1500000",
      grossProfit: 900000,
      offlineRevenue: 1000000,
      onlineRevenue: 300000,
      cateringRevenue: 200000,
      cateringOrderCount: "2.7",
      topChannel: " Offline ",
      operationalIssues: "aman",
    },
  });
  await call("recap weekly upsert", "POST", "/api/recap/weekly", {
    as: "admin",
    body: { periodStartDate: "2026-09-07", periodEndDate: "2026-09-13", totalOmzet: 1600000, note: "revisi" },
  });
  await call("recap monthly", "POST", "/api/recap/monthly", {
    as: "admin",
    body: {
      periodMonth: "2026-02-15",
      omzet: 6000000,
      hppTotal: 2000000,
      grossProfit: 4000000,
      estimatedNetProfit: 3000000,
      cateringOrderCount: 3,
      retainedMenu: "Kopi Uji",
    },
  });
  const daily = await call("recap daily", "POST", "/api/recap/daily", {
    as: "cashier",
    body: {
      recapDate: today(),
      shiftOfficer: "Kasir Uji",
      transactionTotal: "4",
      offlineRevenue: 57000,
      onlineRevenue: 0,
      cateringRevenue: 600000,
      hppTotal: 30000,
      dailyExpense: 10000,
      cashIn: 100000,
      qrisIn: 26000,
      bestMenuName: "Kopi Uji",
      leastMenu: "Roti Uji Bakar",
      note: "closing",
    },
  });
  await call("recap daily duplicate", "POST", "/api/recap/daily", {
    as: "cashier",
    body: { recapDate: today() },
  });
  const dailyId = daily.body?.data?.id;
  await call("recap cash as cashier", "PATCH", `/api/recap/daily/${dailyId}/cash`, {
    as: "cashier",
    body: { method: "cash", amount: 1000 },
  });
  await call("recap cash invalid id", "PATCH", "/api/recap/daily/abc/cash", { as: "admin", body: { amount: 1 } });
  await call("recap cash not found", "PATCH", "/api/recap/daily/999999/cash", { as: "admin", body: { amount: 1 } });
  await call("recap cash invalid method", "PATCH", `/api/recap/daily/${dailyId}/cash`, {
    as: "admin",
    body: { method: "crypto", amount: 1000 },
  });
  await call("recap cash zero", "PATCH", `/api/recap/daily/${dailyId}/cash`, {
    as: "admin",
    body: { method: "qris", amount: 0 },
  });
  await call("recap cash qris", "PATCH", `/api/recap/daily/${dailyId}/cash`, {
    as: "admin",
    body: { method: "QRIS", amount: "5000", note: "susulan" },
  });
  await call("recap daily list", "GET", "/api/recap/daily", { as: "cashier" });
  await call("recap weekly list", "GET", "/api/recap/weekly", { as: "cashier" });
  await call("recap monthly list", "GET", "/api/recap/monthly", { as: "cashier" });

  // --- recap lock -----------------------------------------------------------
  await call("order create after closing", "POST", "/api/order", {
    as: "cashier",
    body: {
      customerDetails: { name: "Telat" },
      orderStatus: "In Progress",
      bills: { total: 1, tax: 0, totalWithTax: 1 },
      items: [],
      paymentMethod: "Cash",
    },
  });
  await call("order status after closing", "PUT", `/api/order/${offlineId}`, {
    as: "cashier",
    body: { orderStatus: "In Progress" },
  });
  await call("order delete after closing", "DELETE", `/api/order/${offlineId}`, { as: "admin" });
  await call("catering payment after closing", "PATCH", `/api/order/${cateringId}/catering-payment/add`, {
    as: "admin",
    body: { amount: 1 },
  });
  await call("online order other day still allowed", "DELETE", `/api/order/${online.body?.data?.id}`, { as: "admin" });

  // --- category delete cascades -----------------------------------------
  await call("category delete with items", "DELETE", `/api/category/${categoryId}`, { as: "admin" });
  await call("menu list after category delete", "GET", "/api/menu-item?includeUnavailable=true", { as: "admin" });
  await call("orders list final", "GET", "/api/order", { as: "admin" });

  // --- logout -------------------------------------------------------------
  await call("logout without token", "POST", "/api/user/logout");
  await call("logout", "POST", "/api/user/logout", { as: "cashier" });
  await call("unknown route", "GET", "/api/does-not-exist", { as: "admin" });
  await call("malformed json", "POST", "/api/category", {
    as: "admin",
    rawBody: "{bad json",
    headers: { "Content-Type": "application/json" },
  });
};
