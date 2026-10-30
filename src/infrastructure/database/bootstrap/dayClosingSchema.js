// business_day_closings: one row per business day that was closed, by the
// automatic day closing (recaps/dayClosing, 05:00 the next morning) or by
// saving its daily recap. Closing locks the HPP of the day's notas (Modul 2)
// and writes off the leftover of daily bahan setengah jadi, once. Days that
// already have a daily recap were closed by it.
const ensureDayClosingSchema = async (db) => {
  const [tables] = await db.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'business_day_closings'`
  );
  if (tables.length) return;

  await db.query(`
    CREATE TABLE business_day_closings (
      business_date DATE NOT NULL PRIMARY KEY,
      source VARCHAR(10) NOT NULL,
      user_id INT UNSIGNED NULL,
      closed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(
    `INSERT IGNORE INTO business_day_closings (business_date, source, user_id, closed_at)
     SELECT recap_date, 'rekap', created_by, COALESCE(created_at, NOW()) FROM daily_recaps`
  );
};

module.exports = { ensureDayClosingSchema };
