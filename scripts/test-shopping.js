// Integration checks use a fresh, isolated database and never modify POS stock.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");
const config = require("../config/config");
const { pool } = require("../config/database");
const { ensureShoppingSchema } = require("../config/shoppingSchema");
const { createShoppingModel, convertQuantity } = require("../models/shoppingModel");
const database = `pos_shopping_test_${crypto.randomBytes(6).toString("hex")}`;
let testPool, created = false;
(async () => {
  assert.equal(convertQuantity(1.5,"kg","gr"),1500);
  assert.equal(convertQuantity(0.5,"liter","ml"),500);
  assert.equal(convertQuantity(750,"ml","liter"),0.75);
  assert.throws(()=>convertQuantity(2,"pcs","ml"),error=>error.status===400);
  await pool.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  created = true;
  testPool = mysql.createPool({host:config.dbHost,port:config.dbPort,user:config.dbUser,password:config.dbPassword,database,dateStrings:true,connectionLimit:5});
  await testPool.query("CREATE TABLE users (id INT UNSIGNED PRIMARY KEY) ENGINE=InnoDB");
  await testPool.query(`CREATE TABLE stock_items (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(150) NOT NULL UNIQUE,
    category VARCHAR(100) NOT NULL, unit VARCHAR(30) NOT NULL, stock DECIMAL(12,2) NOT NULL DEFAULT 0,
    minimum_stock DECIMAL(12,2) NOT NULL DEFAULT 0,
    average_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
    stock_value DECIMAL(14,2) NOT NULL DEFAULT 0,
    supplier VARCHAR(150),
    is_active BOOLEAN DEFAULT TRUE, is_unlimited BOOLEAN DEFAULT FALSE
  ) ENGINE=InnoDB`);
  await testPool.query("INSERT INTO users VALUES (1)");
  await ensureShoppingSchema(testPool);
  await ensureShoppingSchema(testPool);
  const shopping = createShoppingModel(testPool);
  assert.deepEqual(await shopping.suppliers(), []);
  const [seed] = await testPool.query("INSERT INTO stock_items (name,category,unit,stock,supplier) VALUES ('Kopi Uji','Umum','gr',-50,'Legacy Shop')");
  const first = {id:seed.insertId};
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
  const [[second]] = await testPool.query("SELECT id FROM stock_items WHERE name='Cup Uji'");
  let [stocks] = await testPool.query("SELECT * FROM stock_items ORDER BY id");
  assert.equal(Number(stocks.find(stock=>stock.id===first.id).stock),1450);
  assert.equal(Number(stocks.find(stock=>stock.id===first.id).average_cost),103.4483);
  assert.equal(Number(stocks.find(stock=>stock.id===first.id).stock_value),150000);
  assert.equal(stocks.find(stock=>stock.id===second.id).unit,"pcs");
  assert.equal(Number(stocks.find(stock=>stock.id===second.id).stock),3);
  assert.equal(Number(stocks.find(stock=>stock.id===second.id).average_cost),2000);
  assert.equal(Number(stocks.find(stock=>stock.id===second.id).stock_value),6000);
  const [liquidSeed] = await testPool.query("INSERT INTO stock_items (name,category,unit,stock,supplier) VALUES ('Susu Uji','Umum','ml',0,'Legacy Shop')");
  const liquidPayload = {...payload,requestId:crypto.randomUUID(),items:[{stockItemId:liquidSeed.insertId,quantity:0.5,unit:"liter",unitPrice:40000}]};
  const liquidPurchase = await shopping.save(liquidPayload,1);
  assert.equal(liquidPurchase.total,20000);
  const [[liquidStock]] = await testPool.query("SELECT stock, average_cost, stock_value FROM stock_items WHERE id=?",[liquidSeed.insertId]);
  assert.equal(Number(liquidStock.stock),500);
  assert.equal(Number(liquidStock.average_cost),40);
  assert.equal(Number(liquidStock.stock_value),20000);
  [stocks] = await testPool.query("SELECT * FROM stock_items ORDER BY id");
  await assert.rejects(shopping.save({...payload,note:"changed"},1),error=>error.status===409);
  const before = JSON.stringify(stocks);
  await assert.rejects(shopping.save({...payload,requestId:crypto.randomUUID(),items:[payload.items[0],{...payload.items[1],unit:"kg"}]},1),error=>error.status===400);
  [stocks] = await testPool.query("SELECT * FROM stock_items ORDER BY id");
  assert.equal(JSON.stringify(stocks),before,"failed second line must roll back first stock increment");
  const [[count]] = await testPool.query("SELECT COUNT(*) AS n FROM stock_purchases");
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
  const [[cup]] = await testPool.query("SELECT stock FROM stock_items WHERE id=?",[second.id]);
  assert.equal(Number(cup.stock),9);
  // New names and stock changes are rolled back together on a later invalid line.
  await assert.rejects(shopping.save({...payload,requestId:crypto.randomUUID(),suplierName:"Toko Gagal",
    items:[{itemName:"Barang Gagal",quantity:1,unit:"pcs",unitPrice:1000},{stockItemId:second.id,quantity:1,unit:"kg",unitPrice:1000}]},1),error=>error.status===400);
  assert.equal((await testPool.query("SELECT id FROM suplier WHERE name='Toko Gagal'"))[0].length,0);
  assert.equal((await testPool.query("SELECT id FROM stock_items WHERE name='Barang Gagal'"))[0].length,0);
  // New-name submissions reuse case-insensitive existing names without duplicate masters.
  await shopping.save({...payload,requestId:crypto.randomUUID(),suplierName:"  toko   uji ",items:[{itemName:"cup uji",quantity:1,unit:"pcs",unitPrice:2000}]},1);
  assert.equal((await shopping.suppliers()).length,1);
  assert.equal((await testPool.query("SELECT id FROM stock_items"))[0].length,3);
  const supplier = (await shopping.suppliers())[0];
  await shopping.save({...payload,requestId:crypto.randomUUID(),suplierName:undefined,suplierId:supplier.id,items:[{stockItemId:second.id,quantity:1,unit:"pcs",unitPrice:2000}]},1);
  await assert.rejects(shopping.save({...payload,suplierId:supplier.id},1),error=>error.status===400);
  // Concurrent purchases can create the same new shop/item only once.
  await Promise.all([1,2].map(()=>shopping.save({...payload,requestId:crypto.randomUUID(),suplierName:"Toko Bersama",items:[{itemName:"Barang Bersama",quantity:2,unit:"pcs",unitPrice:1000}]},1)));
  const [shared] = await testPool.query("SELECT stock FROM stock_items WHERE name='Barang Bersama'");
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
  console.log("PASS: purchase transactions and rollback; supplier settings create, rename, duplicate/invalid names, missing ID, unchanged name and purchase history preservation.");
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(testPool)await testPool.end();
  if(created && /^pos_shopping_test_[a-f0-9]{12}$/.test(database))await pool.query(`DROP DATABASE \`${database}\``);
  await pool.end();
});
