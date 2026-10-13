// Order codes are YYMM-NNNN with a sequence that restarts every month.
const MONTHLY_ORDER_CODE_PATTERN = "^[0-9]{4}-[0-9]{4}$";

const padOrderCodePart = (value, length) => String(value).padStart(length, "0");

const formatMonthlyOrderCode = ({ sequence, month, year }) =>
  `${padOrderCodePart(year, 2)}${padOrderCodePart(month, 2)}-${padOrderCodePart(sequence, 4)}`;

module.exports = { MONTHLY_ORDER_CODE_PATTERN, formatMonthlyOrderCode };
