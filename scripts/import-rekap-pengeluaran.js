#!/usr/bin/env node
// Imports the "REKAP PENGELUARAN" Google Sheet (tabs BAHAN, PERALATAN,
// PERLENGKAPAN, LAIN LAIN, PROMOSI) into the database of .env as posted
// belanja nota, through the app's own nota services. See SHOPPING.md
// ("Import REKAP PENGELUARAN").
//
//   node scripts/import-rekap-pengeluaran.js             dry run: reads, checks, writes nothing
//   node scripts/import-rekap-pengeluaran.js --apply     posts the nota
//   options: --database <name>  (default DB_NAME)   --sheet <id>   --csv-dir <dir with BAHAN.csv, ...>
//
// - BAHAN -> belanja bahan baku: a name already in Stok -> Bahan Baku is reused
//   with its unit; any other name becomes a new bahan baku in pcs. A name of a
//   recipe item or of an inactive item gets " (kemasan)", so neither is touched.
// - Other tabs -> belanja lainnya with that kategori, counted by qty.
// - Rekening: Niskala, Penjualan -> Rekening Penjualan, Cash -> Kasir (Tunai),
//   RNB -> a source "RNB" (created). A nota paid from two rekening is split.
// - Ongkir / Parkir / Biaya Transport -> ongkir, Diskon -> diskon, PPN/Pajak ->
//   PPN % (or a "PPN" line when no PPN % gives that exact amount). Lines without
//   qty and price were bought in one package with the line above (in the note).
// - Safe to run again: each nota has a fixed requestId, and the nota imported
//   before this run (same tab, date, toko and total, counted, so two identical
//   nota in the sheet are both kept) are skipped even if sheet rows moved.
const fs = require("fs");
const path = require("path");
const backend = path.join(__dirname, "..");
require(path.join(backend, "node_modules/dotenv")).config({ path: path.join(backend, ".env") });
const mysql = require("mysql2/promise");
const config = require("../src/config/env");
const { createShoppingService } = require("../src/modules/shopping/shopping.service");
const { createSupplyShoppingService } = require("../src/modules/shopping/shopping.supply");
const { createPaymentSourceService } = require("../src/modules/paymentSources/paymentSource.service");

const DEFAULT_SHEET = "1SoZyc5rXEqMmjm4cL5erxPxIxeb1dCfAgyqMzE-fXkU";
const TABS = ["BAHAN", "PERALATAN", "PERLENGKAPAN", "LAIN LAIN", "PROMOSI"];
const SOURCE_NAMES = { Niskala: "Niskala", Penjualan: "Rekening Penjualan", Cash: "Kasir (Tunai)", RNB: "RNB" };
const CATEGORY_OF_TAB = { PERALATAN: "Peralatan", PERLENGKAPAN: "Perlengkapan", "LAIN LAIN": "Lain-lain", PROMOSI: "Promosi" };
const ADMIN_ID = 1;

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const apply = args.includes("--apply");
const database = option("--database") || config.dbName;
const sheetId = option("--sheet") || DEFAULT_SHEET;
const csvDir = option("--csv-dir");

// --- reading the sheet ------------------------------------------------------

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
};
// "Rp137,500" / " Rp 1,771,000 " / "-Rp5,433" / "9000" -> number; "" -> null.
const money = (value) => {
  const text = String(value || "").trim();
  if (!/\d/.test(text)) return null;
  const number = Number(text.replace(/[^\d.,]/g, "").replace(/,/g, ""));
  return text.includes("-") ? -number : number;
};
const qtyOf = (value) => (String(value || "").trim() ? Number(String(value).replace(/,/g, "")) : null);
const isoDate = (value) => {
  const match = String(value || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : null;
};
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const kindOf = (name) => {
  const text = name.toLowerCase();
  if (/^(ongkir|parkir|biaya trans?port)\b/.test(text)) return "shipping";
  if (/^diskon\b/.test(text)) return "discount";
  if (/^(ppn|pajak)\b/.test(text)) return "tax";
  return "item";
};

const loadTabs = async () => {
  if (csvDir) {
    return Object.fromEntries(TABS.map((tab) => [tab, fs.readFileSync(path.join(csvDir, `${tab.replace(" ", "_")}.csv`), "utf8")]));
  }
  const html = await (await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`)).text();
  const gids = Object.fromEntries(
    [...html.matchAll(/\{name: "([^"]+)", pageUrl: "[^"]*gid=(\d+)/g)].map(([, name, gid]) => [name.trim().toUpperCase(), gid])
  );
  const tabs = {};
  for (const tab of TABS) {
    if (!gids[tab]) throw new Error(`Tab ${tab} tidak ditemukan di sheet (ada: ${Object.keys(gids).join(", ")}).`);
    const response = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gids[tab]}`);
    if (!response.ok) throw new Error(`Tab ${tab}: HTTP ${response.status}`);
    tabs[tab] = await response.text();
  }
  return tabs;
};

// A nota starts at a row with a date and a toko; its lines follow
// (description, rekening, qty, harga satuan, harga). PROMOSI has one nota per
// row (the person paid).
const parseTab = (tab, text, issues) => {
  const notas = [];
  let sheetTotal = null;
  let current = null;
  parseCsv(text).forEach((cells, index) => {
    const row = index + 1;
    const [, no, date, description, rekening, qty, , amount] = cells.map((cell) => cell ?? "");
    if (/TOTAL PENGELUARAN/i.test(no)) {
      sheetTotal = money(cells.slice(2, 9).find((cell) => money(cell) != null));
      return;
    }
    if (tab === "PROMOSI") {
      if (!isoDate(date)) return;
      notas.push({
        tab, row, date: isoDate(date), supplierName: clean(description), source: clean(rekening),
        lines: [{ name: "Promosi", note: clean(description), quantity: qtyOf(qty) || 1, amount: money(amount), source: clean(rekening) }],
        shipping: 0, discount: 0, tax: 0,
      });
      return;
    }
    if (isoDate(date) && clean(description)) {
      current = { tab, row, date: isoDate(date), supplierName: clean(description), source: "", lines: [], shipping: 0, discount: 0, tax: 0 };
      notas.push(current);
      return;
    }
    if (!current || isoDate(date) || !clean(description)) return;
    const name = clean(description);
    const lineAmount = money(amount);
    const lineQty = qtyOf(qty);
    if (clean(rekening) && !current.source) current.source = clean(rekening);
    if (lineAmount == null && lineQty == null) {
      const previous = current.lines[current.lines.length - 1];
      if (previous) previous.bundled = [...(previous.bundled || []), name];
      else issues.push(`${tab} baris ${row}: ${name} tanpa qty/harga`);
      return;
    }
    const kind = kindOf(name);
    if (kind === "shipping") current.shipping += lineAmount;
    else if (kind === "discount") current.discount += -lineAmount;
    else if (kind === "tax") current.tax += lineAmount;
    else current.lines.push({ name, quantity: lineQty || 1, amount: lineAmount, source: clean(rekening) || current.source });
  });
  notas.forEach((nota) => {
    if (!nota.source) issues.push(`${tab} baris ${nota.row}: nota ${nota.supplierName} tanpa rekening`);
    if (!nota.lines.length) issues.push(`${tab} baris ${nota.row}: nota ${nota.supplierName} tanpa barang`);
  });
  return { notas, sheetTotal };
};

// One nota per sheet nota and rekening (the footer stays with the first part), oldest first.
const splitAndSort = (notas) =>
  notas
    .flatMap((nota) => {
      const bySource = new Map();
      nota.lines.forEach((line) => bySource.set(line.source || nota.source, [...(bySource.get(line.source || nota.source) || []), line]));
      return [...bySource].map(([source, lines], part) => ({ ...nota, source, lines, part, ...(part > 0 && { shipping: 0, discount: 0, tax: 0 }) }));
    })
    .filter((nota) => nota.lines.length)
    .sort((a, b) => a.date.localeCompare(b.date) || TABS.indexOf(a.tab) - TABS.indexOf(b.tab) || a.row - b.row);

const totalOf = (nota) => nota.lines.reduce((sum, line) => sum + line.amount, 0) + nota.shipping - nota.discount + nota.tax;
const rupiah = (value) => `Rp ${Math.round(value).toLocaleString("id-ID")}`;
const cents = (value) => Math.round(value * 100);

// --- importing ----------------------------------------------------------------

(async () => {
  const issues = [];
  const texts = await loadTabs();
  const parsed = TABS.map((tab) => ({ tab, ...parseTab(tab, texts[tab], issues) }));
  const notas = splitAndSort(parsed.flatMap((tab) => tab.notas));

  console.log(`${apply ? "IMPORT" : "DRY RUN (tanpa menulis; tambahkan --apply untuk import)"} -> database ${database}`);
  parsed.forEach(({ tab, notas: tabNotas, sheetTotal }) => {
    const total = tabNotas.reduce((sum, nota) => sum + totalOf(nota), 0);
    console.log(`  ${tab}: ${tabNotas.length} nota, ${rupiah(total)}${sheetTotal == null ? "" : ` (sheet: ${rupiah(sheetTotal)})`}`);
  });
  issues.forEach((issue) => console.log(`  catatan: ${issue}`));

  const pool = mysql.createPool({
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPassword,
    database,
    dateStrings: true,
    connectionLimit: 4,
  });
  const raw = createShoppingService(pool);
  const supply = createSupplyShoppingService(pool);
  const sources = createPaymentSourceService(pool);
  const query = async (sql, params) => (await pool.query(sql, params))[0];

  const sourceRows = async () => query("SELECT id, name, balance FROM meta_data_payment_source");
  if (!(await sourceRows()).some((row) => row.name === "RNB")) {
    if (apply) await sources.save({ name: "RNB" });
    else console.log('  sumber pembayaran "RNB" akan dibuat');
  }
  const sourceId = new Map();
  for (const row of await sourceRows()) {
    const sheetName = Object.keys(SOURCE_NAMES).find((key) => SOURCE_NAMES[key] === row.name);
    if (sheetName) sourceId.set(sheetName, row.id);
  }
  const missingSources = [...new Set(notas.map((nota) => nota.source))].filter((name) => !sourceId.has(name) && !(name === "RNB" && !apply));
  if (missingSources.length) throw new Error(`Rekening tanpa sumber pembayaran: ${missingSources.join(", ")}`);

  const keptNames = new Set(
    (await query(
      `SELECT name FROM stock_raw_items WHERE is_active = FALSE
       UNION SELECT r.name FROM stock_raw_items r JOIN menu_item_recipes m ON m.stock_item_id = r.id`
    )).map((row) => row.name.toLowerCase())
  );
  const findRaw = async (name) => (await query("SELECT id, unit FROM stock_raw_items WHERE name = ?", [name]))[0];
  const findSupply = async (name) => (await query("SELECT id FROM stock_supply_items WHERE name = ?", [name]))[0];
  // What earlier runs imported: their requestIds, and how many nota per
  // tab|date|toko|total.
  const keyOf = (tab, date, supplierName, total) => [tab, String(date).slice(0, 10), supplierName, Math.round(total)].join("|");
  const earlierIds = new Set();
  const earlierKeys = new Map();
  for (const table of ["history_stock_raw_purchases", "history_stock_supply_purchases"]) {
    const rows = await query(`SELECT request_id, purchase_date, suplier_name, total, note FROM ${table} WHERE note LIKE 'Import rekap %'`);
    for (const row of rows) {
      const tab = TABS.find((name) => row.note.startsWith(`Import rekap ${name}`));
      if (!tab) continue;
      earlierIds.add(row.request_id);
      const key = keyOf(tab, row.purchase_date, row.suplier_name, Number(row.total));
      earlierKeys.set(key, (earlierKeys.get(key) || 0) + 1);
    }
  }
  const alreadyIn = (nota, requestId) => {
    const key = keyOf(nota.tab, nota.date, nota.supplierName, totalOf(nota));
    if (!earlierIds.has(requestId) && !earlierKeys.get(key)) return false;
    if (earlierKeys.get(key)) earlierKeys.set(key, earlierKeys.get(key) - 1);
    return true;
  };

  const report = { posted: 0, skipped: 0, toImport: 0, renamed: new Set(), errors: [], centDiffs: 0 };
  for (const nota of notas) {
    const isRaw = nota.tab === "BAHAN";
    const requestId = `rekap-${nota.tab.replace(/\W/g, "").toLowerCase()}-r${nota.row}-p${nota.part}`;
    if (alreadyIn(nota, requestId)) {
      report.skipped += 1;
      continue;
    }
    const items = [];
    for (const line of nota.lines) {
      let name = line.name;
      const unitPrice = Math.round((line.amount / line.quantity) * 100) / 100;
      if (isRaw) {
        if (keptNames.has(name.toLowerCase())) {
          report.renamed.add(`${name} -> ${name} (kemasan)`);
          name = `${name} (kemasan)`;
        }
        const existing = await findRaw(name);
        items.push(existing
          ? { stockItemId: existing.id, quantity: line.quantity, unit: existing.unit || "pcs", unitPrice }
          : { itemName: name, quantity: line.quantity, unit: "pcs", unitPrice });
      } else {
        const existing = await findSupply(name);
        items.push(existing
          ? { supplyItemId: existing.id, quantity: line.quantity, unitPrice }
          : { itemName: name, category: CATEGORY_OF_TAB[nota.tab], quantity: line.quantity, unitPrice });
      }
    }
    // The PPN % the server applies to (subtotal - diskon), in cents as it does.
    const baseCents = items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPrice * 100), 0) - cents(nota.discount);
    let taxPercent = nota.tax ? Math.round((cents(nota.tax) / baseCents) * 10000) / 100 : 0;
    if (nota.tax && Math.round((baseCents * taxPercent) / 100) !== cents(nota.tax)) {
      taxPercent = 0;
      const existing = isRaw ? null : await findSupply("PPN");
      items.push(existing
        ? { supplyItemId: existing.id, quantity: 1, unitPrice: nota.tax }
        : { itemName: "PPN", category: "Lain-lain", quantity: 1, unitPrice: nota.tax });
    }
    if (!apply) {
      report.toImport += 1;
      continue;
    }
    const bundled = nota.lines.flatMap((line) => line.bundled || []);
    try {
      const saved = await (isRaw ? raw : supply).save(
        {
          requestId,
          date: nota.date,
          suplierName: nota.supplierName,
          paymentSourceId: sourceId.get(nota.source),
          note: `Import rekap ${nota.tab}${nota.tab === "PROMOSI" ? ` (${nota.lines[0].note})` : ""}${bundled.length ? `; satu paket dengan: ${bundled.join(", ")}` : ""}`.slice(0, 500),
          status: "posted",
          shippingCost: nota.shipping || 0,
          discountType: "amount",
          discountValue: nota.discount || 0,
          taxPercent,
          items,
        },
        ADMIN_ID
      );
      if (saved.duplicate) report.skipped += 1;
      else report.posted += 1;
      if (cents(saved.total) !== cents(totalOf(nota))) report.centDiffs += 1;
    } catch (error) {
      report.errors.push(`${nota.tab} baris ${nota.row} ${nota.date} ${nota.supplierName}: ${error.message}`);
    }
  }

  console.log(
    apply
      ? `  diposting ${report.posted}, sudah ada ${report.skipped}, gagal ${report.errors.length}${report.centDiffs ? `, ${report.centDiffs} nota beda sen karena pembulatan harga satuan` : ""}`
      : `  akan diimport ${report.toImport}, sudah ada ${report.skipped}`
  );
  report.renamed.forEach((rename) => console.log(`  bahan resep/nonaktif tidak disentuh: ${rename}`));
  report.errors.forEach((error) => console.log(`  GAGAL ${error}`));
  if (apply) {
    for (const row of await sourceRows()) console.log(`  saldo ${row.name}: ${rupiah(Number(row.balance))}`);
  }
  await pool.end();
  if (report.errors.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
