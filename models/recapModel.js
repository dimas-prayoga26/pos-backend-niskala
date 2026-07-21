const { pool } = require("../config/database");

const allowedPeriodTypes = ["daily", "weekly", "monthly"];

const toNumber = (value) => Number(value || 0);

const mapMeta = (row) => ({
  _id: row.id,
  id: row.id,
  code: row.code,
  periodType: row.code,
  label: row.label,
  description: row.description,
  isActive: Boolean(row.is_active),
  sortOrder: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapDailyRecap = (row) => ({
  _id: row.id,
  id: row.id,
  formatRecapId: row.format_recap_id,
  periodType: row.format_code,
  formatLabel: row.format_label,
  recapDate: row.recap_date,
  userId: row.user_id,
  shiftOfficer: row.shift_officer || row.user_name,
  transactionTotal: row.transaction_total,
  offlineRevenue: toNumber(row.offline_revenue),
  onlineRevenue: toNumber(row.online_revenue),
  cateringRevenue: toNumber(row.catering_revenue),
  totalRevenue: toNumber(row.total_revenue),
  hppTotal: toNumber(row.hpp_total),
  grossProfit: toNumber(row.gross_profit),
  dailyExpense: toNumber(row.daily_expense),
  cashIn: toNumber(row.cash_in),
  qrisIn: toNumber(row.qris_in),
  transferIn: toNumber(row.transfer_in),
  cashDifference: toNumber(row.cash_difference),
  bestMenuItemId: row.best_menu_item_id,
  bestMenu: row.best_menu_name || row.best_menu_current_name,
  leastMenuItemId: row.least_menu_item_id,
  leastMenu: row.least_menu_name || row.least_menu_current_name,
  note: row.note,
  createdBy: row.created_by,
  createdByName: row.created_by_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapWeeklyRecap = (row) => ({
  _id: row.id,
  id: row.id,
  formatRecapId: row.format_recap_id,
  periodType: row.format_code,
  formatLabel: row.format_label,
  periodStartDate: row.period_start_date,
  periodEndDate: row.period_end_date,
  totalOmzet: toNumber(row.total_omzet),
  grossProfit: toNumber(row.gross_profit),
  offlineRevenue: toNumber(row.offline_revenue),
  onlineRevenue: toNumber(row.online_revenue),
  cateringRevenue: toNumber(row.catering_revenue),
  cateringOrderCount: row.catering_order_count || 0,
  topChannel: row.top_channel,
  operationalIssues: row.operational_issues,
  teamEvaluation: row.team_evaluation,
  stockEvaluation: row.stock_evaluation,
  actionPlan: row.action_plan,
  note: row.note,
  createdBy: row.created_by,
  createdByName: row.created_by_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapMonthlyRecap = (row) => ({
  _id: row.id,
  id: row.id,
  formatRecapId: row.format_recap_id,
  periodType: row.format_code,
  formatLabel: row.format_label,
  periodMonth: row.period_month,
  omzet: toNumber(row.omzet),
  hppTotal: toNumber(row.hpp_total),
  grossProfit: toNumber(row.gross_profit),
  estimatedNetProfit: toNumber(row.estimated_net_profit),
  cateringOrderCount: row.catering_order_count || 0,
  retainedMenu: row.retained_menu,
  evaluatedMenu: row.evaluated_menu,
  promotionEvaluation: row.promotion_evaluation,
  supplierEvaluation: row.supplier_evaluation,
  nextMonthStrategy: row.next_month_strategy,
  note: row.note,
  createdBy: row.created_by,
  createdByName: row.created_by_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const findMeta = async ({ periodType } = {}) => {
  const params = [];
  let whereClause = "WHERE is_active = TRUE AND code IS NOT NULL";

  if (periodType) {
    whereClause += " AND code = ?";
    params.push(periodType);
  }

  const [rows] = await pool.query(
    `SELECT *
     FROM meta_data_format_recap
     ${whereClause}
     ORDER BY sort_order ASC, label ASC`,
    params
  );

  return rows.map(mapMeta);
};

const findFormatByCode = async (code) => {
  const [rows] = await pool.query(
    `SELECT *
     FROM meta_data_format_recap
     WHERE code = ? AND is_active = TRUE
     LIMIT 1`,
    [code]
  );

  return mapMeta(rows[0]);
};

const findDailyRecaps = async () => {
  const [rows] = await pool.query(`
    SELECT
      dr.*,
      m.code AS format_code,
      m.label AS format_label,
      u.name AS user_name,
      creator.name AS created_by_name,
      best_menu.name AS best_menu_current_name,
      least_menu.name AS least_menu_current_name
    FROM daily_recaps dr
    INNER JOIN meta_data_format_recap m ON m.id = dr.format_recap_id
    LEFT JOIN users u ON u.id = dr.user_id
    LEFT JOIN users creator ON creator.id = dr.created_by
    LEFT JOIN menu_items best_menu ON best_menu.id = dr.best_menu_item_id
    LEFT JOIN menu_items least_menu ON least_menu.id = dr.least_menu_item_id
    ORDER BY dr.recap_date DESC, dr.created_at DESC
  `);

  return rows.map(mapDailyRecap);
};

const findWeeklyRecaps = async () => {
  const [rows] = await pool.query(`
    SELECT
      wr.*,
      m.code AS format_code,
      m.label AS format_label,
      creator.name AS created_by_name
    FROM weekly_recaps wr
    INNER JOIN meta_data_format_recap m ON m.id = wr.format_recap_id
    LEFT JOIN users creator ON creator.id = wr.created_by
    ORDER BY wr.period_start_date DESC
  `);

  return rows.map(mapWeeklyRecap);
};

const findMonthlyRecaps = async () => {
  const [rows] = await pool.query(`
    SELECT
      mr.*,
      m.code AS format_code,
      m.label AS format_label,
      creator.name AS created_by_name
    FROM monthly_recaps mr
    INNER JOIN meta_data_format_recap m ON m.id = mr.format_recap_id
    LEFT JOIN users creator ON creator.id = mr.created_by
    ORDER BY mr.period_month DESC
  `);

  return rows.map(mapMonthlyRecap);
};

const findAll = async (periodType) => {
  if (periodType === "daily") return findDailyRecaps();
  if (periodType === "weekly") return findWeeklyRecaps();
  if (periodType === "monthly") return findMonthlyRecaps();

  return [];
};

const findByName = async (table, name) => {
  if (!name) return null;

  const [rows] = await pool.query(`SELECT id, name FROM ${table} WHERE name = ? LIMIT 1`, [
    name,
  ]);

  return rows[0] || null;
};

const createDaily = async (format, payload) => {
  const user = payload.userId ? null : await findByName("users", payload.shiftOfficer);
  const bestMenu = payload.bestMenuItemId
    ? null
    : await findByName("menu_items", payload.bestMenu);
  const leastMenu = payload.leastMenuItemId
    ? null
    : await findByName("menu_items", payload.leastMenu);

  const [result] = await pool.query(
    `INSERT INTO daily_recaps
      (format_recap_id, recap_date, user_id, shift_officer, transaction_total,
       offline_revenue, online_revenue, catering_revenue, total_revenue,
       hpp_total, gross_profit, daily_expense, cash_in, qris_in,
       transfer_in, cash_difference,
       best_menu_item_id, best_menu_name, least_menu_item_id,
       least_menu_name, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      format.id,
      payload.recapDate,
      payload.userId || user?.id || null,
      payload.shiftOfficer || user?.name || null,
      payload.transactionTotal,
      payload.offlineRevenue,
      payload.onlineRevenue,
      payload.cateringRevenue,
      payload.totalRevenue,
      payload.hppTotal,
      payload.grossProfit,
      payload.dailyExpense,
      payload.cashIn,
      payload.qrisIn,
      payload.transferIn,
      payload.cashDifference,
      payload.bestMenuItemId || bestMenu?.id || null,
      payload.bestMenu || bestMenu?.name || null,
      payload.leastMenuItemId || leastMenu?.id || null,
      payload.leastMenu || leastMenu?.name || null,
      payload.note || null,
      payload.createdBy || null,
    ]
  );

  const recaps = await findDailyRecaps();
  return recaps.find((recap) => recap.id === result.insertId) || null;
};

const upsertWeekly = async (format, payload) => {
  await pool.query(
    `INSERT INTO weekly_recaps
      (format_recap_id, period_start_date, period_end_date, total_omzet,
       gross_profit, offline_revenue, online_revenue, catering_revenue,
       catering_order_count, top_channel, operational_issues, team_evaluation,
       stock_evaluation, action_plan, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       format_recap_id = VALUES(format_recap_id),
       total_omzet = VALUES(total_omzet),
       gross_profit = VALUES(gross_profit),
       offline_revenue = VALUES(offline_revenue),
       online_revenue = VALUES(online_revenue),
       catering_revenue = VALUES(catering_revenue),
       catering_order_count = VALUES(catering_order_count),
       top_channel = VALUES(top_channel),
       operational_issues = VALUES(operational_issues),
       team_evaluation = VALUES(team_evaluation),
       stock_evaluation = VALUES(stock_evaluation),
       action_plan = VALUES(action_plan),
       note = VALUES(note),
       created_by = VALUES(created_by)`,
    [
      format.id,
      payload.periodStartDate,
      payload.periodEndDate,
      payload.totalOmzet,
      payload.grossProfit,
      payload.offlineRevenue,
      payload.onlineRevenue,
      payload.cateringRevenue,
      payload.cateringOrderCount,
      payload.topChannel || null,
      payload.operationalIssues || null,
      payload.teamEvaluation || null,
      payload.stockEvaluation || null,
      payload.actionPlan || null,
      payload.note || null,
      payload.createdBy || null,
    ]
  );

  const recaps = await findWeeklyRecaps();
  return recaps.find(
    (recap) =>
      String(recap.periodStartDate).slice(0, 10) === payload.periodStartDate &&
      String(recap.periodEndDate).slice(0, 10) === payload.periodEndDate
  );
};

const upsertMonthly = async (format, payload) => {
  await pool.query(
    `INSERT INTO monthly_recaps
      (format_recap_id, period_month, omzet, hpp_total,
       gross_profit, estimated_net_profit, catering_order_count,
       retained_menu, evaluated_menu, promotion_evaluation,
       supplier_evaluation, next_month_strategy, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       format_recap_id = VALUES(format_recap_id),
       omzet = VALUES(omzet),
       hpp_total = VALUES(hpp_total),
       gross_profit = VALUES(gross_profit),
       estimated_net_profit = VALUES(estimated_net_profit),
       catering_order_count = VALUES(catering_order_count),
       retained_menu = VALUES(retained_menu),
       evaluated_menu = VALUES(evaluated_menu),
       promotion_evaluation = VALUES(promotion_evaluation),
       supplier_evaluation = VALUES(supplier_evaluation),
       next_month_strategy = VALUES(next_month_strategy),
       note = VALUES(note),
       created_by = VALUES(created_by)`,
    [
      format.id,
      payload.periodMonth,
      payload.omzet,
      payload.hppTotal,
      payload.grossProfit,
      payload.estimatedNetProfit,
      payload.cateringOrderCount,
      payload.retainedMenu || null,
      payload.evaluatedMenu || null,
      payload.promotionEvaluation || null,
      payload.supplierEvaluation || null,
      payload.nextMonthStrategy || null,
      payload.note || null,
      payload.createdBy || null,
    ]
  );

  const recaps = await findMonthlyRecaps();
  return recaps.find((recap) => recap.periodMonth === payload.periodMonth);
};

const create = async (periodType, payload) => {
  const format = await findFormatByCode(periodType);

  if (!format) return null;

  if (periodType === "daily") return createDaily(format, payload);
  if (periodType === "weekly") return upsertWeekly(format, payload);
  if (periodType === "monthly") return upsertMonthly(format, payload);

  return null;
};

module.exports = {
  allowedPeriodTypes,
  create,
  findAll,
  findMeta,
};
