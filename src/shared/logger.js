// Structured (JSON-lines) logging to stdout/stderr, collected by Passenger.
const write = (level, message, meta = {}) => {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...meta,
  });

  if (level === "error") console.error(line);
  else console.log(line);
};

module.exports = {
  error: (message, meta) => write("error", message, meta),
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
};
