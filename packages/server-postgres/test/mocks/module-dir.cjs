// CJS stand-in for src/module-dir.ts, which uses import.meta.url. Resolves to
// src/ so path walking behaves the same as it does in the real module.
const path = require("path");

module.exports = { moduleDir: path.join(__dirname, "..", "..", "src") };
