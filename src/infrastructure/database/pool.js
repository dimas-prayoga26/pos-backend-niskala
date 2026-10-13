const mysql = require("mysql2/promise");
const config = require("../../config/env");

const pool = mysql.createPool({
  host: config.dbHost,
  port: config.dbPort,
  user: config.dbUser,
  password: config.dbPassword,
  database: config.dbName,
  timezone: config.dbTimeZone,
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});

const serverPool = mysql.createPool({
  host: config.dbHost,
  port: config.dbPort,
  user: config.dbUser,
  password: config.dbPassword,
  timezone: config.dbTimeZone,
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 2,
});

const applyConnectionTimeZone = (connection) => {
  connection.query(`SET time_zone = '${config.dbTimeZone}'`);
};

pool.on("connection", applyConnectionTimeZone);
serverPool.on("connection", applyConnectionTimeZone);

// Runs fn(connection) inside a transaction on a dedicated pool connection.
const withTransaction = async (fn) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { pool, serverPool, withTransaction };
