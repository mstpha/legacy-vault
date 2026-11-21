module.exports = {
  ...require("./package.json").jest,
  testMatch: ["<rootDir>/tests/performance/**/*.test.js"],
};
