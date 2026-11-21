jest.mock("expo-crypto", () => {
  const crypto = require("crypto");
  return {
    getRandomBytes: (length) => Uint8Array.from(crypto.randomBytes(length)),
    getRandomBytesAsync: jest.fn(async (length) => Uint8Array.from(crypto.randomBytes(length))),
    randomUUID: () => crypto.randomUUID(),
  };
});
