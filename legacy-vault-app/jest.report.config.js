module.exports = {
  ...require("./package.json").jest,
  testMatch: [
    "<rootDir>/tests/unit/**/*.test.js",
    "<rootDir>/tests/performance/**/*.test.js",
  ],
};
