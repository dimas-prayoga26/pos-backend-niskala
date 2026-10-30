#!/usr/bin/env node
// Tidies the bahan baku the REKAP PENGELUARAN import made one per sheet name in
// pcs (scripts/import-rekap-pengeluaran.js): the same product under several
// names becomes one bahan, and a line bought by the package gets its Isi per
// Kemasan (1 dus Aqua 600ml = 24 botol), so stock and COGS are per botol, gr,
// ml... Rupiah totals do not change. See SHOPPING.md.
//
//   node scripts/normalize-rekap-raw-items.js            dry run: shows the plan, writes nothing
//   node scripts/normalize-rekap-raw-items.js --apply    applies it in one transaction
//   option: --database <name> (default DB_NAME)
//
// Per bahan (GROUPS): name and stock unit, and its sheet names with the isi of
// one sheet qty (null: the qty already is in the stock unit) and the package
// label. Lines move to the bahan (its name), the merged names are deleted (or
// deactivated when a recipe still uses them). Stock and value: a bahan that
// only ever received purchases is replayed from them (also each line's COGS
// Setelah); one that was also used (e.g. Beras in Nasi) keeps that use and
// moves by the converted quantities. Recipe bahan are never touched. Safe to
// run again: what is done already shows as nothing to do.
const path = require("path");
require(path.join(__dirname, "..", "node_modules/dotenv")).config({ path: path.join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");
const config = require("../src/config/env");
const { refreshMenuCosts } = require("../src/modules/menu/menu.costs");

const p = (name, isi = null, packUnit = null) => ({ name, isi, packUnit });
const each = (names, unit, isi, packUnit) => names.map((name) => ({ name, unit, members: [p(name, isi, packUnit)] }));

const GROUPS = [
  // Minuman & susu
  { name: "Aqua 600ml", unit: "botol", members: ["Aqua 600ml 1 Dus", "Aqua 600ml", "Aqua Botol 600 ml", "Aqua botol 600ml", "Aqua"].map((n) => p(n, 24, "dus")) },
  { name: "Aqua Tanggung", unit: "botol", members: [p("Aqua tanggung 100ml", 24, "dus")] },
  { name: "Air Isi Ulang", unit: "galon", members: [p("Air Isi Ulang"), p("Isi Ulang"), p("Isi Ulang Air")] },
  {
    name: "Greenfields UHT 1L",
    unit: "ml",
    members: ["Greenfields UHT 1000Ml", "UHT Greenfield 1000ml", "UHT Greenfirld 1000ml", "Greenfield Fresh Milk", "Fresh milk Greenfield", "Greenfield", "Greenfields"].map((n) => p(n, 1000, "kotak")),
  },
  { name: "Milklife UHT 1L", unit: "ml", members: [p("Milklife UHT 1L", 1000, "kotak"), p("Milklife Susu UHT", 1000, "kotak"), p("UHT Fullcream Freshmilk 100% MilkLife 1L (3 pcs)", 3000, "pack")] },
  { name: "Susu Full Cream 1L", unit: "ml", members: [p("Susu Full Cream", 1000, "kotak"), p("Susu full cream 12 pcs", 12000, "dus")] },
  { name: "Diamond Juice Orange 1L", unit: "ml", members: [p("Diamond Juice Orange 1 Liter", 1000, "kotak"), p("Diamond Orange Juice UHT (Jus Jeruk)", 1000, "kotak")] },
  ...each(["Diamond Juice UHT Apple", "Diamond Juice Blueberry", "Diamond Juice Cranberry"], "ml", 1000, "kotak"),
  // Bahan kopi & minuman
  {
    name: "Masterista Syrup Butterscotch",
    unit: "ml",
    members: ["Masterista Syrup Butterscoth", "Masterista Flavor Syrup Butterscoth", "Masterista Gourmet Sirup 850ml Butterscotch", "Masterista sirup butterschot", "Msterista Gourmet Syrup Butterscotch", "Syrup butterschoth"].map((n) => p(n, 850, "botol")),
  },
  ...each(
    ["Masterista Syrup Classic Caramel", "Masterista Syrup Pineapple", "Masterista Syrup Premium Hazelnut", "Masterista Syrup Strawberry", "Masterista Syrup Tropical Lychee", "Sirup Triple Pralin Masterista", "Masterista Gourmet Syrup 850ml"],
    "ml",
    850,
    "botol"
  ),
  { name: "Masterista Syrup Vanilla", unit: "ml", members: [p("Masterista Syrup Vanilla Traditional", 850, "botol"), p("Masterista Syrup Vanilla Tradition", 850, "botol")] },
  { name: "Masterista Aren 1300ml", unit: "ml", members: [p("Masterista Aren 1300ML", 1300, "botol"), p("Gula aren 1300ml", 1300, "botol")] },
  { name: "Masterista Powder Matcha", unit: "gr", members: ["Masterista Powder Matcha Original", "Matcha Original Powder", "Bubuk Matcha Masterista", "Masterista Bubuk Matcha"].map((n) => p(n, 800, "pack")) },
  { name: "Masterista Powder Dark Choco", unit: "gr", members: [p("Masterista Powder Dark Choco", 800, "pack"), p("Coklat powder Masterista", 800, "pack")] },
  ...each(["Masterista Powder Cookies & Cream"], "gr", 800, "pack"),
  ...each(["Masterista Ice Shaken Lemon Tea", "Masterista Ice Shaken Lychee Tea", "Masterista Ice Shaken Es Jeruk Nipis", "Flavourista Powder Thai Tea", "Masterista powder coconut nusantara"], "gr", 1000, "pack"),
  { name: "Multibev Creamer", unit: "gr", members: [p("Multibev Bubuk Creamer", 1000, "pack"), p("Multibev Creamer 1 kg", 1000, "pack"), p("Cream Powder", 1000, "pack")] },
  { name: "House Blend Gemi", unit: "gr", members: ["House Blend 73 Arabica (1000GR)", "House Blend 73 Arabica 1Kg", "Kopi House blend 70/30"].map((n) => p(n, 1000, "pack")) },
  {
    name: "House Blend JnC Signature",
    unit: "gr",
    members: ["House Blend JnC Signature 1 Kg", "House Blend JnC Signature 1 Kg Kopi Sangrai", "House Blend JnC Signature 1 pcs", "House Blend Kopi Sangrai"].map((n) => p(n, 1000, "pack")),
  },
  // Makanan
  { name: "Chicken Katsu", unit: "pcs", members: ["Chicken Katsu Frozen 9 pcs", "Chicken Katsu (9 pcs)", "Chicken Katsu isi 9", "ayam katsu isi 9pcs", "Chicken katsu"].map((n) => p(n, 9, "pack")) },
  { name: "Pisang Nugget", unit: "kg", members: ["Pisang Nugget 1 KG", "Pisang Nugget 1Kg", "Pisang nugget", "Banana Nugget", "Banana Nugger 1Kg"].map((n) => p(n, 1, "pack")) },
  {
    name: "Kentang Goreng Frozen",
    unit: "kg",
    members: ["Kentang Goreng 1 Kg", "Kentang Goreng 1Kg", "Kentang Goreng", "Kentang Curah 1Kg", "Kentang Curah", "Kentang Curah Shoestring 1Kg"].map((n) => p(n, 1, "pack")),
  },
  { name: "So Eco Nugget", unit: "pack", members: [p("So Eco Nugget"), p("Nugget Eco")] },
  {
    name: "Ayam Fillet Boneless",
    unit: "kg",
    members: [
      p("Boneless Ayam Fillet 1kg", 1, "pack"),
      p("Daging Ayam Dada Fillet 1kg (2pcs)", 1, "pack"),
      p("Paha Atas 1kg", 1, "pack"),
      p("Bestchicken Dada Ayam Fillet Boneless 500gr 2 pcs", 0.5, "pack"),
      p("Bestchicken Paha Ayam Fillet Boneless 500gr 2 pcs", 0.5, "pack"),
      p("dada & paha fillet (2kg) (kemasan)", 0.5, "pack"),
    ],
  },
  { name: "Telur", unit: "kg", members: [p("Telur"), p("Telor"), p("Telur 2 Kg"), p("Telur Ayam Negeri Curah", 2, "pack")] },
  // Beras: a sheet "Beras" line of Rp 50.000 or more was one 5 kg karung.
  {
    name: "Beras",
    unit: "kg",
    members: [
      { ...p("Beras"), bigPack: { minPrice: 50000, isi: 5, packUnit: "karung" } },
      p("Beras 5 KG", 5, "karung"),
      p("Beras rojolele 5kg", 5, "karung"),
      p("Beras 5kg", 5, "karung"),
      p("Beras 5 Liter"),
      p("Beras 3 Liter", 3, "kantong"),
    ],
  },
  { name: "Minyak Goreng", unit: "ml", members: [p("Minyak Goreng Bimoli 2L", 2000, "botol"), p("Minyak Goreng 2L", 2000, "botol"), p("Minyak goreng", 1000, "pouch")] },
  { name: "Indomie Goreng", unit: "bungkus", members: [p("Indomie Goreng"), p("Mie Indomie Goreng")] },
  { name: "Indomie Rebus", unit: "bungkus", members: [p("Indomie Rebus"), p("Mie Indomie rebus")] },
  { name: "Indomie Ayam Bawang", unit: "bungkus", members: [p("Indomie AB"), p("Indomie Ayam Bawang")] },
  { name: "Es Batu", unit: "pack", members: [p("es batu"), p("Ice Cube"), p("Es Batu Kristal")] },
  { name: "Leci Kaleng", unit: "kaleng", members: [p("Leci"), p("Red Boat Leci Buah Kaleng")] },
  { name: "Tomat", unit: "pcs", members: [p("Tomat"), p("Tomst")] },
  { name: "Sawi", unit: "pcs", members: [p("Sawi"), p("Caisim")] },
  { name: "Susu Kental Manis", unit: "kaleng", members: [p("SKM (kemasan)"), p("Susu kental manis")] },
  { name: "Saus Del Monte", unit: "botol", members: [p("Saos Del Monte"), p("Saos Delmonte")] },
  { name: "Saus Teriyaki", unit: "ml", members: [p("Saos Teriyaki 1 Lt", 1000, "botol"), p("Saos Tirayaki", 1000, "botol")] },
  // Kemasan
  { name: "Sedotan", unit: "batang", members: [p("Sedotan 500 batang", 500, "pack"), p("Sedotan", 500, "pack")] },
  {
    name: "Cup Plastik 12oz Bungkus Indonesia",
    unit: "pcs",
    members: [p("Bungkus Indonesia Cup Gelas Plastik untuk Minuman Dingin 12oz Sablon + Lid Strawless 11 gram"), p("Cup Minuman Dingin 12oz Bungkus Indonesia")],
  },
  ...each(["Snack Box 12x12 25pcs", "Snack Box 14x12 25pcs", "Snack Box 16x12 25pcs"], "pcs", 25, "pack"),
  ...each(["Paper Bowl + Tutup 100 pcs", "SOS Bag 100 pcs", "Kertas Minuman Tahan Air 100 pcs", "Kabel Ties Hitam uk. 2,5x100 isi 100 pcs"], "pcs", 100, "pack"),
  { name: "Saus Sambal Sachet", unit: "sachet", members: [p("Saos Sambal Sachet isi 48 pcs", 48, "pack"), p("Saus Sambal Pedas Sasa 48 Sachet", 48, "pack")] },
  {
    name: "Plastik PE 15x33",
    unit: "pack",
    members: [p("Plastik Kresek PE Bening 15 x 33"), p("Plastik Bening PE uk. 15x33 untuk Takeaway Minuman Single dan Makanan")],
  },
  {
    name: "Plastik PE 20x40",
    unit: "pack",
    members: [p("Plastik Kresek PE Bening 20 x 40"), p("Plastik Bening PE uk. 20x40 untuk Minuman Double dan Makanan Porsi Besar")],
  },
];

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const database = (() => {
  const index = args.indexOf("--database");
  return index >= 0 ? args[index + 1] : config.dbName;
})();
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
const rupiah = (value) => `Rp ${Math.round(value).toLocaleString("id-ID")}`;
const qty = (value, unit) => `${round(value, 3).toLocaleString("id-ID")} ${unit}`;

// The isi and package label of one line of a member.
const packOf = (member, line) =>
  member.bigPack && Number(line.unit_price) >= member.bigPack.minPrice
    ? { isi: member.bigPack.isi, packUnit: member.bigPack.packUnit }
    : { isi: member.isi, packUnit: member.packUnit };

(async () => {
  const db = await mysql.createConnection({
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPassword,
    database,
    dateStrings: true,
  });
  const query = async (sql, params) => (await db.query(sql, params))[0];
  const recipeIds = new Set(
    (await query("SELECT stock_item_id AS id FROM menu_item_recipes UNION SELECT stock_item_id FROM stock_semi_item_recipes")).map((row) => row.id)
  );
  const recipeNames = new Set(
    (await query(`SELECT name FROM stock_raw_items WHERE id IN (SELECT stock_item_id FROM menu_item_recipes)`)).map((row) => row.name.toLowerCase())
  );
  const otherNames = new Set(
    (await query("SELECT name FROM stock_supply_items UNION SELECT name FROM stock_semi_items")).map((row) => row.name.toLowerCase())
  );

  console.log(`${apply ? "MERAPIKAN" : "DRY RUN (tanpa menulis; tambahkan --apply)"} bahan baku hasil import -> database ${database}`);
  if (apply) await db.beginTransaction();
  let changedGroups = 0;
  const touched = [];
  try {
    for (const group of GROUPS) {
      if (recipeNames.has(group.name.toLowerCase()) || otherNames.has(group.name.toLowerCase())) {
        console.log(`  LEWATI ${group.name}: nama dipakai bahan resep, setengah jadi, atau barang Lainnya`);
        continue;
      }
      // The members that exist (by name), and an active bahan already named like the group.
      const found = [];
      for (const member of group.members) {
        const [row] = await query("SELECT * FROM stock_raw_items WHERE name = ? AND is_active = TRUE", [member.name]);
        if (row && !recipeIds.has(row.id) && !found.some((entry) => entry.row.id === row.id)) found.push({ member, row });
      }
      const [named] = await query("SELECT * FROM stock_raw_items WHERE name = ? AND is_active = TRUE", [group.name]);
      if (named && recipeIds.has(named.id) && named.name.toLowerCase() !== "beras") {
        console.log(`  LEWATI ${group.name}: bahan resep`);
        continue;
      }
      const base = named || found[0]?.row;
      if (!base) continue;
      const memberIds = [...new Set([base.id, ...found.map((entry) => entry.row.id)])];
      const lines = await query(
        `SELECT i.*, p.purchase_date FROM history_stock_raw_purchase_items i
         JOIN history_stock_raw_purchases p ON p.id = i.purchase_id
         WHERE i.stock_item_id IN (${memberIds.map(() => "?").join(",")}) AND p.status = 'posted'
         ORDER BY p.purchase_date, p.id, i.id`,
        memberIds
      );
      const items = await query(`SELECT * FROM stock_raw_items WHERE id IN (${memberIds.map(() => "?").join(",")})`, memberIds);
      // The rule of a line: its sheet name (still on the line until it is tidied).
      const ruleOf = (line) =>
        group.members.find((member) => member.name.toLowerCase() === String(line.item_name).toLowerCase()) || { isi: null, packUnit: null };

      // The new form of each line: by the package (qty x isi), already in the
      // group unit (kept, e.g. 25.000 gr of Beras), or an imported pcs line whose
      // qty is in the group unit.
      const planned = lines.map((line) => {
        // Already by the package (tidied before, or bought with Isi per Kemasan): kept.
        if (line.pack_size != null) {
          return { line, isi: Number(line.pack_size), unit: line.unit, stockQuantity: Number(line.stock_quantity) };
        }
        const { isi, packUnit } = packOf(ruleOf(line), line);
        if (isi) return { line, isi, unit: packUnit, stockQuantity: round(Number(line.quantity) * isi, 3) };
        if (line.stock_unit === group.unit) return { line, isi: null, unit: line.unit, stockQuantity: Number(line.stock_quantity) };
        return { line, isi: null, unit: group.unit, stockQuantity: Number(line.quantity) };
      });
      const unchanged =
        memberIds.length === 1 &&
        base.name === group.name &&
        base.unit === group.unit &&
        planned.every(({ line, isi, unit, stockQuantity }) =>
          Number(line.pack_size || 0) === Number(isi || 0) &&
          line.unit === unit &&
          Math.abs(Number(line.stock_quantity) - stockQuantity) < 0.005 &&
          line.stock_unit === group.unit
        );
      if (unchanged) continue;
      changedGroups += 1;

      // Did the members only ever receive these purchases (their stock is what
      // the lines brought in)? Then replay them.
      const onlyPurchases = items.every((item) => {
        const received = lines.filter((line) => line.stock_item_id === item.id).reduce((sum, line) => sum + Number(line.stock_quantity), 0);
        return Math.abs(Number(item.stock) - received) < 0.001;
      });
      let stock = 0;
      let value = 0;
      const snapshots = new Map();
      if (onlyPurchases) {
        planned.forEach(({ line, stockQuantity }) => {
          stock = round(stock + stockQuantity, 3);
          value = round(value + Number(line.cost_total), 2);
          snapshots.set(line.id, { unitCost: stock > 0 ? Math.round(value / stock) : 0, value });
        });
      } else {
        stock = round(
          items.reduce((sum, item) => sum + Number(item.stock), 0) +
            planned.reduce((sum, { line, stockQuantity }) => sum + stockQuantity - Number(line.stock_quantity), 0),
          3
        );
        value = round(items.reduce((sum, item) => sum + Number(item.stock_value), 0), 2);
      }
      const unitCost = stock > 0 ? Math.round(value / stock) : 0;
      const before = items.map((item) => `${item.name} ${qty(Number(item.stock), item.unit || "?")}`).join(" + ");
      console.log(
        `  ${group.name} (${group.unit}): ${items.length} bahan -> 1, ${lines.length} baris. ${before} -> ${qty(stock, group.unit)}, COGS ${rupiah(unitCost)}/${group.unit}${onlyPurchases ? "" : " (pemakaian tetap tercatat)"}`
      );
      if (!apply) continue;

      await db.query("UPDATE stock_raw_items SET name = ?, unit = ?, stock = ?, stock_value = ?, unit_cost = ? WHERE id = ?", [
        `__rapikan_${base.id}`,
        group.unit,
        stock,
        value,
        unitCost,
        base.id,
      ]);
      for (const { line, isi, unit, stockQuantity } of planned) {
        const snapshot = snapshots.get(line.id);
        await db.query(
          `UPDATE history_stock_raw_purchase_items
           SET stock_item_id = ?, item_name = ?, unit = ?, pack_size = ?, stock_quantity = ?, stock_unit = ?
               ${snapshot ? ", stock_unit_cost = ?, stock_value_after = ?" : ""}
           WHERE id = ?`,
          [base.id, group.name, unit, isi, stockQuantity, group.unit, ...(snapshot ? [snapshot.unitCost, snapshot.value] : []), line.id]
        );
      }
      const others = memberIds.filter((id) => id !== base.id);
      if (others.length) {
        const marks = others.map(() => "?").join(",");
        for (const table of ["history_stock_raw_purchase_items", "history_stock_raw_purchase_item_logs", "order_item_costs", "stock_semi_item_production_items"]) {
          await db.query(`UPDATE ${table} SET stock_item_id = ? WHERE stock_item_id IN (${marks})`, [base.id, ...others]);
        }
        await db.query(`DELETE FROM stock_raw_items WHERE id IN (${marks})`, others);
      }
      await db.query("UPDATE stock_raw_items SET name = ? WHERE id = ?", [group.name, base.id]);
      touched.push(base.id);
    }
    // Recipe costs that use a tidied bahan (Beras in Nasi) follow its COGS, as after a belanja.
    if (apply && touched.length) await refreshMenuCosts(db, { stockItemIds: touched });
    if (apply) await db.commit();
  } catch (error) {
    if (apply) await db.rollback();
    throw error;
  } finally {
    await db.end();
  }
  console.log(changedGroups ? `  ${changedGroups} bahan ${apply ? "dirapikan" : "akan dirapikan"}.` : "  Tidak ada yang perlu dirapikan.");
})().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
