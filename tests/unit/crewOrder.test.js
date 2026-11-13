const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { isCrewMealOpen, toCrewOrder } = require("../../src/modules/orders/order.crew");

describe("konsumsi crew", () => {
  it("opens at 12:00 Jakarta time, until the end of the day", () => {
    assert.equal(isCrewMealOpen(new Date("2026-11-13T11:59:00+07:00"), 12), false);
    assert.equal(isCrewMealOpen(new Date("2026-11-13T12:00:00+07:00"), 12), true);
    assert.equal(isCrewMealOpen(new Date("2026-11-13T23:59:00+07:00"), 12), true);
    // 00:30 WIB is still the evening before in UTC.
    assert.equal(isCrewMealOpen(new Date("2026-11-14T00:30:00+07:00"), 12), false);
  });

  it("refuses a crew order before 12:00 or without a name, and makes it free", () => {
    const order = {
      orderType: "Crew",
      customerDetails: { name: " Budi ", phone: "0812" },
      paymentMethod: "Tunai",
      bills: { total: 15000, tax: 1500, totalWithTax: 16500 },
      items: [{ name: "Americano", quantity: 1, pricePerQuantity: 15000, price: 15000 }],
    };
    assert.throws(() => toCrewOrder(order, new Date("2026-11-13T11:00:00+07:00")), {
      status: 400,
      message: "Konsumsi Crew baru bisa mulai jam 12:00.",
    });
    const noon = new Date("2026-11-13T12:30:00+07:00");
    assert.throws(() => toCrewOrder({ ...order, customerDetails: { name: "Guest" } }, noon), {
      status: 400,
      message: "Isi nama crew.",
    });

    const crew = toCrewOrder(order, noon);
    assert.deepEqual(crew.customerDetails, { name: "Budi", phone: "" });
    assert.equal(crew.paymentMethod, "Crew");
    assert.deepEqual([crew.bills.total, crew.bills.tax, crew.bills.totalWithTax], [0, 0, 0]);
    assert.deepEqual(crew.items, [
      { name: "Americano", quantity: 1, pricePerQuantity: 15000, price: 0, discountPercent: 100 },
    ]);
  });
});
