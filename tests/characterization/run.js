#!/usr/bin/env node
// Characterization (golden master) test for the whole HTTP API.
//
//   node tests/characterization/run.js            compare against the baseline
//   node tests/characterization/run.js --update   record a new baseline
//
// Boots app.js on a disposable database, runs scenario.js, captures every
// response (status, contract headers, body), realtime events and the full
// database contents, restarts the server to capture boot-time migrations, and
// diffs the normalized result against __snapshots__/baseline.json.
const fs = require("node:fs");
const path = require("node:path");
const { io } = require("socket.io-client");
const scenario = require("./scenario");
const {
  BACKEND_DIR,
  dropTestDatabase,
  openTestPool,
  startServer,
} = require("../helpers/testServer");

const DATABASE = process.env.CHARACTERIZATION_DB || "pos_characterization_test";
const PORT = Number(process.env.CHARACTERIZATION_PORT) || 18731;
const SNAPSHOT_DIR = path.join(__dirname, "__snapshots__");
const BASELINE_FILE = path.join(SNAPSHOT_DIR, "baseline.json");
const CURRENT_FILE = path.join(SNAPSHOT_DIR, "current.json");
const UPLOAD_DIR = path.join(BACKEND_DIR, "uploads", "menu");
const UPDATE = process.argv.includes("--update");

const pad = (value) => String(value).padStart(2, "0");
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const YYMM = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}`;
const VOLATILE_KEYS = new Set(["createdAt", "updatedAt", "created_at", "updated_at", "timestamp"]);

const normalizeString = (value) =>
  value
    .replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, "<bcrypt>")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "<jwt>")
    .replace(/thermal-print\/[A-Za-z0-9_-]{20,}/g, "thermal-print/<token>")
    .replace(/http:\/\/127\.0\.0\.1:\d+/g, "<origin>")
    .replace(/Expires=[^;]+GMT/g, "Expires=<date>")
    .replace(/\/uploads\/menu\/\d{13}-/g, "/uploads/menu/<ts>-")
    .replace(/^[a-f0-9]{64}$/g, "<sha256>")
    .replace(new RegExp(`^${YYMM}-(\\d{4})$`), "<yymm>-$1")
    .replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, (match) =>
      match.startsWith(TODAY) ? "<now>" : match.replace(/\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/, "<time>")
    )
    .replace(new RegExp(TODAY, "g"), "<today>");

const normalize = (value) => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        VOLATILE_KEYS.has(key) && entry ? "<ts>" : normalize(entry),
      ])
    );
  }
  if (typeof value === "string") return normalizeString(value);
  return value;
};

const createApi = (baseUrl, record, socketEvents) => {
  const cookies = {};
  let pendingEvents = [];
  socketEvents.on = (event) => pendingEvents.push(event);

  const settleEvents = async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    const events = pendingEvents;
    pendingEvents = [];
    return events;
  };

  const send = async (name, method, urlPath, options, buildBody) => {
    const headers = { ...(options.headers || {}) };
    const cookie = options.cookie || (options.as && cookies[options.as]);
    if (cookie) headers.Cookie = cookie;
    const body = buildBody(headers);
    const response = await fetch(`${baseUrl}${urlPath}`, { method, headers, body });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text.length > 400 ? `${text.slice(0, 400)}…` : text;
    }
    const setCookie = response.headers.get("set-cookie");
    if (options.keepCookie && setCookie) {
      cookies[options.as] = setCookie.split(";")[0];
    }
    const result = { status: response.status, body: parsed };
    // GET /api/order sorts by created_at (1s resolution); ties come back in any
    // order, so compare in insertion order (id DESC) instead.
    if (method === "GET" && urlPath === "/api/order" && Array.isArray(parsed?.data)) {
      parsed = { ...parsed, data: [...parsed.data].sort((a, b) => b.id - a.id) };
    }
    record.push(
      normalize({
        step: name,
        request: `${method} ${urlPath}`,
        status: response.status,
        headers: {
          "content-type": response.headers.get("content-type"),
          "cache-control": response.headers.get("cache-control"),
          "x-robots-tag": response.headers.get("x-robots-tag"),
          "set-cookie": setCookie,
        },
        body: typeof parsed === "object" ? parsed : String(parsed),
        events: await settleEvents(),
      })
    );
    return result;
  };

  const call = (name, method, urlPath, options = {}) =>
    send(name, method, urlPath, options, (headers) => {
      if (options.rawBody !== undefined) return options.rawBody;
      if (options.body === undefined) return undefined;
      headers["Content-Type"] = "application/json";
      return JSON.stringify(options.body);
    });

  const upload = (name, urlPath, options) =>
    send(name, "POST", urlPath, options, () => {
      const form = new FormData();
      form.append("image", new Blob([options.data], { type: options.contentType }), options.fileName);
      return form;
    });

  return { call, upload };
};

const dumpDatabase = async () => {
  const db = openTestPool(DATABASE);
  try {
    const [tables] = await db.query(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name",
      [DATABASE]
    );
    const dump = {};
    for (const { name } of tables) {
      const [[createRow]] = await db.query(`SHOW CREATE TABLE \`${name}\``);
      const [rows] = await db.query(`SELECT * FROM \`${name}\` ORDER BY 1`);
      dump[name] = {
        ddl: createRow["Create Table"].replace(/ AUTO_INCREMENT=\d+/, ""),
        rows: normalize(rows),
      };
    }
    return dump;
  } finally {
    await db.end();
  }
};

const connectSocket = (baseUrl, sink) =>
  new Promise((resolve, reject) => {
    const socket = io(baseUrl, { transports: ["polling"], reconnection: false });
    socket.onAny((event, payload) => {
      const { timestamp, ...rest } = payload || {};
      sink.on({ event, payload: rest, hasTimestamp: Boolean(timestamp) });
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });

const listUploads = () => new Set(fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR) : []);

const diff = (expected, actual, at = "$", out = []) => {
  if (out.length >= 40) return out;
  if (typeof expected !== typeof actual || Array.isArray(expected) !== Array.isArray(actual)) {
    out.push(`${at}: expected ${JSON.stringify(expected)?.slice(0, 200)} got ${JSON.stringify(actual)?.slice(0, 200)}`);
    return out;
  }
  if (expected && typeof expected === "object") {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) {
      if (!(key in actual)) out.push(`${at}.${key}: missing`);
      else if (!(key in expected)) out.push(`${at}.${key}: unexpected ${JSON.stringify(actual[key])?.slice(0, 200)}`);
      else diff(expected[key], actual[key], `${at}.${key}`, out);
    }
    return out;
  }
  if (expected !== actual) {
    out.push(`${at}: expected ${JSON.stringify(expected)?.slice(0, 200)} got ${JSON.stringify(actual)?.slice(0, 200)}`);
  }
  return out;
};

const main = async () => {
  const uploadsBefore = listUploads();
  const steps = [];
  const sink = {};
  let server;
  let socket;

  await dropTestDatabase(DATABASE);
  try {
    server = await startServer({ database: DATABASE, port: PORT });
    socket = await connectSocket(server.baseUrl, sink);
    await scenario(createApi(server.baseUrl, steps, sink));
    socket.close();
    socket = null;
    const afterScenario = await dumpDatabase();
    await server.stop();

    // Second boot: captures what startup migrations/seeds do to existing data.
    server = await startServer({ database: DATABASE, port: PORT });
    await server.stop();
    server = null;
    const afterRestart = await dumpDatabase();

    const snapshot = { steps, database: { afterScenario, afterRestart } };
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(CURRENT_FILE, `${JSON.stringify(snapshot, null, 1)}\n`);

    if (UPDATE || !fs.existsSync(BASELINE_FILE)) {
      fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(snapshot, null, 1)}\n`);
      console.log(`Baseline recorded: ${steps.length} steps, ${Object.keys(afterScenario).length} tables.`);
      return;
    }

    const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
    const differences = diff(baseline, JSON.parse(JSON.stringify(snapshot)));
    if (differences.length) {
      console.error(`FAIL: ${differences.length}${differences.length >= 40 ? "+" : ""} difference(s) from baseline`);
      differences.forEach((line) => console.error(`  ${line}`));
      process.exitCode = 1;
      return;
    }
    console.log(`PASS: ${steps.length} steps and ${Object.keys(afterScenario).length} tables match the baseline.`);
  } finally {
    if (socket) socket.close();
    if (server) await server.stop();
    for (const file of listUploads()) {
      if (!uploadsBefore.has(file)) fs.unlinkSync(path.join(UPLOAD_DIR, file));
    }
    await dropTestDatabase(DATABASE);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
