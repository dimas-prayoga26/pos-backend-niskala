// Order lifecycle. Creating or deleting an order moves ingredient stock in the
// same transaction; orders on a date that has a daily recap are read-only.
const { pool } = require("../../infrastructure/database/pool");
const { resolveOrderBundleChoices } = require("../menu/menu.bundles");
const { resolveOrderIngredientSwaps } = require("../menu/menu.ingredientSwaps");
const {
  deductIngredientStock,
  restoreIngredientStock,
} = require("../stock/stock.movements");
const {
  acquireMonthlyOrderCodeLock,
  createMonthlyOrderCode,
  releaseMonthlyOrderCodeLock,
} = require("./order.code");
const { getSourceMenuItemId, toRecipeLines } = require("./order.items");
const {
  assertNoDailyRecapForDate,
  assertOrderIsNotRecapped,
} = require("./order.recapLock");
const Order = require("./order.repository");
const { findMenuItemSnapshot, findPlatformSnapshot } = require("./order.snapshots");
const { HPP_CLOSED, HPP_PENDING, allocateBatchCosts, coveredSemiIds, dayOf } = require("./order.hpp");
const { normalizeOrderDateInput } = require("./order.validation");

const CLOSED_DAY_MESSAGE =
  "Rekap harian tanggal ini sudah dibuat. Pesanan baru tidak bisa ditambahkan ke tanggal yang sudah closing.";

const resolveCustomerName = async (connection, customerDetails, orderDate) => {
  const customerName = String(customerDetails.name || "").trim();

  if (customerName && customerName.toLowerCase() !== "guest") return customerName;

  const guestCount = await Order.countGuestOrdersOnDate(connection, orderDate);
  return `Guest-${guestCount + 1}`;
};

// Full plans are paid in full at creation; DP plans record the down payment.
const buildCateringPayment = (cateringDetails, bills) => {
  const paymentPlan = cateringDetails.paymentPlan || "Full";
  const dpReceived =
    paymentPlan === "Full"
      ? Number(bills.totalWithTax || 0)
      : Number(cateringDetails.dp || 0);
  const isPaid =
    Boolean(cateringDetails.isPaid) ||
    dpReceived >= Number(bills.totalWithTax || 0);

  return { cateringDetails, paymentPlan, dpReceived, isPaid };
};

const create = async (orderData) => {
  const connection = await pool.getConnection();
  let orderCodeLockName = null;

  try {
    await connection.beginTransaction();

    const {
      customerDetails,
      orderType = "Offline",
      orderPlatformId,
      orderPlatform,
      platformTax,
      orderDate,
      orderStatus,
      bills,
      items: requestedItems = [],
      paymentMethod,
      cateringDetails,
      allowNegativeStock = false,
      note = "",
    } = orderData;
    // Only online orders may be booked on another day; others use "now".
    const effectiveOrderDate =
      orderType === "Online" ? normalizeOrderDateInput(orderDate) : null;

    orderCodeLockName = await acquireMonthlyOrderCodeLock(
      connection,
      effectiveOrderDate
    );

    await assertNoDailyRecapForDate(
      connection,
      effectiveOrderDate ? "?" : "CURRENT_DATE()",
      effectiveOrderDate ? [effectiveOrderDate] : [],
      CLOSED_DAY_MESSAGE
    );

    // Packages with choices carry the menus the cashier picked, and any menu
    // the bahan olahan swapped (Nasi Daun Jeruk for Nasi Putih), checked here.
    const items = [];
    for (const item of requestedItems) {
      const menuItemId = getSourceMenuItemId(item);
      const bundleChoices = await resolveOrderBundleChoices(
        connection,
        menuItemId,
        item.bundleChoices
      );
      const ingredientSwaps = await resolveOrderIngredientSwaps(
        connection,
        menuItemId,
        item.ingredientSwaps
      );
      items.push({ ...item, bundleChoices, ingredientSwaps });
    }

    await deductIngredientStock(connection, toRecipeLines(items), { allowNegativeStock });

    const customerName = await resolveCustomerName(
      connection,
      customerDetails,
      effectiveOrderDate
    );

    const platformSnapshot =
      orderType === "Online"
        ? await findPlatformSnapshot(connection, {
            platformId: orderPlatformId,
            platformName: orderPlatform,
            platformTax,
          })
        : null;

    const orderId = await Order.insertOrder(connection, {
      customerName,
      customerPhone:
        orderType === "Offline"
          ? String(customerDetails.phone || "").trim()
          : "",
      orderType,
      orderStatus,
      orderDate: effectiveOrderDate,
      bills,
      paymentMethod,
      note,
    });

    const orderCode = await createMonthlyOrderCode(connection, orderId);
    await Order.setOrderCode(connection, orderId, orderCode);

    if (platformSnapshot) {
      await Order.insertOrderPlatform(connection, orderId, platformSnapshot);
    }

    if (cateringDetails) {
      await Order.insertCateringDetails(
        connection,
        orderId,
        buildCateringPayment(cateringDetails, bills)
      );
    }

    const batchIds = new Set();
    for (const item of items) {
      const menuItemSnapshot = await findMenuItemSnapshot(
        connection,
        getSourceMenuItemId(item),
        { choices: item.bundleChoices, swaps: item.ingredientSwaps }
      );

      const orderItemId = await Order.insertOrderItem(connection, orderId, {
        item,
        menuItemSnapshot,
      });
      await Order.insertOrderItemCosts(connection, orderItemId, menuItemSnapshot.costs);
      await Order.insertOrderItemBundleChoices(connection, orderItemId, item.bundleChoices);
      await Order.insertOrderItemIngredientSwaps(connection, orderItemId, item.ingredientSwaps);
      menuItemSnapshot.costs
        .filter((line) => line.isPending && line.semiItemId)
        .forEach((line) => batchIds.add(Number(line.semiItemId)));
    }

    // Modul 2: barang standar have their final HPP now, and so do bahan
    // olahan whose stock covers the sale (the day's cooking cost, else the
    // stock's). Those sold short of stock wait for the Daily Prep (Pending Flag).
    const semiIds = [...batchIds];
    const covered = await coveredSemiIds(connection, semiIds);
    const waiting = semiIds.filter((id) => !covered.includes(id));
    await Order.setHppStatus(connection, orderId, waiting.length ? HPP_PENDING : HPP_CLOSED);
    if (semiIds.length) {
      const date = await dayOf(connection, "orders", orderId, "order_date");
      if (covered.length) {
        await allocateBatchCosts(connection, { date, orderId, semiItemIds: covered, finalize: true });
      }
      if (waiting.length) {
        await allocateBatchCosts(connection, { date, orderId, semiItemIds: waiting });
      }
    }

    await connection.commit();
    return await Order.findById(orderId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    // The code lock is released only after commit so the next order sees this code.
    await releaseMonthlyOrderCodeLock(connection, orderCodeLockName);
    connection.release();
  }
};

// Runs a single-statement update on a checked-out connection after the recap lock check.
const withOpenOrder = async (id, update) => {
  const connection = await pool.getConnection();

  try {
    await assertOrderIsNotRecapped(connection, id);
    return await update(connection);
  } finally {
    connection.release();
  }
};

const updateStatus = (id, orderStatus) =>
  withOpenOrder(id, async (connection) => {
    await Order.updateStatus(connection, id, orderStatus);
    return Order.findById(id);
  });

const updateCateringPaidStatus = (id, isPaid) =>
  withOpenOrder(id, async (connection) => {
    const updated = await Order.setCateringPaidStatus(connection, id, isPaid);
    return updated ? Order.findById(id) : null;
  });

const addCateringPayment = (id, amount) =>
  withOpenOrder(id, async (connection) => {
    const updated = await Order.addCateringPayment(connection, id, amount);
    return updated ? Order.findById(id) : null;
  });

// Deleting an order returns its ingredients to stock (recomputed from the current recipe).
const remove = async (id) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    if (!(await Order.orderExists(connection, id))) {
      await connection.rollback();
      return false;
    }

    await assertOrderIsNotRecapped(connection, id);

    const itemRows = await Order.findItemsForStockRestore(connection, id);
    await restoreIngredientStock(connection, toRecipeLines(itemRows));

    const deleted = await Order.deleteOrder(connection, id);

    await connection.commit();
    return deleted;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  addCateringPayment,
  create,
  findAll: Order.findAll,
  findById: Order.findById,
  findItemCosts: Order.findItemCosts,
  remove,
  updateCateringPaidStatus,
  updateStatus,
};
