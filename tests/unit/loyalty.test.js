// Set before config/env.js is loaded (dotenv never overrides these).
process.env.LOYALTY_API_URL = "http://loyalty.test/api/pos/";
process.env.LOYALTY_API_TOKEN = "unit-token";
process.env.LOYALTY_TIMEOUT_MS = "500";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
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
    assert.deepEqual(calls[0].body, { order_id: 9, cashier_id: 3 });

    const skipped = fakeFetch(jsonResponse(201, {}));
    assert.equal(await loyalty.stampOrderInBackground({ ...order, orderType: "Online" }, 3, skipped.deps), null);
    assert.equal(skipped.calls.length, 0);
  });
});
