// Boots the real backend entry point (app.js) as a child process against a
// disposable database so black-box tests exercise exactly what Passenger runs.
const { spawn } = require("node:child_process");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const BACKEND_DIR = path.join(__dirname, "..", "..");
const TEST_DB_PATTERN = /^pos_[a-z0-9_]*test[a-z0-9_]*$/;

const dbSettings = () => ({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
});

const assertTestDatabaseName = (database) => {
  if (!TEST_DB_PATTERN.test(database) || database === "pos_system") {
    throw new Error(`Refusing to use non-test database name: ${database}`);
  }
};

const dropTestDatabase = async (database) => {
  assertTestDatabaseName(database);
  const connection = await mysql.createConnection(dbSettings());
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
  } finally {
    await connection.end();
  }
};

const openTestPool = (database) => {
  assertTestDatabaseName(database);
  return mysql.createPool({
    ...dbSettings(),
    database,
    dateStrings: true,
    connectionLimit: 2,
  });
};

const startServer = ({ database, port, timeoutMs = 60000 }) =>
  new Promise((resolve, reject) => {
    assertTestDatabaseName(database);
    const output = [];
    const child = spawn(process.execPath, ["app.js"], {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        DB_NAME: database,
        PORT: String(port),
        HOST: "127.0.0.1",
        NODE_ENV: "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Server did not start in ${timeoutMs}ms:\n${output.join("")}`));
    }, timeoutMs);
    const onData = (chunk) => {
      const text = chunk.toString();
      output.push(text);
      if (text.includes("POS Server is listening")) {
        clearTimeout(timer);
        resolve({
          baseUrl: `http://127.0.0.1:${port}`,
          output,
          stop: () =>
            new Promise((done) => {
              // A killed child has signalCode set and exitCode null.
              if (child.exitCode !== null || child.signalCode !== null) return done();
              child.once("exit", () => done());
              child.kill();
            }),
        });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk) => output.push(chunk.toString()));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early (code ${code}):\n${output.join("")}`));
    });
  });

module.exports = {
  BACKEND_DIR,
  dropTestDatabase,
  openTestPool,
  startServer,
};
