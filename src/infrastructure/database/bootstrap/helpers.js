const { pool } = require("../pool");

const runSafeMigration = async (query) => {
  try {
    await pool.query(query);
  } catch (error) {
    // Keeps startup idempotent across fresh and already-migrated databases.
  }
};

const tableExists = async (tableName) => {
  const [rows] = await pool.query("SHOW TABLES LIKE ?", [tableName]);

  return rows.length > 0;
};

const getColumnNames = async (tableName) => {
  if (!(await tableExists(tableName))) return new Set();

  const [columns] = await pool.query(`SHOW COLUMNS FROM \`${tableName}\``);

  return new Set(columns.map((column) => column.Field));
};

module.exports = {
  getColumnNames,
  runSafeMigration,
  tableExists,
};
