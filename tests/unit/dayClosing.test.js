const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { lastClosableDay } = require("../../src/modules/recaps/dayClosing");

describe("automatic day closing", () => {
  it("closes a business day at 05:00 the next morning, Jakarta time", () => {
    // 30 Oct, 04:59 WIB: the 29th is still open (a late shift may record its Daily Prep).
    assert.equal(lastClosableDay(new Date("2026-10-30T04:59:00+07:00")), "2026-10-28");
    assert.equal(lastClosableDay(new Date("2026-10-30T05:00:00+07:00")), "2026-10-29");
    assert.equal(lastClosableDay(new Date("2026-10-30T23:30:00+07:00")), "2026-10-29");
    // Across a month and a year end.
    assert.equal(lastClosableDay(new Date("2026-11-01T06:00:00+07:00")), "2026-10-31");
    assert.equal(lastClosableDay(new Date("2027-01-01T05:00:00+07:00")), "2026-12-31");
  });
});
