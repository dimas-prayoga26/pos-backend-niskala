// Default catalog seeded on every boot (see bootstrap/index.js).
const { roundCurrency } = require("../../../shared/utils/money");

const menuImage = (fileName) => `/uploads/menu/${fileName}`;

const seedCategories = [
  ["Coffee", "\u2615"],
  ["Non-Coffee", "\u{1F964}"],
  ["Main Course", "\u{1F35A}"],
  ["Snack", "\u{1F35F}"],
  ["Catering", "\u{1F371}"],
  ["Add Ons", "\u2795"],
];

const seedMenuItems = [
  ["Coffee", "Cappuccino", 18000, 21000, menuImage("cappuccino-d2eb185afd.jpg")],
  ["Coffee", "Cafe Latte", 18000, 21000, menuImage("cafe-latte-1acbe6600b.jpg")],
  ["Coffee", "Butterscotch Latte", 20000, 23000, menuImage("butterscotch-latte-3e444ae99e.jpg")],
  ["Coffee", "Caramel Latte", 20000, 23000, menuImage("caramel-latte-e6dd7de691.jpg")],
  ["Coffee", "Vanilla Latte", 20000, 23000, menuImage("vanilla-latte-8231e75eae.jpg")],
  ["Coffee", "Hazelnut Latte", 20000, 23000, menuImage("hazelnut-latte-6f30e26336.jpg")],
  ["Coffee", "Aren Latte", 20000, 23000, menuImage("aren-latte-9daa0860f4.jpg")],
  ["Coffee", "Moccacino", 22000, 25000, menuImage("moccacino-16b683cb90.jpg")],
  ["Coffee", "Berry Coffee Milk", 22000, 25000, menuImage("berry-coffee-milk-d7f69b0093.jpg")],
  ["Coffee", "Americano", 15000, 18000, menuImage("americano-a7098299e6.jpg")],
  ["Coffee", "Longblack", 15000, 18000, menuImage("longblack-c9fca6adf7.jpg")],
  ["Coffee", "On The Rock Espresso", 15000, 18000, menuImage("on-the-rock-espresso-1159307ad6.jpg")],
  ["Coffee", "Tropical Americano", 23000, 26000, menuImage("tropical-americano-911a87baf1.jpg")],
  ["Coffee", "Elberry Americano", 23000, 26000, menuImage("elberry-americano-c30281ce32.jpg")],
  ["Coffee", "Berry Summer", 23000, 26000, menuImage("berry-summer-27a7222ae3.jpg")],
  ["Non-Coffee", "Chocolate", 18000, 21000, menuImage("chocolate-317bab573b.jpg")],
  ["Non-Coffee", "Matcha", 18000, 21000, menuImage("matcha-05d3506b73.jpg")],
  ["Non-Coffee", "Cookies and Cream", 18000, 21000, menuImage("cookies-and-cream-4ba3428963.jpg")],
  ["Non-Coffee", "Lychee Tea", 13000, 16000, menuImage("lychee-tea-b961e917f7.jpg")],
  ["Non-Coffee", "Lemon Tea", 13000, 16000, menuImage("lemon-tea-6a2e7161fe.jpg")],
  ["Non-Coffee", "Jeruk Nipis Songkit", 13000, 16000, menuImage("jeruk-nipis-songkit-dd4a1bded6.jpg")],
  ["Non-Coffee", "Thai Tea", 15000, 18000, menuImage("thai-tea-6793cc6d8d.jpg")],
  ["Main Course", "Fried Egg Rice Bowl", 15000, menuImage("fried-egg-rice-bowl-71e4a6b35b.jpg")],
  ["Main Course", "Chicken Katsu Rice Bowl", 25000, menuImage("chicken-katsu-rice-bowl-9f77c07d83.jpg")],
  ["Main Course", "Chicken Teriyaki Rice Bowl", 23000, menuImage("chicken-teriyaki-rice-bowl-de9b95075d.jpg")],
  ["Main Course", "Ayam Geprek Rice Bowl", 22000, menuImage("ayam-geprek-rice-bowl-1ad15279c3.jpg")],
  ["Main Course", "Beef Teriyaki Rice Bowl", 25000, menuImage("beef-teriyaki-rice-bowl-bd0d2dccf0.jpg")],
  ["Main Course", "Indomie Goreng Telur", 15000, menuImage("indomie-goreng-telur-908692a040.jpg")],
  ["Main Course", "Indomie Rebus Telur", 15000, menuImage("indomie-rebus-telur-5bb08c107c.jpg")],
  ["Snack", "Kentang Goreng", 12000, menuImage("kentang-goreng-1bbb3108c0.jpg")],
  ["Snack", "Mix Platter", 22000, menuImage("mix-platter-f9eb1d5ba5.jpg")],
  ["Snack", "Cireng", 12000, menuImage("cireng-45396e6a79.jpg")],
  ["Snack", "Pisang Nugget Keju Coklat", 18000, menuImage("pisang-nugget-keju-coklat-e321243831.jpg")],
  ["Snack", "Roti Bakar", 15000, menuImage("roti-bakar-149c6fcfa6.jpg")],
  ["Catering", "Paket 20K / Box", 20000, menuImage("catering-paket-20k-e91f9d8973.jpg")],
  ["Catering", "Paket 28K / Box", 28000, menuImage("catering-paket-28k-296bcf3058.jpg")],
  ["Catering", "Paket 30K / Box", 30000, menuImage("catering-paket-30k-a602b24c5e.jpg")],
  ["Catering", "Paket 35K / Box", 35000, menuImage("catering-paket-35k-5bac09525e.jpg")],
  ["Catering", "Paket 40K / Box", 40000, menuImage("catering-paket-40k-daa33e5477.jpg")],
];

const seedAddOns = [
  ["nasi-putih", "Nasi Putih", 4000, menuImage("addon-nasi-putih-02e8184074.jpg")],
  ["telur", "Telur", 5000, menuImage("addon-telur-25fe043ebb.jpg")],
  ["buah", "Buah", 5000, menuImage("addon-buah-9c87ebb944.jpg")],
  ["sambal", "Sambal", 4000, menuImage("addon-sambal-17d98fec6b.jpg")],
  ["kerupuk", "Kerupuk", 3000, menuImage("addon-kerupuk-faaf6f2c8f.jpg")],
  ["air-mineral", "Air Mineral", 5000, menuImage("addon-air-mineral-4dab72aab0.jpg")],
];

const seedMenuCatalog = [
  ...seedMenuItems,
  ...seedAddOns.map(([, name, price, imagePath]) => [
    "Add Ons",
    name,
    price,
    imagePath,
  ]),
];

const singlePriceCategories = new Set(["Coffee", "Non-Coffee"]);
const noTemperatureVariantMenuItems = new Set([
  "On The Rock Espresso",
  "Tropical Americano",
  "Elberry Americano",
  "Berry Summer",
  "Cookies and Cream",
]);

const shouldUseSinglePrice = (categoryName) =>
  singlePriceCategories.has(categoryName);

const getSeedTemperatureVariants = (categoryName, menuName) =>
  singlePriceCategories.has(categoryName) &&
  !noTemperatureVariantMenuItems.has(menuName)
    ? ["Cold", "Hot"]
    : [];

const seedStockItems = [
  ["ESPRESSO", "Coffee", "gr", 999, 0, "", false],
  ["WATER", "Beverage", "ml", 999, 0, "", true],
  ["CUP", "Packaging", "pcs", 999, 0, "", false],
  ["SYRUP BUTTERSCOTH", "Syrup", "ml", 999, 0, "", false],
  ["CREAMER", "Dairy", "gr", 999, 0, "", false],
  ["FRESHMILK", "Dairy", "ml", 999, 0, "", false],
  ["SYRUP CLASSC CARAMEL", "Syrup", "ml", 999, 0, "", false],
  ["SYRUP VANILLA TRADITIO", "Syrup", "ml", 999, 0, "", false],
  ["SYRUP HAZELNUT", "Syrup", "ml", 999, 0, "", false],
  ["SYRUP AREN", "Syrup", "ml", 999, 0, "", false],
  ["POWDER CHOCOLATE", "Powder", "gr", 999, 0, "", false],
  ["POWDER MATCHA", "Powder", "gr", 999, 0, "", false],
  ["SYRUP STRAWBERRY", "Syrup", "ml", 999, 0, "", false],
  ["SYRUP LYCHEE", "Syrup", "ml", 999, 0, "", false],
  ["SYRUP PINEAPPLE", "Syrup", "ml", 999, 0, "", false],
  ["SYRUP LEMON", "Syrup", "ml", 999, 0, "", false],
  ["SYRUP VANILLA", "Syrup", "ml", 999, 0, "", false],
  ["POWDER COOKIES AND CREAM", "Powder", "gr", 999, 0, "", false],
  ["POWDER LYCHEE TEA", "Powder", "gr", 999, 0, "", false],
  ["POWDER LEMON TEA", "Powder", "gr", 999, 0, "", false],
  ["POWDER SONGKIT", "Powder", "gr", 999, 0, "", false],
  ["POWDER THAI TEA", "Powder", "gr", 999, 0, "", false],
  ["SKM", "Dairy", "ml", 999, 0, "", false],
];

const seedMenuIngredients = {
  Americano: [
    ["ESPRESSO", "", 8, "gr"],
    ["WATER", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
  ],
  "Aren Latte": [
    ["ESPRESSO", "", 8, "gr"],
    ["SYRUP AREN", "", 15, "ml"],
    ["CREAMER", "", 15, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  "Berry Coffee Milk": [
    ["ESPRESSO", "", 8, "gr"],
    ["SYRUP STRAWBERRY", "", 10, "ml"],
    ["SYRUP LYCHEE", "", 5, "ml"],
    ["SYRUP BUTTERSCOTH", "", 5, "ml"],
    ["FRESHMILK", "", 80, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  "Berry Summer": [
    ["ESPRESSO", "", 8, "gr"],
    ["SYRUP STRAWBERRY", "", 10, "ml"],
    ["SYRUP VANILLA", "", 5, "ml"],
    ["SYRUP PINEAPPLE", "", 5, "ml"],
    ["WATER", "", 80, "ml"],
    ["CUP", "", 1, "pcs"],
  ],
  "Butterscotch Latte": [
    ["ESPRESSO", "", 8, "gr"],
    ["SYRUP BUTTERSCOTH", "", 15, "ml"],
    ["CREAMER", "", 15, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  "Cafe Latte": [
    ["ESPRESSO", "", 8, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  Cappuccino: [
    ["ESPRESSO", "", 8, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  "Caramel Latte": [
    ["ESPRESSO", "", 8, "gr"],
    ["SYRUP CLASSC CARAMEL", "", 15, "ml"],
    ["CREAMER", "", 15, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  Chocolate: [
    ["POWDER CHOCOLATE", "", 15, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  "Cookies and Cream": [
    ["POWDER COOKIES AND CREAM", "", 15, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  "Elberry Americano": [
    ["ESPRESSO", "", 8, "gr"],
    ["SYRUP STRAWBERRY", "", 10, "ml"],
    ["SYRUP LYCHEE", "", 5, "ml"],
    ["SYRUP LEMON", "", 5, "ml"],
    ["WATER", "", 80, "ml"],
    ["CUP", "", 1, "pcs"],
  ],
  "Hazelnut Latte": [
    ["ESPRESSO", "", 8, "gr"],
    ["SYRUP HAZELNUT", "", 15, "ml"],
    ["CREAMER", "", 15, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  "Jeruk Nipis Songkit": [
    ["POWDER SONGKIT", "", 15, "gr"],
    ["WATER", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
  ],
  "Lemon Tea": [
    ["POWDER LEMON TEA", "", 15, "gr"],
    ["WATER", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
  ],
  Longblack: [
    ["ESPRESSO", "", 15, "gr"],
    ["WATER", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
  ],
  "Lychee Tea": [
    ["POWDER LYCHEE TEA", "", 15, "gr"],
    ["WATER", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
  ],
  Matcha: [
    ["POWDER MATCHA", "", 15, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  Moccacino: [
    ["ESPRESSO", "", 8, "gr"],
    ["POWDER CHOCOLATE", "", 10, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  "On The Rock Espresso": [
    ["ESPRESSO", "", 15, "gr"],
    ["CUP", "", 1, "pcs"],
  ],
  "Thai Tea": [
    ["POWDER THAI TEA", "", 15, "gr"],
    ["SKM", "", 5, "ml"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  "Tropical Americano": [
    ["ESPRESSO", "", 8, "gr"],
    ["SYRUP PINEAPPLE", "", 10, "ml"],
    ["SYRUP LYCHEE", "", 5, "ml"],
    ["SYRUP LEMON", "", 5, "ml"],
    ["WATER", "", 80, "ml"],
    ["CUP", "", 1, "pcs"],
  ],
  "Vanilla Latte": [
    ["ESPRESSO", "", 8, "gr"],
    ["SYRUP VANILLA TRADITIO", "", 15, "ml"],
    ["CREAMER", "", 15, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
};

const seedMenuFinancials = {
  Americano: { hppCost: 3009.5, grossProfit: 11990.5 },
  Longblack: { hppCost: 4875, grossProfit: 10125 },
  "On The Rock Espresso": { hppCost: 4745, grossProfit: 10255 },
  "Butterscotch Latte": {
    hppCost: 9134.029411764706,
    grossProfit: 10865.970588235294,
  },
  "Caramel Latte": {
    hppCost: 9134.029411764706,
    grossProfit: 10865.970588235294,
  },
  "Vanilla Latte": {
    hppCost: 9134.029411764706,
    grossProfit: 10865.970588235294,
  },
  "Hazelnut Latte": {
    hppCost: 9134.029411764706,
    grossProfit: 10865.970588235294,
  },
  "Aren Latte": { hppCost: 7720.500000000001, grossProfit: 12279.5 },
  "Cafe Latte": { hppCost: 5440.5, grossProfit: 12559.5 },
  Cappuccino: { hppCost: 5440.5, grossProfit: 12559.5 },
  Moccacino: { hppCost: 8121.75, grossProfit: 13878.25 },
  "Berry Coffee Milk": {
    hppCost: 8293.005882352942,
    grossProfit: 13706.994117647058,
  },
  "Tropical Americano": {
    hppCost: 6348.205882352941,
    grossProfit: 16651.79411764706,
  },
  "Elberry Americano": {
    hppCost: 6348.205882352941,
    grossProfit: 16651.79411764706,
  },
  "Berry Summer": {
    hppCost: 6348.205882352941,
    grossProfit: 16651.79411764706,
  },
  Chocolate: { hppCost: 7330.375, grossProfit: 10669.625 },
  Matcha: { hppCost: 7427.875, grossProfit: 10572.125 },
  "Cookies and Cream": { hppCost: 7135.375, grossProfit: 10864.625 },
  "Lychee Tea": { hppCost: 2320.5, grossProfit: 10679.5 },
  "Lemon Tea": { hppCost: 2184, grossProfit: 10816 },
  "Jeruk Nipis Songkit": { hppCost: 3081, grossProfit: 9919 },
  "Thai Tea": {
    hppCost: 5227.368421052632,
    grossProfit: 9772.631578947368,
  },
};

const seedIngredientHppUnitCosts = {
  FRESHMILK: 25.61,
};

const getLargeHppAdjustment = (menuName) =>
  (seedMenuIngredients[menuName] || [])
    .filter(([, sizeName]) => String(sizeName || "").toLowerCase() === "large")
    .reduce((total, [stockName, , quantity]) => {
      const unitCost = seedIngredientHppUnitCosts[stockName] || 0;
      return total + Number(quantity || 0) * unitCost;
    }, 0);

const getSeedSizeFinancials = (menuName, sizeName, price) => {
  const financials = seedMenuFinancials[menuName];
  if (!financials) {
    return { hppCost: 0, grossProfit: 0 };
  }

  if (String(sizeName).toLowerCase() !== "large") {
    return {
      hppCost: roundCurrency(financials.hppCost),
      grossProfit: roundCurrency(financials.grossProfit),
    };
  }

  const hppCost = roundCurrency(
    financials.hppCost + getLargeHppAdjustment(menuName)
  );

  return {
    hppCost,
    grossProfit: roundCurrency(Number(price || 0) - hppCost),
  };
};

const seedOrderPlatforms = [
  ["GoFood", "/platforms/gofood.png", 0],
  ["GrabFood", "/platforms/grabfood.png", 0],
  ["ShopeeFood", "/platforms/shopeefood.png", 0],
];

const seedRecapFormats = [
  ["daily", "Harian", "Rekap operasional harian", true, 1],
  ["weekly", "Mingguan", "Rekap operasional mingguan", true, 2],
  ["monthly", "Bulanan", "Rekap operasional bulanan", true, 3],
];


module.exports = {
  getSeedSizeFinancials,
  getSeedTemperatureVariants,
  seedCategories,
  seedMenuCatalog,
  seedMenuFinancials,
  seedMenuIngredients,
  seedOrderPlatforms,
  seedRecapFormats,
  seedStockItems,
  shouldUseSinglePrice,
};
