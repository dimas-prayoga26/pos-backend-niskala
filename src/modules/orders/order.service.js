// Order lifecycle. Creating or deleting an order moves ingredient stock in the
// same transaction; orders on a date that has a daily recap are read-only.
const { pool } = require("../../infrastructure/database/pool");
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
const { HPP_CLOSED, HPP_PENDING, allocateBatchCosts, dayOf } = require("./order.hpp");
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
      items = [],
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

    let hasBatchLines = false;
    for (const item of items) {
      const menuItemSnapshot = await findMenuItemSnapshot(
        connection,
        getSourceMenuItemId(item)
      );

      const orderItemId = await Order.insertOrderItem(connection, orderId, {
        item,
        menuItemSnapshot,
      });
      await Order.insertOrderItemCosts(connection, orderItemId, menuItemSnapshot.costs);
      hasBatchLines ||= menuItemSnapshot.costs.some((line) => line.isPending);
    }

    // Modul 2: barang standar have their final HPP now; bahan olahan wait for
    // the Daily Prep and take the day's cooking cost already recorded, if any.
    await Order.setHppStatus(connection, orderId, hasBatchLines ? HPP_PENDING : HPP_CLOSED);
    if (hasBatchLines) {
      await allocateBatchCosts(connection, {
        date: await dayOf(connection, "orders", orderId, "order_date"),
        orderId,
      });
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
  remove,
  updateCateringPaidStatus,
  updateStatus,
};
