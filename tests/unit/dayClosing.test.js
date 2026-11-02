const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { lastClosableDay } = require("../../src/modules/recaps/dayClosing");

describe("automatic day closing", () => {
  it("closes a business day at 00:00 (midnight), Jakarta time", () => {
    // 29 Oct, 23:59 WIB: the 29th is still open.
    assert.equal(lastClosableDay(new Date("2026-10-29T23:59:00+07:00")), "2026-10-28");
    assert.equal(lastClosableDay(new Date("2026-10-30T00:00:00+07:00")), "2026-10-29");
    assert.equal(lastClosableDay(new Date("2026-10-30T23:30:00+07:00")), "2026-10-29");
    // 00:30 WIB is still the previous day in UTC.
    assert.equal(lastClosableDay(new Date("2026-10-30T00:30:00+07:00")), "2026-10-29");
    // Across a month and a year end.
    assert.equal(lastClosableDay(new Date("2026-11-01T00:00:00+07:00")), "2026-10-31");
    assert.equal(lastClosableDay(new Date("2027-01-01T00:00:00+07:00")), "2026-12-31");
  });
});
