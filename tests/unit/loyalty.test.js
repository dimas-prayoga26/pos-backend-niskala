// Set before config/env.js is loaded (dotenv never overrides these).
process.env.LOYALTY_API_URL = "http://loyalty.test/api/pos/";
process.env.LOYALTY_API_TOKEN = "unit-token";
process.env.LOYALTY_TIMEOUT_MS = "500";

const assert = require("node:assert/strict");
const { beforeEach, describe, it } = require("node:test");
const { LoyaltyRefusedError, LoyaltyUnavailableError } = require("../../src/modules/loyalty/loyalty.client");
const loyalty = require("../../src/modules/loyalty/loyalty.service");

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// A fetch that records its calls and answers with `reply`.
const fakeFetch = (reply) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    return typeof reply === "function" ? reply(url, init) : reply;
  };
  return { calls, deps: { fetchImpl } };
};

describe("loyalty client", () => {
  it("looks a customer up with the shared token, phone in the path", async () => {
    const { calls, deps } = fakeFetch(jsonResponse(200, { registered: false, phone: "6281234567890" }));

    const data = await loyalty.lookupCustomer(" +62 812-3456-7890 ", deps);

    assert.deepEqual(data, { registered: false, phone: "6281234567890" });
    assert.equal(calls[0].url, "http://loyalty.test/api/pos/customers/%2B62%20812-3456-7890");
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.headers.Authorization, "Bearer unit-token");
  });

  it("sends a stamp and a redemption with the cashier's POS user id", async () => {
    const { calls, deps } = fakeFetch(jsonResponse(201, { stamped: true }));

    await loyalty.stampOrder(41, 7, deps);
    await loyalty.redeemReward({ phone: "0812", rewardStamps: 5, cashierId: 7 }, deps);

    assert.equal(calls[0].url, "http://loyalty.test/api/pos/stamps");
    assert.deepEqual(calls[0].body, { order_id: 41, cashier_id: 7 });
    assert.equal(calls[1].url, "http://loyalty.test/api/pos/redemptions");
    assert.deepEqual(calls[1].body, { phone: "0812", reward_stamps: 5, cashier_id: 7 });
  });

  it("reads and changes Program Promo: the stamp card and its rewards", async () => {
    const program = { code: "stamp_card", active: true, rewards: [] };
    const { calls, deps } = fakeFetch(() => jsonResponse(200, program));

    assert.deepEqual(await loyalty.getProgram(deps), program);
    await loyalty.setProgramActive(false, deps);
    await loyalty.addReward({ stamps: 3, label: "Snack gratis", short: "" }, deps);
    await loyalty.updateReward(12, { active: false }, deps);

    assert.deepEqual(
      calls.map((call) => [call.init.method, call.url, call.body]),
      [
        ["GET", "http://loyalty.test/api/pos/program", undefined],
        ["PUT", "http://loyalty.test/api/pos/program", { active: false }],
        ["POST", "http://loyalty.test/api/pos/rewards", { stamps: 3, label: "Snack gratis" }],
        ["PUT", "http://loyalty.test/api/pos/rewards/12", { active: false }],
      ]
    );
  });

  it("reads the redemption and stamp histories page by page, searched by phone", async () => {
    const history = { data: [{ id: 3 }], meta: { page: 2, per_page: 10, total: 11, last_page: 2 } };
    const { calls, deps } = fakeFetch(() => jsonResponse(200, history));

    assert.deepEqual(await loyalty.listRedemptions({ page: 2, perPage: 10, q: " 0812 " }, deps), history);
    await loyalty.listRedemptions({}, deps);
    assert.deepEqual(await loyalty.listStamps({ page: 3, perPage: 5, q: "NSK" }, deps), history);
    await loyalty.listStamps(undefined, deps);

    assert.deepEqual(
      calls.map((call) => [call.init.method, call.url]),
      [
        ["GET", "http://loyalty.test/api/pos/redemptions?page=2&per_page=10&q=0812"],
        ["GET", "http://loyalty.test/api/pos/redemptions?page=1&per_page=20"],
        ["GET", "http://loyalty.test/api/pos/stamps?page=3&per_page=5&q=NSK"],
        ["GET", "http://loyalty.test/api/pos/stamps?page=1&per_page=20"],
      ]
    );
  });

  it("passes a rule refusal on with its message and reason", async () => {
    const { deps } = fakeFetch(
      jsonResponse(422, { message: "Minuman gratis belum bisa ditukar.", reason: "reward_not_ready" })
    );

    await assert.rejects(
      loyalty.redeemReward({ phone: "0812", rewardStamps: 5 }, deps),
      (error) =>
        error instanceof LoyaltyRefusedError &&
        error.statusCode === 422 &&
        error.reason === "reward_not_ready" &&
        error.message === "Minuman gratis belum bisa ditukar."
    );
  });

  it("treats a wrong token, a server error or no answer as unavailable", async () => {
    for (const reply of [
      jsonResponse(401, { message: "Token tidak valid." }),
      jsonResponse(500, {}),
      () => Promise.reject(new TypeError("fetch failed")),
    ]) {
      const { deps } = fakeFetch(reply);
      await assert.rejects(loyalty.lookupCustomer("0812", deps), LoyaltyUnavailableError);
    }
  });
});

describe("loyalty stamp after an order", () => {
  const order = { id: 9, orderType: "Offline", customerDetails: { phone: "0812-3456-7890" } };
  // A fetch answering /program with the stamp card on or off, /stamps with 201.
  const loyaltyApp = (active) =>
    fakeFetch((url) =>
      url.endsWith("/program") ? jsonResponse(200, { code: "stamp_card", active }) : jsonResponse(201, { stamped: true })
    );
  const urlsOf = (calls) => calls.map((call) => `${call.init.method} ${call.url.replace("http://loyalty.test/api/pos", "")}`);

  beforeEach(() => loyalty.forgetProgramState());

  it("asks for a stamp only for Offline orders with a phone", () => {
    assert.equal(loyalty.shouldStamp(order), true);
    assert.equal(loyalty.shouldStamp({ ...order, customerDetails: { phone: " " } }), false);
    assert.equal(loyalty.shouldStamp({ ...order, orderType: "Online" }), false);
    assert.equal(loyalty.shouldStamp({ ...order, orderType: "Crew" }), false);
  });

  it("never fails the order when loyalty is down", async () => {
    const { calls, deps } = fakeFetch(() => Promise.reject(new TypeError("fetch failed")));
    const originalLog = console.log;
    console.log = () => {};
    try {
      assert.equal(await loyalty.stampOrderInBackground(order, 3, deps), null);
    } finally {
      console.log = originalLog;
    }
    // The stamp card can't be read either: the stamp is still asked for.
    assert.deepEqual(urlsOf(calls), ["GET /program", "POST /stamps"]);
    assert.deepEqual(calls[1].body, { order_id: 9, cashier_id: 3 });

    const skipped = fakeFetch(jsonResponse(201, {}));
    assert.equal(await loyalty.stampOrderInBackground({ ...order, orderType: "Online" }, 3, skipped.deps), null);
    assert.equal(skipped.calls.length, 0);
  });

  it("sends no stamp while the stamp card is off in Program Promo", async () => {
    const { calls, deps } = loyaltyApp(false);

    assert.equal(await loyalty.stampOrderInBackground(order, 3, deps), null);
    assert.equal(await loyalty.stampOrderInBackground({ ...order, id: 10 }, 3, deps), null);

    // Read once, remembered for the next order; no stamp asked.
    assert.deepEqual(urlsOf(calls), ["GET /program"]);
  });

  it("stamps while the stamp card is on, reading it once", async () => {
    const { calls, deps } = loyaltyApp(true);

    assert.deepEqual(await loyalty.stampOrderInBackground(order, 3, deps), { stamped: true });
    await loyalty.stampOrderInBackground({ ...order, id: 10 }, 3, deps);

    assert.deepEqual(urlsOf(calls), ["GET /program", "POST /stamps", "POST /stamps"]);
  });

  it("follows the switch made in Program Promo without asking again", async () => {
    const { calls, deps } = loyaltyApp(false);

    await loyalty.setProgramActive(false, deps);
    await loyalty.stampOrderInBackground(order, 3, deps);

    assert.deepEqual(urlsOf(calls), ["PUT /program"]);
  });
});
