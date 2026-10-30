// Integration checks use a fresh, isolated database and never modify POS stock.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const mysql = require("mysql2/promise");
const config = require("../../src/config/env");
const { pool } = require("../../src/infrastructure/database/pool");
const { ensurePaymentSourcesSchema } = require("../../src/infrastructure/database/bootstrap/paymentSourcesSchema");
const { ensureSemiItemsSchema } = require("../../src/infrastructure/database/bootstrap/semiItemsSchema");
const { ensureShoppingSchema } = require("../../src/infrastructure/database/bootstrap/shoppingSchema");
const { ensureSupplySchema } = require("../../src/infrastructure/database/bootstrap/supplySchema");
const { ensureNotaSchema } = require("../../src/infrastructure/database/bootstrap/notaSchema");
const { ensureRecipeIngredientSchema } = require("../../src/infrastructure/database/bootstrap/recipeIngredientSchema");
const { createPaymentSourceService } = require("../../src/modules/paymentSources/paymentSource.service");
const { RECEIPT_TARGETS, createAttachmentService } = require("../../src/modules/shopping/shopping.attachments");
const { createSupplyShoppingService } = require("../../src/modules/shopping/shopping.supply");
const { createShoppingSummary } = require("../../src/modules/shopping/shopping.summary");
const { createShoppingService: createShoppingModel } = require("../../src/modules/shopping/shopping.service");
const { convertQuantity } = require("../../src/modules/shopping/shopping.validation");
const database = `pos_shopping_test_${crypto.randomBytes(6).toString("hex")}`;
let testPool, created = false, receiptDir;
(async () => {
  assert.equal(convertQuantity(1.5,"kg","gr"),1500);
  assert.equal(convertQuantity(0.5,"liter","ml"),500);
  assert.equal(convertQuantity(750,"ml","liter"),0.75);
  assert.throws(()=>convertQuantity(2,"pcs","ml"),error=>error.status===400);
  await pool.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  created = true;
  testPool = mysql.createPool({host:config.dbHost,port:config.dbPort,user:config.dbUser,password:config.dbPassword,database,dateStrings:true,connectionLimit:5});
  await testPool.query("CREATE TABLE users (id INT UNSIGNED PRIMARY KEY, name VARCHAR(100) NULL) ENGINE=InnoDB");
  await testPool.query(`CREATE TABLE stock_raw_items (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(150) NOT NULL UNIQUE,
    category VARCHAR(100) NOT NULL, unit VARCHAR(30) NOT NULL, stock DECIMAL(12,2) NOT NULL DEFAULT 0,
    minimum_stock DECIMAL(12,2) NOT NULL DEFAULT 0,
    average_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
    stock_value DECIMAL(14,2) NOT NULL DEFAULT 0,
    supplier VARCHAR(150),
    is_active BOOLEAN DEFAULT TRUE, is_unlimited BOOLEAN DEFAULT FALSE
  ) ENGINE=InnoDB`);
  await testPool.query("CREATE TABLE stock_semi_items (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(150) NOT NULL UNIQUE, unit_cost INT NOT NULL DEFAULT 0) ENGINE=InnoDB");
  // Minimal menu tables: purchases refresh recipe costs and menu HPP.
  await testPool.query("CREATE TABLE menu_items (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(150) NOT NULL) ENGINE=InnoDB");
  await testPool.query("CREATE TABLE menu_item_prices (menu_item_id INT UNSIGNED PRIMARY KEY, regular_price DECIMAL(12,2) NOT NULL, hpp_cost DECIMAL(12,2) NOT NULL DEFAULT 0, gross_profit DECIMAL(12,2) NOT NULL DEFAULT 0) ENGINE=InnoDB");
  await testPool.query("CREATE TABLE menu_item_recipes (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, menu_item_id INT UNSIGNED NOT NULL, stock_item_id INT UNSIGNED NOT NULL, quantity DOUBLE NOT NULL, cost INT NOT NULL DEFAULT 0) ENGINE=InnoDB");
  await testPool.query("INSERT INTO users (id, name) VALUES (1, 'Admin Uji')");
  await ensureShoppingSchema(testPool);
  await ensureShoppingSchema(testPool);
  await ensurePaymentSourcesSchema(testPool);
  await ensurePaymentSourcesSchema(testPool);
  await ensureSupplySchema(testPool);
  await ensureSupplySchema(testPool);
  await ensureNotaSchema(testPool);
  await ensureNotaSchema(testPool);
  await ensureSemiItemsSchema(testPool);
  await ensureSemiItemsSchema(testPool);
  await ensureRecipeIngredientSchema(testPool);
  await ensureRecipeIngredientSchema(testPool);
  const shopping = createShoppingModel(testPool);
  assert.deepEqual(await shopping.suppliers(), []);
  const [seed] = await testPool.query("INSERT INTO stock_raw_items (name,category,unit,stock,supplier) VALUES ('Kopi Uji','Umum','gr',-50,'Legacy Shop')");
  const first = {id:seed.insertId};
  await testPool.query("INSERT INTO menu_items (id, name) VALUES (1, 'Kopi Resep')");
  await testPool.query("INSERT INTO menu_item_prices (menu_item_id, regular_price) VALUES (1, 20000)");
  await testPool.query("INSERT INTO menu_item_recipes (menu_item_id, stock_item_id, quantity) VALUES (1, ?, 10)", [first.id]);
  await ensureShoppingSchema(testPool);
  assert.deepEqual(await shopping.suppliers(), [], "schema must not create suppliers");
  const payload = {
    requestId:crypto.randomUUID(),date:"2026-09-15",suplierName:"Toko Uji",paymentMethod:"Cash",
    items:[{stockItemId:first.id,quantity:1.5,unit:"kg",unitPrice:100000},{itemName:"Cup Uji",quantity:3,unit:"pcs",unitPrice:2000}],
  };
  const results = await Promise.all([shopping.save(payload,1),shopping.save(payload,1)]);
  assert.equal(results[0].id,results[1].id);
  assert.equal(results.filter(result=>!result.duplicate).length,1);
  assert.equal(results[0].total,156000);
  const [[second]] = await testPool.query("SELECT id FROM stock_raw_items WHERE name='Cup Uji'");
  let [stocks] = await testPool.query("SELECT * FROM stock_raw_items ORDER BY id");
  assert.equal(Number(stocks.find(stock=>stock.id===first.id).stock),1450);
  assert.equal(Number(stocks.find(stock=>stock.id===first.id).unit_cost),103);
  assert.equal(Number(stocks.find(stock=>stock.id===first.id).stock_value),150000);
  const [[recipe]] = await testPool.query("SELECT cost FROM menu_item_recipes WHERE menu_item_id = 1");
  assert.equal(recipe.cost, 1030, "purchase refreshes recipe cost (10 gr x 103)");
  const [[menuPrice]] = await testPool.query("SELECT hpp_cost, gross_profit FROM menu_item_prices WHERE menu_item_id = 1");
  assert.deepEqual([Number(menuPrice.hpp_cost), Number(menuPrice.gross_profit)], [1030, 18970]);
  assert.equal(stocks.find(stock=>stock.id===second.id).unit,"pcs");
  assert.equal(Number(stocks.find(stock=>stock.id===second.id).stock),3);
  assert.equal(Number(stocks.find(stock=>stock.id===second.id).unit_cost),2000);
  assert.equal(Number(stocks.find(stock=>stock.id===second.id).stock_value),6000);
  const [liquidSeed] = await testPool.query("INSERT INTO stock_raw_items (name,category,unit,stock,supplier) VALUES ('Susu Uji','Umum','ml',0,'Legacy Shop')");
  const liquidPayload = {...payload,requestId:crypto.randomUUID(),items:[{stockItemId:liquidSeed.insertId,quantity:0.5,unit:"liter",unitPrice:40000}]};
  const liquidPurchase = await shopping.save(liquidPayload,1);
  assert.equal(liquidPurchase.total,20000);
  const [[liquidStock]] = await testPool.query("SELECT stock, unit_cost, stock_value FROM stock_raw_items WHERE id=?",[liquidSeed.insertId]);
  assert.equal(Number(liquidStock.stock),500);
  assert.equal(Number(liquidStock.unit_cost),40);
  assert.equal(Number(liquidStock.stock_value),20000);
  [stocks] = await testPool.query("SELECT * FROM stock_raw_items ORDER BY id");
  await assert.rejects(shopping.save({...payload,note:"changed"},1),error=>error.status===409);
  const before = JSON.stringify(stocks);
  await assert.rejects(shopping.save({...payload,requestId:crypto.randomUUID(),items:[payload.items[0],{...payload.items[1],unit:"kg"}]},1),error=>error.status===400);
  [stocks] = await testPool.query("SELECT * FROM stock_raw_items ORDER BY id");
  assert.equal(JSON.stringify(stocks),before,"failed second line must roll back first stock increment");
  const [[count]] = await testPool.query("SELECT COUNT(*) AS n FROM history_stock_raw_purchases");
  assert.equal(count.n,2);
  const history = await shopping.list({search:"Kopi",page:1});
  assert.equal(history.total,1);
  assert.equal(history.purchases[0].items.length,2);
  assert.equal(Number(history.purchases[0].items[0].stock_quantity),1500);
  assert.equal(history.itemGroups.length,1);
  assert.equal(history.itemGroups[0].itemName,"Kopi Uji");
  assert.equal(history.itemGroups[0].histories.length,1);
  for(const patch of [{date:"2026-02-30"},{items:[]},{items:[{...payload.items[0],quantity:-1}]},{items:[{...payload.items[0],unitPrice:""}]}]) {
    await assert.rejects(shopping.save({...payload,requestId:crypto.randomUUID(),...patch},1),error=>error.status===400);
  }
  // Different requests for the same stock must add quantities rather than overwrite.
  await Promise.all([1,2].map(()=>shopping.save({...payload,requestId:crypto.randomUUID(),items:[payload.items[1]]},1)));
  const [[cup]] = await testPool.query("SELECT stock FROM stock_raw_items WHERE id=?",[second.id]);
  assert.equal(Number(cup.stock),9);
  // New names and stock changes are rolled back together on a later invalid line.
  await assert.rejects(shopping.save({...payload,requestId:crypto.randomUUID(),suplierName:"Toko Gagal",
    items:[{itemName:"Barang Gagal",quantity:1,unit:"pcs",unitPrice:1000},{stockItemId:second.id,quantity:1,unit:"kg",unitPrice:1000}]},1),error=>error.status===400);
  assert.equal((await testPool.query("SELECT id FROM suplier WHERE name='Toko Gagal'"))[0].length,0);
  assert.equal((await testPool.query("SELECT id FROM stock_raw_items WHERE name='Barang Gagal'"))[0].length,0);
  // New-name submissions reuse case-insensitive existing names without duplicate masters.
  await shopping.save({...payload,requestId:crypto.randomUUID(),suplierName:"  toko   uji ",items:[{itemName:"cup uji",quantity:1,unit:"pcs",unitPrice:2000}]},1);
  assert.equal((await shopping.suppliers()).length,1);
  assert.equal((await testPool.query("SELECT id FROM stock_raw_items"))[0].length,3);
  const supplier = (await shopping.suppliers())[0];
  await shopping.save({...payload,requestId:crypto.randomUUID(),suplierName:undefined,suplierId:supplier.id,items:[{stockItemId:second.id,quantity:1,unit:"pcs",unitPrice:2000}]},1);
  await assert.rejects(shopping.save({...payload,suplierId:supplier.id},1),error=>error.status===400);
  // Concurrent purchases can create the same new shop/item only once.
  await Promise.all([1,2].map(()=>shopping.save({...payload,requestId:crypto.randomUUID(),suplierName:"Toko Bersama",items:[{itemName:"Barang Bersama",quantity:2,unit:"pcs",unitPrice:1000}]},1)));
  const [shared] = await testPool.query("SELECT stock FROM stock_raw_items WHERE name='Barang Bersama'");
  assert.equal(shared.length,1);
  assert.equal(Number(shared[0].stock),4);
  const managed = await shopping.saveSupplier({name:"  Suplier Pengaturan  "});
  assert.equal(managed.name,"Suplier Pengaturan");
  await assert.rejects(shopping.saveSupplier({name:"suplier pengaturan"}),error=>error.status===409);
  await shopping.saveSupplier({id:managed.id,name:"Suplier Diubah"});
  await shopping.saveSupplier({id:managed.id,name:"Suplier Diubah"});
  assert.equal((await shopping.suppliers()).find(row=>row.id===managed.id).name,"Suplier Diubah");
  await assert.rejects(shopping.saveSupplier({id:managed.id,name:"Toko Uji"}),error=>error.status===409);
  await assert.rejects(shopping.saveSupplier({id:4294967295,name:"Tidak Ada"}),error=>error.status===404);
  await assert.rejects(shopping.saveSupplier({name:" "}),error=>error.status===400);
  await shopping.saveSupplier({id:supplier.id,name:"Toko Uji Baru"});
  assert.equal((await shopping.list({search:"Kopi"})).purchases[0].suplier_name,"Toko Uji","supplier rename preserves purchase snapshot");

  // Payment sources: seeded once; a purchase posts saldo keluar and item edits/deletes post the difference.
  const sources = createPaymentSourceService(testPool);
  const seeded = await sources.list();
  assert.deepEqual(seeded.map(source=>[source.name,source.balance,source.isActive]),[["Kasir (Tunai)",0,true],["Rekening Penjualan",0,true],["Niskala",0,true]]);
  const [kasir,rekening,niskala] = seeded;
  await sources.save({id:niskala.id,name:"Niskala Pusat"});
  await ensurePaymentSourcesSchema(testPool);
  assert.deepEqual((await sources.list()).map(source=>source.name),["Kasir (Tunai)","Rekening Penjualan","Niskala Pusat"],"renamed seeds are not created again");
  await assert.rejects(sources.save({name:" kasir (tunai) "}),error=>error.status===409);
  const ledgerCount = async () => (await testPool.query("SELECT COUNT(*) AS n FROM history_payment_source_mutations"))[0][0].n;
  // Purchases without a source (older clients and the purchases above) never touch balances.
  const legacyMutations = await ledgerCount();
  assert.equal(legacyMutations,0);
  const [[legacyItem]] = await testPool.query("SELECT id, quantity, unit FROM history_stock_raw_purchase_items WHERE stock_item_id=? ORDER BY id LIMIT 1",[second.id]);
  await shopping.updateItem(legacyItem.id,{quantity:Number(legacyItem.quantity),unit:legacyItem.unit,unitPrice:2100},1);
  assert.equal(await ledgerCount(),0);
  await sources.recordMutation(kasir.id,{type:"in",amount:500000,date:"2026-09-14",note:"Modal awal"},1);
  const paidPayload = {...payload,requestId:crypto.randomUUID(),paymentSourceId:kasir.id,items:[{stockItemId:second.id,quantity:2,unit:"pcs",unitPrice:2500}]};
  const paidResults = await Promise.all([shopping.save(paidPayload,1),shopping.save(paidPayload,1)]);
  const paid = paidResults.find(result=>!result.duplicate);
  assert.equal(paid.balance,495000);
  assert.equal((await testPool.query("SELECT COUNT(*) AS n FROM history_payment_source_mutations WHERE reference_id=?",[paid.id]))[0][0].n,1,"a replayed purchase posts once");
  assert.equal((await testPool.query("SELECT payment_method FROM history_stock_raw_purchases WHERE id=?",[paid.id]))[0][0].payment_method,"Kasir (Tunai)");
  const [[paidItem]] = await testPool.query("SELECT id FROM history_stock_raw_purchase_items WHERE purchase_id=?",[paid.id]);
  await shopping.updateItem(paidItem.id,{quantity:2,unit:"pcs",unitPrice:3000},1);
  assert.equal((await sources.findById(kasir.id)).balance,494000);
  await shopping.updateItem(paidItem.id,{quantity:2,unit:"pcs",unitPrice:3000},1);
  await shopping.deleteItem(paidItem.id,1);
  const ledger = await sources.listMutations(kasir.id);
  assert.deepEqual(ledger.mutations.map(row=>[row.referenceType,row.amountIn,row.amountOut,row.balanceAfter]),[
    ["purchase_delete",6000,0,500000],
    ["purchase_edit",0,1000,494000],
    ["purchase",0,5000,495000],
    ["manual",500000,0,500000],
  ],"an unchanged edit posts nothing");
  assert.deepEqual([ledger.total,ledger.totalIn,ledger.totalOut],[4,506000,6000]);
  assert.deepEqual([ledger.mutations[3].date,ledger.mutations[3].note,ledger.mutations[3].userName],["2026-09-14","Modal awal","Admin Uji"]);
  assert.equal(ledger.mutations[2].note,`Belanja #${paid.id} - Toko Uji`);
  // The saldo may go below zero; inactive sources and invalid entries are rejected.
  const overdrawn = await shopping.save({...payload,requestId:crypto.randomUUID(),paymentSourceId:niskala.id,items:[{stockItemId:second.id,quantity:1,unit:"pcs",unitPrice:7000}]},1);
  assert.equal(overdrawn.balance,-7000);
  await sources.save({id:rekening.id,name:"Rekening Penjualan",isActive:false});
  assert.equal((await sources.list()).length,2);
  assert.equal((await sources.list({includeInactive:true})).length,3);
  await assert.rejects(shopping.save({...payload,requestId:crypto.randomUUID(),paymentSourceId:rekening.id},1),error=>error.status===400);
  await sources.recordMutation(niskala.id,{type:"out",amount:"1000.5"},1);
  assert.equal((await sources.findById(niskala.id)).balance,-8000.5);
  for (const body of [{type:"x",amount:1},{type:"in",amount:0},{type:"in",amount:-5},{type:"in",amount:1,date:"2026-02-30"}]) {
    await assert.rejects(sources.recordMutation(kasir.id,body,1),error=>error.status===400);
  }
  await assert.rejects(sources.recordMutation(4294967295,{type:"in",amount:1},1),error=>error.status===404);

  // Bukti nota: only real JPG/PNG/WEBP bytes are stored, at most 10 per purchase.
  receiptDir = await fs.mkdtemp(path.join(os.tmpdir(),"pos-receipts-"));
  const receipts = createAttachmentService(testPool,receiptDir);
  const jpeg = Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(20)]);
  const png = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(20)]);
  const added = await receipts.add(overdrawn.id,[{buffer:jpeg,originalname:"nota.jpg"},{buffer:png,originalname:"kuitansi\u0007.png"}],1);
  assert.deepEqual(added.map(row=>row.name),["nota.jpg","kuitansi.png"]);
  const found = await receipts.find(added[0].id);
  assert.equal(found.mimeType,"image/jpeg");
  assert.deepEqual(await fs.readFile(found.filePath),jpeg);
  await assert.rejects(receipts.add(overdrawn.id,[{buffer:jpeg,originalname:"a.jpg"},{buffer:Buffer.from("<script>alert(1)</script>"),originalname:"b.jpg"}],1),error=>error.status===400);
  await assert.rejects(receipts.add(4294967295,[{buffer:jpeg,originalname:"a.jpg"}],1),error=>error.status===404);
  await assert.rejects(receipts.add(overdrawn.id,Array.from({length:9},()=>({buffer:jpeg,originalname:"a.jpg"})),1),error=>error.status===400);
  assert.equal((await fs.readdir(receiptDir)).length,2,"rejected uploads leave no files");
  const withReceipts = (await shopping.list({search:"Cup"})).itemGroups[0].histories.find(row=>row.purchaseId===overdrawn.id);
  assert.deepEqual(withReceipts.attachments.map(row=>row.url),added.map(row=>`/api/shopping/purchase-attachments/${row.id}`));
  await receipts.remove(added[0].id);
  assert.deepEqual(await fs.readdir(receiptDir),[path.basename((await receipts.find(added[1].id)).filePath)]);
  await assert.rejects(receipts.find(added[0].id),error=>error.status===404);

  // Belanja perlengkapan: the same nota, its own stock; bahan baku and HPP stay untouched.
  const supply = createSupplyShoppingService(testPool);
  const rawBefore = JSON.stringify((await testPool.query("SELECT * FROM stock_raw_items ORDER BY id"))[0]);
  const supplyPayload = {requestId:crypto.randomUUID(),date:"2026-10-29",suplierName:"Toko Plastik",paymentSourceId:kasir.id,note:"perlengkapan",
    items:[{itemName:"Gas LPG",category:"Perlengkapan",quantity:2,unit:"pcs",unitPrice:22000},{itemName:"Banner Promo",category:"Promosi",quantity:1,unit:"pcs",unitPrice:150000}]};
  const supplyResults = await Promise.all([supply.save(supplyPayload,1),supply.save(supplyPayload,1)]);
  const supplyPurchase = supplyResults.find(result=>!result.duplicate);
  assert.equal(supplyResults.filter(result=>result.duplicate).length,1);
  assert.deepEqual([supplyPurchase.total,supplyPurchase.balance],[194000,306000]);
  assert.equal(JSON.stringify((await testPool.query("SELECT * FROM stock_raw_items ORDER BY id"))[0]),rawBefore);
  const supplyRow = async name => (await testPool.query("SELECT category, unit, stock, unit_cost, stock_value FROM stock_supply_items WHERE name=?",[name]))[0][0];
  assert.deepEqual(await supplyRow("Gas LPG"),{category:"Perlengkapan",unit:"pcs",stock:"2.00",unit_cost:22000,stock_value:"44000.00"});
  assert.equal((await supplyRow("Banner Promo")).category,"Promosi");
  const [[supplyMutation]] = await testPool.query("SELECT amount_out, note FROM history_payment_source_mutations WHERE reference_type='supply_purchase' AND reference_id=?",[supplyPurchase.id]);
  assert.deepEqual([Number(supplyMutation.amount_out),supplyMutation.note],[194000,`Belanja lainnya #${supplyPurchase.id} - Toko Plastik`]);
  const [[gas]] = await testPool.query("SELECT id FROM stock_supply_items WHERE name='Gas LPG'");
  await supply.save({...supplyPayload,requestId:crypto.randomUUID(),suplierName:"Toko Plastik",items:[{supplyItemId:gas.id,quantity:1,unit:"pcs",unitPrice:24000}]},1);
  assert.deepEqual(await supplyRow("Gas LPG"),{category:"Perlengkapan",unit:"pcs",stock:"3.00",unit_cost:22667,stock_value:"68000.00"});
  // Item edits and deletes move stock and post the difference to the same source.
  const [supplyItems] = await testPool.query("SELECT id, item_name FROM history_stock_supply_purchase_items WHERE purchase_id=? ORDER BY id",[supplyPurchase.id]);
  const gasLine = supplyItems.find(row=>row.item_name==="Gas LPG");
  const bannerLine = supplyItems.find(row=>row.item_name==="Banner Promo");
  await supply.updateItem(gasLine.id,{quantity:2,unit:"pcs",unitPrice:23000},1);
  assert.deepEqual(await supplyRow("Gas LPG"),{category:"Perlengkapan",unit:"pcs",stock:"3.00",unit_cost:23333,stock_value:"70000.00"});
  await supply.deleteItem(bannerLine.id,1);
  assert.deepEqual([Number((await supplyRow("Banner Promo")).stock),Number((await supplyRow("Banner Promo")).stock_value)],[0,0]);
  assert.equal((await sources.findById(kasir.id)).balance,430000);
  assert.equal(Number((await testPool.query("SELECT total FROM history_stock_supply_purchases WHERE id=?",[supplyPurchase.id]))[0][0].total),46000);
  const kasirLedger = (await sources.listMutations(kasir.id)).mutations.slice(0,4).map(row=>[row.referenceType,row.amountIn,row.amountOut]);
  assert.deepEqual(kasirLedger,[["supply_purchase_delete",150000,0],["supply_purchase_edit",0,2000],["supply_purchase",0,24000],["supply_purchase",0,194000]]);
  // A name is bahan baku or perlengkapan, never both; new perlengkapan need a category.
  await assert.rejects(supply.save({...supplyPayload,requestId:crypto.randomUUID(),items:[{itemName:"Cup Uji",category:"Perlengkapan",quantity:1,unit:"pcs",unitPrice:1}]},1),error=>error.status===400&&/sebagai bahan baku/.test(error.message));
  await assert.rejects(shopping.save({...payload,requestId:crypto.randomUUID(),items:[{itemName:"Gas LPG",quantity:1,unit:"pcs",unitPrice:1}]},1),error=>error.status===400&&/Lainnya/.test(error.message));
  for (const category of [undefined,"Bahan"]) {
    await assert.rejects(supply.save({...supplyPayload,requestId:crypto.randomUUID(),items:[{itemName:"Sapu",category,quantity:1,unit:"pcs",unitPrice:1}]},1),error=>error.status===400);
  }
  assert.equal((await testPool.query("SELECT id FROM stock_supply_items WHERE name='Sapu'"))[0].length,0);
  const supplyHistory = await supply.list({search:"Gas"});
  assert.equal(supplyHistory.groupTotal,1);
  // TOTAL PENGELUARAN of Per Item: the cost of every matching line, all pages.
  assert.equal(supplyHistory.totalSpending,supplyHistory.itemGroups[0].histories.reduce((sum,item)=>sum+item.costTotal,0));
  assert.ok(supplyHistory.totalSpending>0);
  assert.equal((await supply.list({search:"Promosi"})).totalSpending,0);
  assert.deepEqual([supplyHistory.itemGroups[0].itemName,supplyHistory.itemGroups[0].category,supplyHistory.itemGroups[0].stockItemId,supplyHistory.itemGroups[0].histories.length],["Gas LPG","Perlengkapan",gas.id,2]);
  assert.equal(supplyHistory.itemGroups[0].histories[0].paymentMethod,"Kasir (Tunai)");
  // Search also matches the category; the deleted banner line left no history.
  assert.deepEqual((await supply.list({search:"Perlengkapan"})).itemGroups.map(group=>group.itemName),["Gas LPG"]);
  assert.equal((await supply.list({search:"Promosi"})).groupTotal,0);
  const supplyReceipts = createAttachmentService(testPool,receiptDir,RECEIPT_TARGETS.supply);
  const [supplyReceipt] = await supplyReceipts.add(supplyPurchase.id,[{buffer:jpeg,originalname:"nota-gas.jpg"}],1);
  assert.equal(supplyReceipt.url,`/api/shopping/supply-purchase-attachments/${supplyReceipt.id}`);
  assert.match(path.basename((await supplyReceipts.find(supplyReceipt.id)).filePath),new RegExp(`^supply-${supplyPurchase.id}-`));
  assert.deepEqual((await supply.list({search:"Gas"})).itemGroups[0].histories.find(row=>row.purchaseId===supplyPurchase.id).attachments.map(row=>row.id),[supplyReceipt.id]);
  await assert.rejects(supplyReceipts.add(4294967295,[{buffer:jpeg,originalname:"a.jpg"}],1),error=>error.status===404);
  // Ringkasan nota: diskon, PPN and ongkir are spread over the lines into stock; the grand total leaves the saldo.
  const [tehSeed] = await testPool.query("INSERT INTO stock_raw_items (name,category,unit,stock) VALUES ('Teh Footer','Umum','gr',0)");
  const [susuSeed] = await testPool.query("INSERT INTO stock_raw_items (name,category,unit,stock) VALUES ('Susu Footer','Umum','ml',0)");
  const stockRow = async id => (await testPool.query("SELECT stock, unit_cost, stock_value FROM stock_raw_items WHERE id=?",[id]))[0][0];
  const balanceOf = async id => (await sources.findById(id)).balance;
  const kasirStart = await balanceOf(kasir.id);
  const footer = await shopping.save({...payload,requestId:crypto.randomUUID(),paymentSourceId:kasir.id,shippingCost:15000,discountType:"percent",discountValue:10,taxPercent:11,
    items:[{stockItemId:tehSeed.insertId,quantity:1000,unit:"gr",unitPrice:100},{stockItemId:susuSeed.insertId,quantity:1000,unit:"ml",unitPrice:50}]},1);
  assert.deepEqual([footer.total,footer.status,footer.balance],[164850,"posted",kasirStart-164850]);
  const [[footerHeader]] = await testPool.query("SELECT subtotal, discount_amount, tax_amount, shipping_cost, total, status, payment_source_id FROM history_stock_raw_purchases WHERE id=?",[footer.id]);
  assert.deepEqual(Object.values(footerHeader).map(String),["150000.00","15000.00","14850.00","15000.00","164850.00","posted",String(kasir.id)]);
  assert.deepEqual(await stockRow(tehSeed.insertId),{stock:"1000.00",unit_cost:110,stock_value:"109900.00"});
  assert.deepEqual(await stockRow(susuSeed.insertId),{stock:"1000.00",unit_cost:55,stock_value:"54950.00"});
  const [footerLines] = await testPool.query("SELECT id, cost_total FROM history_stock_raw_purchase_items WHERE purchase_id=? ORDER BY id",[footer.id]);
  assert.deepEqual(footerLines.map(line=>line.cost_total),["109900.00","54950.00"]);
  // Editing a line spreads the footer again over every line: 200000 - 20000 + 19800 + 15000.
  await shopping.updateItem(footerLines[0].id,{quantity:1000,unit:"gr",unitPrice:150},1);
  assert.equal((await stockRow(tehSeed.insertId)).stock_value,"161100.00");
  assert.equal((await stockRow(susuSeed.insertId)).stock_value,"53700.00");
  assert.equal(Number((await testPool.query("SELECT total FROM history_stock_raw_purchases WHERE id=?",[footer.id]))[0][0].total),214800);
  assert.equal(await balanceOf(kasir.id),kasirStart-214800);
  // Deleting a line: the remaining line carries the whole footer.
  await shopping.deleteItem(footerLines[1].id,1);
  assert.equal((await stockRow(tehSeed.insertId)).stock_value,"164850.00");
  assert.deepEqual(await stockRow(susuSeed.insertId),{stock:"0.00",unit_cost:0,stock_value:"0.00"});
  assert.equal(await balanceOf(kasir.id),kasirStart-164850);
  const footerLedger = (await sources.listMutations(kasir.id)).mutations.slice(0,2).map(row=>[row.referenceType,row.amountIn,row.amountOut]);
  assert.deepEqual(footerLedger,[["purchase_delete",49950,0],["purchase_edit",0,49950]]);
  for (const patch of [{discountType:"x",discountValue:1},{discountType:"percent",discountValue:101},{shippingCost:-1},{taxPercent:101},{status:"x"}]) {
    await assert.rejects(shopping.save({...payload,requestId:crypto.randomUUID(),...patch},1),error=>error.status===400);
  }

  // Simpan Draft moves nothing; posting it (approval) does.
  const tehBeforeDraft = await stockRow(tehSeed.insertId);
  const kasirBeforeDraft = await balanceOf(kasir.id);
  const draftPayload = {...payload,requestId:crypto.randomUUID(),status:"draft",paymentSourceId:kasir.id,shippingCost:5000,
    items:[{stockItemId:tehSeed.insertId,quantity:500,unit:"gr",unitPrice:100},{itemName:"Gula Draft",quantity:1,unit:"kg",unitPrice:20000}]};
  const draft = await shopping.save(draftPayload,1);
  assert.deepEqual([draft.status,draft.total],["draft",75000]);
  assert.deepEqual(await stockRow(tehSeed.insertId),tehBeforeDraft);
  assert.equal(await balanceOf(kasir.id),kasirBeforeDraft);
  assert.equal((await testPool.query("SELECT id FROM stock_raw_items WHERE name='Gula Draft'"))[0].length,0,"new names wait for posting");
  assert.equal((await shopping.list({search:"Gula Draft"})).itemGroups.length,0,"drafts stay out of the history");
  assert.equal((await shopping.listNotas({search:"Gula Draft"})).total,0,"drafts stay out of the Per Nota history");
  assert.equal((await shopping.save(draftPayload,1)).duplicate,true);
  const [listedDraft] = (await shopping.listDrafts()).filter(row=>row.id===draft.id);
  assert.deepEqual([listedDraft.kind,listedDraft.shippingCost,listedDraft.total,listedDraft.createdBy,listedDraft.paymentSourceId],["raw",5000,75000,"Admin Uji",kasir.id]);
  assert.deepEqual(listedDraft.items.map(item=>[item.stockItemId,item.itemName,item.quantity,item.unit,item.total]),[[tehSeed.insertId,"Teh Footer",500,"gr",50000],[null,"Gula Draft",1,"kg",20000]]);
  const [[draftLine]] = await testPool.query("SELECT id FROM history_stock_raw_purchase_items WHERE purchase_id=? LIMIT 1",[draft.id]);
  await assert.rejects(shopping.updateItem(draftLine.id,{quantity:1,unit:"gr",unitPrice:1},1),error=>error.status===400);
  await assert.rejects(shopping.save({...draftPayload,requestId:crypto.randomUUID(),items:[{stockItemId:tehSeed.insertId,quantity:1,unit:"pcs",unitPrice:1}]},1),error=>error.status===400,"drafts check units too");
  const approved = await shopping.updateDraft(draft.id,{...draftPayload,requestId:undefined,status:"posted",shippingCost:0,
    items:[draftPayload.items[0],{itemName:"Gula Draft",quantity:2,unit:"kg",unitPrice:10000}]},1);
  assert.deepEqual([approved.status,approved.total,approved.balance],["posted",70000,kasirBeforeDraft-70000]);
  assert.equal(Number((await stockRow(tehSeed.insertId)).stock),1500);
  const [[gulaDraft]] = await testPool.query("SELECT unit, stock, stock_value FROM stock_raw_items WHERE name='Gula Draft'");
  assert.deepEqual(gulaDraft,{unit:"kg",stock:"2.00",stock_value:"20000.00"});
  const [[approvedHeader]] = await testPool.query("SELECT status, posted_by, posted_at IS NOT NULL AS posted FROM history_stock_raw_purchases WHERE id=?",[draft.id]);
  assert.deepEqual([approvedHeader.status,approvedHeader.posted_by,Number(approvedHeader.posted)],["posted",1,1]);
  // Per Nota: the whole nota on one row, found by any of its barang or its toko.
  const notaPage = await shopping.listNotas({search:"Gula Draft"});
  assert.equal(notaPage.total,1);
  const [listedNota] = notaPage.notas;
  assert.deepEqual([listedNota.id,listedNota.kind,listedNota.supplierName,listedNota.subtotal,listedNota.total,listedNota.createdBy,listedNota.postedBy,Boolean(listedNota.postedAt)],
    [draft.id,"raw",draftPayload.suplierName,70000,70000,"Admin Uji","Admin Uji",true]);
  assert.deepEqual(listedNota.items.map(item=>[item.itemName,item.quantity,item.unit,item.total,item.costTotal,item.stockQuantity,item.stockUnit]),
    [["Teh Footer",500,"gr",50000,50000,500,"gr"],["Gula Draft",2,"kg",20000,20000,2,"kg"]]);
  // COGS Setelah of each line: the moving average and stock value right after posting.
  const [savedLines] = await testPool.query("SELECT item_name, stock_unit_cost, stock_value_after FROM history_stock_raw_purchase_items WHERE purchase_id=? ORDER BY id",[draft.id]);
  assert.deepEqual(listedNota.items.map(item=>[item.itemName,item.stockAverageCost,item.stockValueAfter]),
    savedLines.map(line=>[line.item_name,Number(line.stock_unit_cost),Number(line.stock_value_after)]));
  assert.deepEqual(listedNota.items.find(item=>item.itemName==="Gula Draft").stockAverageCost,10000,"2 kg for Rp 20.000");
  assert.deepEqual((await shopping.listNotas({search:"Teh Footer"})).notas.map(nota=>nota.id).includes(draft.id),true);
  const firstPage = await shopping.listNotas({});
  assert.ok(firstPage.notas.length<=10 && firstPage.total>=firstPage.notas.length,"10 nota per page");
  // TOTAL PENGELUARAN: the Grand Total of every posted nota, not only this page.
  const [[spent]] = await testPool.query("SELECT COUNT(*) AS notas, SUM(total) AS spending FROM history_stock_raw_purchases WHERE status='posted'");
  assert.deepEqual([firstPage.total,firstPage.totalSpending],[Number(spent.notas),Number(spent.spending)]);
  assert.ok(firstPage.total>10,"more nota than one page, so the total covers the other pages too");
  assert.equal(notaPage.totalSpending,70000,"follows the search");
  assert.ok(firstPage.notas.every((nota,index,all)=>index===0||String(all[index-1].date)>=String(nota.date)),"newest first");
  await assert.rejects(shopping.listNotas({category:"Promosi"}),error=>error.status===400,"bahan baku have no kategori tabs");
  // The period filter (from/to, both days included) keeps the nota, their TOTAL PENGELUARAN and the Per Bahan rows.
  const [[inSeptember]] = await testPool.query("SELECT COUNT(*) AS notas, COALESCE(SUM(total),0) AS spending FROM history_stock_raw_purchases WHERE status='posted' AND purchase_date BETWEEN '2026-09-01' AND '2026-09-30'");
  const september = await shopping.listNotas({from:"2026-09-01",to:"2026-09-30",pageSize:1000});
  assert.deepEqual([september.total,september.totalSpending,september.notas.length],[Number(inSeptember.notas),Number(inSeptember.spending),Number(inSeptember.notas)]);
  assert.ok(Number(inSeptember.notas)>0 && september.notas.every(nota=>nota.date>="2026-09-01"&&nota.date<="2026-09-30"));
  assert.deepEqual([(await shopping.listNotas({from:"2099-01-01"})).total,(await shopping.listNotas({from:"2099-01-01"})).totalSpending],[0,0]);
  assert.equal((await shopping.listNotas({to:"2026-09-30"})).total,(await shopping.listNotas({to:"2026-09-30",from:""})).total);
  assert.equal((await shopping.listNotas({pageSize:1})).notas.length,1);
  for (const bad of [{from:"2026-02-30"},{from:"2026-10-02",to:"2026-10-01"},{pageSize:0},{pageSize:1001}]) {
    await assert.rejects(shopping.listNotas(bad),error=>error.status===400,JSON.stringify(bad));
  }
  assert.deepEqual((await shopping.list({from:"2099-01-01"})).itemGroups,[]);
  const septemberGroups = (await shopping.list({from:"2026-09-01",to:"2026-09-30"})).itemGroups;
  assert.ok(septemberGroups.length>0 && septemberGroups.every(group=>group.histories.every(item=>item.purchaseDate>="2026-09-01"&&item.purchaseDate<="2026-09-30")));
  // A line of the nota opens its barang detail (COGS, riwayat, log): ?itemId keeps that one barang.
  const tehDetail = await shopping.list({itemId:tehSeed.insertId});
  assert.deepEqual(tehDetail.itemGroups.map(group=>[group.stockItemId,group.itemName]),[[tehSeed.insertId,"Teh Footer"]]);
  assert.ok(tehDetail.itemGroups[0].histories.length>=1 && tehDetail.itemGroups[0].histories.every(item=>item.itemName==="Teh Footer"));
  assert.ok(tehDetail.itemGroups[0].histories.some(item=>item.purchaseId===draft.id),"the nota's line is in the barang riwayat");
  assert.equal(tehDetail.groupTotal,1);
  // Per Item and Per Struk agree on TOTAL PENGELUARAN: the lines' cost_total add up to the Grand Totals.
  for (const range of [{}, {from:"2026-09-01",to:"2026-09-30"}]) {
    assert.equal((await shopping.list({...range,page:2})).totalSpending,(await shopping.listNotas(range)).totalSpending,JSON.stringify(range));
  }
  assert.equal((await shopping.list({from:"2099-01-01"})).totalSpending,0);
  await assert.rejects(shopping.list({itemId:"abc"}),error=>error.status===400);
  assert.equal((await shopping.list({search:"Gula Draft"})).itemGroups.length,1);
  await assert.rejects(shopping.updateDraft(draft.id,{...draftPayload,status:"draft"},1),error=>error.status===409);
  await assert.rejects(shopping.removeDraft(draft.id),error=>error.status===409);
  // Deleting a draft takes its photos along.
  const shoppingInDir = createShoppingModel(testPool,{receiptDir});
  const draft2 = await shopping.save({...draftPayload,requestId:crypto.randomUUID()},1);
  const [draftPhoto] = await receipts.add(draft2.id,[{buffer:jpeg,originalname:"nota-draft.jpg"}],1,{onlyDraft:true});
  const draftPhotoPath = (await receipts.find(draftPhoto.id)).filePath;
  await shoppingInDir.removeDraft(draft2.id);
  assert.equal((await testPool.query("SELECT id FROM history_stock_raw_purchases WHERE id=?",[draft2.id]))[0].length,0);
  await assert.rejects(fs.access(draftPhotoPath));
  await assert.rejects(receipts.add(footer.id,[{buffer:jpeg,originalname:"x.jpg"}],1,{onlyDraft:true}),error=>error.status===403);
  // Perlengkapan drafts work the same; a new item gets its category when posted.
  const supplyDraft = await supply.save({...supplyPayload,requestId:crypto.randomUUID(),status:"draft",items:[{itemName:"Sapu Draft",category:"Perlengkapan",quantity:2,unit:"pcs",unitPrice:15000}]},1);
  assert.equal((await testPool.query("SELECT id FROM stock_supply_items WHERE name='Sapu Draft'"))[0].length,0);
  assert.equal((await supply.listDrafts()).find(row=>row.id===supplyDraft.id).items[0].category,"Perlengkapan");
  await supply.updateDraft(supplyDraft.id,{...supplyPayload,status:"posted",items:[{itemName:"Sapu Draft",category:"Perlengkapan",quantity:2,unit:"pcs",unitPrice:15000}]},1);
  assert.deepEqual(await supplyRow("Sapu Draft"),{category:"Perlengkapan",unit:"pcs",stock:"2.00",unit_cost:15000,stock_value:"30000.00"});
  // Posting a nota: saldo keluar and the moving average cost in one transaction,
  // and the menu HPP uses the new cost right away (spec: Gula 2.000 g at Rp 15 + 1.000 g for Rp 18.000 = Rp 16/g).
  const [gulaSim] = await testPool.query("INSERT INTO stock_raw_items (name,category,unit,stock,unit_cost,stock_value) VALUES ('Gula Simulasi','Umum','gr',2000,15,30000)");
  await testPool.query("INSERT INTO menu_items (id, name) VALUES (2, 'Es Teh Manis')");
  await testPool.query("INSERT INTO menu_item_prices (menu_item_id, regular_price) VALUES (2, 8000)");
  await testPool.query("INSERT INTO menu_item_recipes (menu_item_id, stock_item_id, quantity) VALUES (2, ?, 10)", [gulaSim.insertId]);
  const kasirBeforeSim = await balanceOf(kasir.id);
  const sim = await shopping.save({...payload,requestId:crypto.randomUUID(),paymentSourceId:kasir.id,items:[{stockItemId:gulaSim.insertId,quantity:1000,unit:"gr",unitPrice:18}]},1);
  assert.deepEqual(await stockRow(gulaSim.insertId),{stock:"3000.00",unit_cost:16,stock_value:"48000.00"});
  assert.equal(sim.balance,kasirBeforeSim-18000);
  const [[simRecipe]] = await testPool.query("SELECT cost FROM menu_item_recipes WHERE menu_item_id = 2");
  const [[simMenu]] = await testPool.query("SELECT hpp_cost FROM menu_item_prices WHERE menu_item_id = 2");
  assert.deepEqual([simRecipe.cost,Number(simMenu.hpp_cost)],[160,160],"10 g gula at Rp 16 for the next sale");
  // Stock sold below zero is covered first: FRESHMILK -2.000 ml at Rp 20 + 3.000 ml for Rp 59.100.
  const [milkSim] = await testPool.query("INSERT INTO stock_raw_items (name,category,unit,stock,unit_cost,stock_value) VALUES ('Fresh Milk Simulasi','Umum','ml',-2000,20,0)");
  await shopping.save({...payload,requestId:crypto.randomUUID(),paymentSourceId:kasir.id,items:[{stockItemId:milkSim.insertId,quantity:3000,unit:"ml",unitPrice:19.7}]},1);
  assert.deepEqual(await stockRow(milkSim.insertId),{stock:"1000.00",unit_cost:19,stock_value:"19100.00"});
  // Isi per kemasan: 2 pack of 0,25 kg add 500 gr (the isi is kept in the stock unit).
  const [packSeed] = await testPool.query("INSERT INTO stock_raw_items (name,category,unit,stock,unit_cost,stock_value) VALUES ('Gula Pack Uji','Umum','gr',0,0,0)");
  const packed = await shopping.save({...payload,requestId:crypto.randomUUID(),paymentSourceId:kasir.id,items:[{stockItemId:packSeed.insertId,quantity:2,unit:"pack",packSize:0.25,packUnit:"kg",unitPrice:5000}]},1);
  assert.deepEqual(await stockRow(packSeed.insertId),{stock:"500.00",unit_cost:20,stock_value:"10000.00"});
  const [[packLine]] = await testPool.query("SELECT id, quantity, unit, pack_size, stock_quantity, stock_unit FROM history_stock_raw_purchase_items WHERE purchase_id=?",[packed.id]);
  assert.deepEqual([Number(packLine.quantity),packLine.unit,Number(packLine.pack_size),Number(packLine.stock_quantity),packLine.stock_unit],[2,"pack",250,500,"gr"]);
  // Editing the qty keeps the isi; a new isi changes the stock; no isi (pack is not gr) is refused.
  await shopping.updateItem(packLine.id,{quantity:3,unit:"pack",unitPrice:5000},1);
  assert.equal((await stockRow(packSeed.insertId)).stock,"750.00");
  await shopping.updateItem(packLine.id,{quantity:3,unit:"pack",packSize:100,unitPrice:5000},1);
  assert.equal((await stockRow(packSeed.insertId)).stock,"300.00");
  await assert.rejects(shopping.updateItem(packLine.id,{quantity:3,unit:"pack",packSize:null,unitPrice:5000},1),error=>error.status===400);
  await assert.rejects(shopping.save({...payload,requestId:crypto.randomUUID(),items:[{stockItemId:packSeed.insertId,quantity:1,unit:"dus",packSize:1,packUnit:"ml",unitPrice:1}]},1),error=>error.status===400,"the isi must fit the stock unit");
  // A new item bought by the dus takes the isi's unit: 1 dus isi 24 botol for Rp 48.000 = 24 botol at Rp 2.000.
  await shopping.save({...payload,requestId:crypto.randomUUID(),paymentSourceId:kasir.id,items:[{itemName:"Aqua Dus Uji",quantity:1,unit:"dus",packSize:24,packUnit:"botol",unitPrice:48000}]},1);
  const [[aquaDus]] = await testPool.query("SELECT unit, stock, unit_cost FROM stock_raw_items WHERE name='Aqua Dus Uji'");
  assert.deepEqual([aquaDus.unit,Number(aquaDus.stock),aquaDus.unit_cost],["botol",24,2000]);
  const [listedPack] = (await shopping.listNotas({search:"Aqua Dus Uji"})).notas;
  assert.deepEqual(listedPack.items.map(item=>[item.quantity,item.unit,item.packSize,item.packUnit,item.stockQuantity,item.stockUnit]),[[1,"dus",24,"botol",24,"botol"]]);
  const packDraft = await shopping.save({...payload,requestId:crypto.randomUUID(),status:"draft",items:[{stockItemId:packSeed.insertId,quantity:1,unit:"pack",packSize:250,unitPrice:5000}]},1);
  assert.deepEqual((await shopping.listDrafts()).find(row=>row.id===packDraft.id).items.map(item=>[item.unit,item.packSize,item.packUnit]),[["pack",250,"gr"]]);
  await shopping.removeDraft(packDraft.id);
  // Barang Lainnya need no unit: a new one is counted in pcs, an existing one keeps its own unit.
  await supply.save({...supplyPayload,requestId:crypto.randomUUID(),items:[{itemName:"Lakban Uji",category:"Perlengkapan",quantity:3,unitPrice:5000}]},1);
  assert.deepEqual(await supplyRow("Lakban Uji"),{category:"Perlengkapan",unit:"pcs",stock:"3.00",unit_cost:5000,stock_value:"15000.00"});
  const [tabung] = await testPool.query("INSERT INTO stock_supply_items (name,category,unit,stock,unit_cost,stock_value) VALUES ('Gas Tabung Uji','Perlengkapan','tabung',2,20000,40000)");
  const tabungPurchase = await supply.save({...supplyPayload,requestId:crypto.randomUUID(),items:[{supplyItemId:tabung.insertId,quantity:1,unitPrice:23000}]},1);
  assert.deepEqual(await supplyRow("Gas Tabung Uji"),{category:"Perlengkapan",unit:"tabung",stock:"3.00",unit_cost:21000,stock_value:"63000.00"});
  const [[tabungLine]] = await testPool.query("SELECT id, unit, stock_unit FROM history_stock_supply_purchase_items WHERE purchase_id=?",[tabungPurchase.id]);
  assert.deepEqual([tabungLine.unit,tabungLine.stock_unit],["tabung","tabung"]);
  // Editing a line without unit keeps the line's unit.
  await supply.updateItem(tabungLine.id,{quantity:2,unitPrice:23000},1);
  assert.deepEqual(await supplyRow("Gas Tabung Uji"),{category:"Perlengkapan",unit:"tabung",stock:"4.00",unit_cost:21500,stock_value:"86000.00"});
  for (const category of ["Peralatan","Perlengkapan","Promosi","Lain-lain"]) {
    await supply.save({...supplyPayload,requestId:crypto.randomUUID(),items:[{itemName:`Kategori ${category}`,category,quantity:1,unitPrice:1000}]},1);
  }
  await assert.rejects(supply.save({...supplyPayload,requestId:crypto.randomUUID(),items:[{itemName:"Kategori Lama",category:"Operasional",quantity:1,unitPrice:1}]},1),error=>error.status===400);
  // The Belanja tabs list one kategori each, by the item's current kategori.
  const tabNames = async category => (await supply.list({category,search:"Kategori"})).itemGroups.map(group=>[group.itemName,group.category]);
  assert.deepEqual(await tabNames("Promosi"),[["Kategori Promosi","Promosi"]]);
  assert.deepEqual(await tabNames("Lain-lain"),[["Kategori Lain-lain","Lain-lain"]]);
  await testPool.query("UPDATE stock_supply_items SET category='Peralatan' WHERE name='Kategori Perlengkapan'");
  assert.deepEqual(await tabNames("Peralatan"),[["Kategori Peralatan","Peralatan"],["Kategori Perlengkapan","Peralatan"]]);
  assert.deepEqual(await tabNames("Perlengkapan"),[]);
  // Per Nota tabs: a nota shows under each kategori it holds, with all its lines.
  const mixed = await supply.save({...supplyPayload,requestId:crypto.randomUUID(),suplierName:"Toko Campur Uji",
    items:[{itemName:"Spanduk Campur",category:"Promosi",quantity:1,unitPrice:50000},{itemName:"Pisau Campur",category:"Peralatan",quantity:2,unitPrice:15000}]},1);
  const notaIds = async category => (await supply.listNotas({category,search:"Campur"})).notas.map(nota=>nota.id);
  assert.deepEqual([await notaIds("Promosi"),await notaIds("Peralatan"),await notaIds("Lain-lain")],[[mixed.id],[mixed.id],[]]);
  assert.deepEqual([(await supply.listNotas({category:"Promosi",search:"Campur"})).totalSpending,(await supply.listNotas({category:"Lain-lain",search:"Campur"})).totalSpending],[80000,0]);
  const [mixedNota] = (await supply.listNotas({category:"Promosi",search:"Toko Campur"})).notas;
  assert.deepEqual(mixedNota.items.map(item=>[item.itemName,item.category,item.quantity,item.total]),[["Spanduk Campur","Promosi",1,50000],["Pisau Campur","Peralatan",2,30000]]);
  assert.equal(mixedNota.items[0].supplyItemId>0,true);
  const spandukDetail = await supply.list({itemId:mixedNota.items[0].supplyItemId});
  assert.deepEqual(spandukDetail.itemGroups.map(group=>[group.itemName,group.category,group.histories.length]),[["Spanduk Campur","Promosi",1]]);
  await assert.rejects(supply.list({itemId:"0"}),error=>error.status===400);
  // Barang Lainnya by period too (the Peralatan tab simply sends none).
  assert.equal((await supply.listNotas({category:"Promosi",search:"Campur",from:"2026-10-29",to:"2026-10-29"})).total,1);
  assert.equal((await supply.listNotas({category:"Promosi",search:"Campur",from:"2026-10-30"})).total,0);
  assert.equal((await supply.list({search:"Campur",to:"2026-10-28"})).itemGroups.length,0);
  // Summary cards: Bahan Baku = the posted nota; each kategori what its lines cost (the Campur nota split
  // between Promosi and Peralatan, never counted twice); Valuasi Aset = active Peralatan, lifetime.
  const summaryOf = createShoppingSummary(testPool);
  const lifetime = await summaryOf({});
  assert.equal(lifetime.bahanBaku.total,(await shopping.listNotas({})).totalSpending);
  const [[supplySpent]] = await testPool.query("SELECT COALESCE(SUM(total),0) AS total FROM history_stock_supply_purchases WHERE status='posted'");
  assert.equal(Math.round((lifetime.peralatan.total+lifetime.perlengkapan.total+lifetime.promosi.total+lifetime.lainLain.total)*100),Math.round(Number(supplySpent.total)*100));
  const [[assetValue]] = await testPool.query("SELECT COALESCE(SUM(stock_value),0) AS value FROM stock_supply_items WHERE is_active=TRUE AND category='Peralatan'");
  assert.equal(lifetime.asetPeralatan.value,Number(assetValue.value));
  const campurDay = await summaryOf({from:"2026-10-29",to:"2026-10-29"});
  assert.ok(campurDay.promosi.total>=50000 && campurDay.peralatan.total>=30000,"Spanduk (Promosi) and Pisau (Peralatan) of one nota");
  const future = await summaryOf({from:"2099-01-01"});
  assert.deepEqual([future.bahanBaku,future.lainLain,future.asetPeralatan.value],[{total:0,notas:0},{total:0,notas:0},lifetime.asetPeralatan.value]);
  await assert.rejects(summaryOf({from:"2026-10-02",to:"2026-10-01"}),error=>error.status===400);
  await assert.rejects(supply.listNotas({category:"Operasional"}),error=>error.status===400);
  assert.ok((await supply.list({search:"Kategori"})).itemGroups.length>=4,"no category lists them all");
  await assert.rejects(supply.list({category:"Operasional"}),error=>error.status===400);
  console.log("PASS: purchase transactions and rollback; supplier settings create, rename, duplicate/invalid names, missing ID, unchanged name and purchase history preservation; payment source saldo masuk/keluar; bukti nota uploads; belanja perlengkapan; ringkasan nota (ongkir, diskon, PPN) and drafts; moving average cost on posting; barang Lainnya without unit and per-kategori history.");
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(receiptDir)await fs.rm(receiptDir,{recursive:true,force:true});
  if(testPool)await testPool.end();
  if(created && /^pos_shopping_test_[a-f0-9]{12}$/.test(database))await pool.query(`DROP DATABASE \`${database}\``);
  await pool.end();
});
