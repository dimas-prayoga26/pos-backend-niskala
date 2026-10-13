const isDuplicateEntryError = (error) => error?.code === "ER_DUP_ENTRY";

module.exports = { isDuplicateEntryError };
