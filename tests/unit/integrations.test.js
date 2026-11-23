// Set before config/env.js is loaded (dotenv never overrides these).
process.env.LOYALTY_API_URL = "http://env-loyalty.test/api/pos";
process.env.LOYALTY_API_TOKEN = "env-token";
process.env.JWT_SECRET = process.env.JWT_SECRET || "unit-jwt-secret";

const assert = require("node:assert/strict");
const { beforeEach, describe, it } = require("node:test");
const { open, seal } = require("../../src/shared/utils/secretBox");
const repository = require("../../src/modules/integrations/integration.repository");
const integrations = require("../../src/modules/integrations/integration.service");
const client = require("../../src/modules/loyalty/loyalty.client");

// An in-memory api_integrations.
let rows;
repository.findByCode = async (code) => rows.get(code) || null;
repository.upsert = async (code, fields) => {
  const saved = rows.get(code) || {};
  rows.set(code, {
    ...saved,
    code,
    base_url: fields.baseUrl,
    api_key_sealed: fields.apiKeySealed === undefined ? saved.api_key_sealed ?? null : fields.apiKeySealed,
    api_key_hint: fields.apiKeySealed === undefined ? saved.api_key_hint ?? null : fields.apiKeyHint,
    is_active: fields.isActive ? 1 : 0,
    updated_by: fields.updatedBy,
  });
};
const loyaltyRow = (overrides = {}) => ({
  code: "loyalty",
  base_url: "https://loyalty.test/api/pos",
  api_key_sealed: seal("saved-key-1234"),
  api_key_hint: "1234",
  is_active: 1,
  ...overrides,
});

describe("secretBox", () => {
  it("seals a key that only the same secret opens", () => {
    const sealed = seal("rahasia", "secret-a");

    assert.notEqual(sealed, "rahasia");
    assert.ok(!sealed.includes("rahasia"));
    assert.equal(open(sealed, "secret-a"), "rahasia");
    assert.equal(open(sealed, "secret-b"), null);
    assert.equal(open(`${sealed.slice(0, -2)}AA`, "secret-a"), null);
    assert.equal(open("", "secret-a"), null);
  });
});

describe("API Management: loyalty", () => {
  beforeEach(() => {
    rows = new Map();
    integrations.forgetCache();
  });

  it("uses .env until the row exists, then the row (off or without a key: no loyalty)", async () => {
    assert.deepEqual(await integrations.loyaltyConnection(), {
      apiUrl: "http://env-loyalty.test/api/pos",
      apiToken: "env-token",
    });

    rows.set("loyalty", loyaltyRow());
    integrations.forgetCache();
    assert.deepEqual(await integrations.loyaltyConnection(), {
      apiUrl: "https://loyalty.test/api/pos",
      apiToken: "saved-key-1234",
    });
    assert.equal(await integrations.isLoyaltyEnabled(), true);

    for (const row of [
      loyaltyRow({ is_active: 0 }),
      loyaltyRow({ api_key_sealed: null }),
      loyaltyRow({ api_key_sealed: seal("other", "another-secret") }),
    ]) {
      rows.set("loyalty", row);
      integrations.forgetCache();
      assert.deepEqual(await integrations.loyaltyConnection(), {});
      assert.equal(await integrations.isLoyaltyEnabled(), false);
    }
  });

  it("never shows the key, only its last 4 characters", async () => {
    rows.set("loyalty", loyaltyRow());

    const [view] = await integrations.list();

    assert.deepEqual(
      { ...view, updatedAt: undefined },
      {
        code: "loyalty",
        name: "Loyalty (Stamp Card)",
        baseUrl: "https://loyalty.test/api/pos",
        hasKey: true,
        keyHint: "1234",
        keyUnreadable: false,
        isActive: true,
        updatedAt: undefined,
      }
    );
    assert.ok(!JSON.stringify(view).includes("saved-key"));
  });

  it("saves a URL and a key (sealed), keeps the key when none is typed, and removes it with null", async () => {
    const saved = await integrations.update(
      "loyalty",
      { baseUrl: " https://loyalty.test/api/pos/ ", apiKey: " new-key-9876 ", isActive: true },
      7
    );
    assert.equal(saved.baseUrl, "https://loyalty.test/api/pos");
    assert.equal(saved.keyHint, "9876");
    assert.equal(open(rows.get("loyalty").api_key_sealed), "new-key-9876");
    assert.equal(rows.get("loyalty").updated_by, 7);
    assert.deepEqual(await integrations.loyaltyConnection(), {
      apiUrl: "https://loyalty.test/api/pos",
      apiToken: "new-key-9876",
    });

    await integrations.update("loyalty", { baseUrl: "https://other.test/api/pos", apiKey: "", isActive: true }, 7);
    assert.equal(open(rows.get("loyalty").api_key_sealed), "new-key-9876");

    const removed = await integrations.update("loyalty", { baseUrl: "https://other.test/api/pos", apiKey: null }, 7);
    assert.equal(removed.hasKey, false);
    assert.equal(await integrations.isLoyaltyEnabled(), false);
  });

  it("refuses a bad URL, a missing key and an unknown integration", async () => {
    await assert.rejects(integrations.update("loyalty", { baseUrl: "loyalty.test", apiKey: "k" }), /http/);
    await assert.rejects(integrations.update("loyalty", { baseUrl: "", apiKey: "k" }), /URL API wajib/);
    await assert.rejects(integrations.update("loyalty", { baseUrl: "https://loyalty.test" }), /API key wajib/);
    await assert.rejects(integrations.update("pusher", { baseUrl: "https://x.test", apiKey: "k" }), /tidak ditemukan/);
    // Switched off, nothing is required.
    await integrations.update("loyalty", { baseUrl: "", isActive: false });
    assert.equal(rows.get("loyalty").is_active, 0);
  });

  it("tests the typed values, a key left empty being the saved one", async () => {
    rows.set("loyalty", loyaltyRow());
    const calls = [];
    const request = async (method, path, body, { connection }) => {
      calls.push([method, path, connection]);
      return { data: { name: "Stamp Card" } };
    };

    assert.deepEqual(await integrations.test("loyalty", { baseUrl: "https://typed.test/api/pos/" }, { request }), {
      ok: true,
      message: "Tersambung: Stamp Card.",
    });
    assert.deepEqual(calls, [
      ["GET", "/program", { apiUrl: "https://typed.test/api/pos", apiToken: "saved-key-1234" }],
    ]);

    const failing = async () => {
      throw new Error("Loyalty membalas 401.");
    };
    assert.deepEqual(await integrations.test("loyalty", { apiKey: "wrong" }, { request: failing }), {
      ok: false,
      message: "Tidak tersambung: Loyalty membalas 401.",
    });

    rows.clear();
    assert.equal((await integrations.test("loyalty", { baseUrl: "https://typed.test" })).ok, false);
  });
});

describe("loyalty client connection", () => {
  it("calls with what API Management gives, and not at all without a key", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push([url, init.headers.Authorization]);
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    };

    client.setConnectionResolver(async () => ({ apiUrl: "https://db.test/api/pos/", apiToken: "db-key" }));
    await client.request("GET", "/program", undefined, { fetchImpl });
    assert.deepEqual(calls, [["https://db.test/api/pos/program", "Bearer db-key"]]);
    assert.equal(await client.isConfigured(), true);

    client.setConnectionResolver(async () => ({}));
    assert.equal(await client.isConfigured(), false);
    await assert.rejects(client.request("GET", "/program", undefined, { fetchImpl }), /belum dikonfigurasi/);
    assert.equal(calls.length, 1);

    // Tes koneksi: the values given, whatever is saved.
    await client.request("GET", "/program", undefined, {
      fetchImpl,
      connection: { apiUrl: "https://typed.test/api/pos", apiToken: "typed" },
    });
    assert.deepEqual(calls[1], ["https://typed.test/api/pos/program", "Bearer typed"]);
  });
});
