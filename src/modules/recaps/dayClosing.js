// Closing of a business day (business_day_closings). Rekap New is a live
// report that saves nothing, so a day is closed on its own at 05:00 the next
// morning (Asia/Jakarta; a shift that ends after midnight can still record its
// Daily Prep until then), or earlier when its daily recap is saved. Closing:
// - locks the HPP of the day's notas (Modul 2, orders/order.hpp): bahan olahan
//   take the day's cooking cost, or keep the one they were sold with;
// - writes off the leftover of daily bahan setengah jadi (Nasi), once.
// Notas of a day already closed that still wait (an online order booked on a
// past day) are locked at the next run.
const logger = require("../../shared/logger");
const { emitRealtimeEvent } = require("../../infrastructure/realtime/socket");
const { allocateBatchCosts } = require("../orders/order.hpp");
const SemiItem = require("../stock/semi.repository");

const CLOSE_HOUR = 5;
const RUN_EVERY_MS = 15 * 60 * 1000;
const TIME_ZONE = "Asia/Jakarta";

const dateKeyIn = (date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

// The latest business day that is over at `now`: yesterday from 05:00, the
// day before until then.
const lastClosableDay = (now = new Date()) => {
  const shifted = new Date(now.getTime() - CLOSE_HOUR * 60 * 60 * 1000);
  const day = new Date(`${dateKeyIn(shifted)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
};

// Closes one business day in the caller's transaction (source "auto" or
// "rekap"). The HPP is locked every time (late notas); the leftover is
// written off only the first time the day is closed.
const closeBusinessDay = async (connection, { date, source, userId = null }) => {
  const hppClosed = await allocateBatchCosts(connection, { date, close: true });
  const [inserted] = await connection.query(
    "INSERT IGNORE INTO business_day_closings (business_date, source, user_id) VALUES (?, ?, ?)",
    [date, source, userId]
  );
  const writtenOff = inserted.affectedRows ? await SemiItem.closeDay(connection, { date, userId }) : [];
  return { hppClosed, writtenOff, firstClose: inserted.affectedRows > 0 };
};

const isDayClosed = async (connection, date) => {
  const [rows] = await connection.query("SELECT 1 FROM business_day_closings WHERE business_date = ? LIMIT 1", [date]);
  return rows.length > 0;
};

// One run of the automatic closing on db (a pool): the latest day that is
// over, and the pending notas of older days.
const autoCloseDays = async (db, { now = new Date() } = {}) => {
  const day = lastClosableDay(now);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [olderDays] = await connection.query(
      `SELECT DISTINCT DATE_FORMAT(order_date, '%Y-%m-%d') AS day
       FROM orders
       WHERE hpp_status = 'pending' AND DATE(order_date) < ?
       ORDER BY day`,
      [day]
    );
    let lateOrders = 0;
    for (const older of olderDays) {
      lateOrders += (await allocateBatchCosts(connection, { date: older.day, close: true })).closedOrders;
    }
    const closed = await closeBusinessDay(connection, { date: day, source: "auto" });
    await connection.commit();
    return { day, lateOrders, ...closed };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// Runs the automatic closing now and every 15 minutes (not in tests).
const startDayClosing = (db) => {
  const run = async () => {
    try {
      const result = await autoCloseDays(db);
      const closedOrders = result.hppClosed.closedOrders + result.lateOrders;
      if (result.firstClose || closedOrders) {
        logger.info(
          `Hari ${result.day} ditutup otomatis: HPP ${closedOrders} nota dikunci, ${result.writtenOff.length} bahan setengah jadi direset.`
        );
      }
      if (closedOrders) emitRealtimeEvent("orders:changed", { action: "hpp-closed" });
      if (result.writtenOff.length) emitRealtimeEvent("stock:changed", { action: "day-closed" });
    } catch (error) {
      logger.error(`Penutupan hari otomatis gagal: ${error.message}`, { stack: error.stack });
    }
  };
  run();
  return setInterval(run, RUN_EVERY_MS);
};

module.exports = { CLOSE_HOUR, autoCloseDays, closeBusinessDay, isDayClosed, lastClosableDay, startDayClosing };
