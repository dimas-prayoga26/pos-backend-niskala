// Payment sources (sumber pembayaran) and their balance history. Balances only
// change through paymentSource.ledger: purchases post saldo keluar there, and
// admins record saldo masuk / keluar by hand here (modal awal, setoran, ...).
const createError = require("http-errors");
const { pool } = require("../../infrastructure/database/pool");
const { clean, dateKey, number, todayKey } = require("../../shared/utils/validate");
const { REFERENCE_TYPES, postMutation } = require("./paymentSource.ledger");

const MUTATION_PAGE_SIZE = 20;

const mapSource = (row) => ({
  id: row.id,
  name: row.name,
  balance: Number(row.balance || 0),
  isActive: Boolean(row.is_active),
  sortOrder: Number(row.sort_order || 0),
});
const mapMutation = (row) => ({
  id: row.id,
  date: row.mutation_date,
  amountIn: Number(row.amount_in || 0),
  amountOut: Number(row.amount_out || 0),
  balanceAfter: Number(row.balance_after || 0),
  referenceType: row.reference_type,
  referenceId: row.reference_id,
  note: row.note || "",
  userName: row.user_name || "",
  createdAt: row.created_at,
});
const sourceId = (value) => number(value, 1, 4294967295, 0, "ID sumber pembayaran");

const createPaymentSourceService = (db) => {
  const findById = async (id) => {
    const [[row]] = await db.query("SELECT * FROM meta_data_payment_source WHERE id = ?", [sourceId(id)]);
    if (!row) throw createError(404, "Sumber pembayaran tidak ditemukan.");
    return mapSource(row);
  };

  const list = async ({ includeInactive = false } = {}) => {
    const [rows] = await db.query(
      `SELECT * FROM meta_data_payment_source
       ${includeInactive ? "" : "WHERE is_active = TRUE"}
       ORDER BY sort_order, name`
    );
    return rows.map(mapSource);
  };

  const save = async ({ id, name, isActive = true }) => {
    name = clean(name, 100, "Nama sumber pembayaran");
    try {
      if (id != null) {
        const [result] = await db.query(
          "UPDATE meta_data_payment_source SET name = ?, is_active = ? WHERE id = ?",
          [name, isActive ? 1 : 0, sourceId(id)]
        );
        if (!result.affectedRows) throw createError(404, "Sumber pembayaran tidak ditemukan.");
        return findById(id);
      }
      const [result] = await db.query(
        `INSERT INTO meta_data_payment_source (name, is_active, sort_order)
         SELECT ?, ?, COALESCE(MAX(sort_order), 0) + 1 FROM meta_data_payment_source`,
        [name, isActive ? 1 : 0]
      );
      return findById(result.insertId);
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") throw createError(409, "Nama sumber pembayaran sudah digunakan.");
      throw error;
    }
  };

  // Saldo masuk (type "in") or saldo keluar ("out") entered by an admin.
  const recordMutation = async (id, body = {}, userId = null) => {
    id = sourceId(id);
    if (!["in", "out"].includes(body.type)) throw createError(400, "Pilih saldo masuk atau saldo keluar.");
    const amount = number(body.amount, 0.01, 999999999999.99, 2, "Nominal");
    const date = body.date ? dateKey(body.date) : todayKey();
    const note = body.note ? clean(body.note, 255, "Keterangan") : "";
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();
      const mutation = await postMutation(connection, {
        sourceId: id,
        amount: body.type === "in" ? amount : -amount,
        date,
        referenceType: REFERENCE_TYPES.manual,
        note: note || (body.type === "in" ? "Saldo masuk" : "Saldo keluar"),
        userId,
      });
      await connection.commit();
      return mutation;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };

  // Newest first, in the order they were recorded (balance_after follows that order).
  const listMutations = async (id, { page = 1 } = {}) => {
    const source = await findById(id);
    page = Math.max(1, Math.floor(Number(page) || 1));
    const [[summary]] = await db.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(amount_in), 0) AS total_in, COALESCE(SUM(amount_out), 0) AS total_out
       FROM history_payment_source_mutations WHERE payment_source_id = ?`,
      [source.id]
    );
    const [rows] = await db.query(
      `SELECT m.*, u.name AS user_name
       FROM history_payment_source_mutations m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.payment_source_id = ?
       ORDER BY m.id DESC
       LIMIT ? OFFSET ?`,
      [source.id, MUTATION_PAGE_SIZE, (page - 1) * MUTATION_PAGE_SIZE]
    );

    return {
      source,
      mutations: rows.map(mapMutation),
      total: Number(summary.total),
      totalIn: Number(summary.total_in),
      totalOut: Number(summary.total_out),
      page,
      pageSize: MUTATION_PAGE_SIZE,
    };
  };

  return { findById, list, listMutations, recordMutation, save };
};

module.exports = { ...createPaymentSourceService(pool), createPaymentSourceService };
