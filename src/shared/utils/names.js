// Bahan names in Title Case: "CABE MERAH BESAR" and "cabe merah besar" both
// become "Cabe Merah Besar". Per word: one with a digit (600ml, 1L) or typed in
// mixed case (MilkLife) stays as typed; SKM, UHT... stay capitals; a unit
// after a number (200 ml) and, after the first word, and/dan/of... stay lower
// case; the rest
// gets a capital first letter, also after a hyphen (Coca-Cola) or an opening
// bracket. scripts/rapikan-nama-bahan.sql applies the same rules in SQL.
const KEEP_UPPER = new Set(["SKM", "UHT", "MSG", "BBQ"]);
const UNITS = new Set(["ml", "gr", "kg", "mg", "oz", "pcs", "cc", "ltr"]);
const SMALL_WORDS = new Set(["and", "dan", "or", "atau", "with", "of"]);

const capitalize = (word) => {
  const lower = word.toLowerCase();
  const start = /^[("']/.test(lower) ? 1 : 0;
  const head = lower.slice(0, start) + lower.charAt(start).toUpperCase() + lower.slice(start + 1);
  return head.replace(/-(.)/g, (_, letter) => `-${letter.toUpperCase()}`);
};

const titleWord = (word, index, words) => {
  if (/\d/.test(word)) return word;
  const rest = word.slice(1);
  if (word !== word.toUpperCase() && rest !== rest.toLowerCase()) return word;
  if (KEEP_UPPER.has(word.toUpperCase())) return word.toUpperCase();
  const lower = word.toLowerCase();
  if (UNITS.has(lower) && /^[\d.,]+$/.test(words[index - 1] || "")) return lower;
  if (index > 0 && SMALL_WORDS.has(lower)) return lower;
  return capitalize(word);
};

const toTitleName = (value) =>
  String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(titleWord)
    .join(" ");

module.exports = { toTitleName };
