// Konsumsi Crew: a crew member's meal on break (order type "Crew"), from
// 12:00 Jakarta time. The menus are free: stock and HPP go as for any sale,
// there is no income, and each line keeps its normal price as its discount
// (what was given), apart from Total Promo.
const createHttpError = require("http-errors");
const config = require("../../config/env");

const CREW_ORDER_TYPE = "Crew";

const jakartaHourOf = (date) =>
  Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: config.appTimeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date)
  );

const isCrewMealOpen = (now = new Date(), startHour = config.crewMealStartHour) =>
  jakartaHourOf(now) >= startHour;

// The order as it is saved: the crew member's name, Rp 0 to pay, every line
// 100% off.
const toCrewOrder = (orderData, now = new Date()) => {
  const startHour = config.crewMealStartHour;
  if (!isCrewMealOpen(now, startHour)) {
    throw createHttpError(
      400,
      `Konsumsi Crew baru bisa mulai jam ${String(startHour).padStart(2, "0")}:00.`
    );
  }

  const name = String(orderData.customerDetails?.name || "").trim();
  if (!name || name.toLowerCase() === "guest") {
    throw createHttpError(400, "Isi nama crew.");
  }

  return {
    ...orderData,
    orderType: CREW_ORDER_TYPE,
    customerDetails: { name, phone: "" },
    orderDate: undefined,
    orderPlatformId: null,
    orderPlatform: "",
    platformTax: 0,
    paymentMethod: CREW_ORDER_TYPE,
    cateringDetails: null,
    bills: {
      ...(orderData.bills || {}),
      total: 0,
      onlineOrderCharge: 0,
      tax: 0,
      totalWithTax: 0,
      dp: 0,
      remainingBalance: 0,
    },
    items: (orderData.items || []).map((item) => ({ ...item, discountPercent: 100, price: 0 })),
  };
};

module.exports = { CREW_ORDER_TYPE, isCrewMealOpen, toCrewOrder };
