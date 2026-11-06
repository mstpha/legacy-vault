// Pure tests of the tamper-evidence logic (no database needed).
jest.mock("../../src/config/db", () => ({}));
const { computeHash, checkRows, GENESIS } = require("../../src/services/audit.service");

function buildChain(entries) {
  const rows = [];
  let prevHash = GENESIS;
  entries.forEach((e, i) => {
    const createdAt = new Date(Date.UTC(2026, 9, 1, 12, 0, i));
    const row = { seq: i + 1, id: `id-${i + 1}`, userId: null, capsuleId: null, metadata: null, ...e, createdAt, prevHash };
    row.hash = computeHash(row);
    prevHash = row.hash;
    rows.push(row);
  });
  return rows;
}
const check = (rows) => checkRows(rows, { prevHash: GENESIS, checked: 0 });

describe("audit hash chain", () => {
  const entries = [
    { action: "CAPSULE_CREATED", userId: "u1", capsuleId: "c1", metadata: { type: "MESSAGE" } },
    { action: "CAPSULE_ACTIVATED", userId: "u1", capsuleId: "c1" },
    { action: "CAPSULE_UNLOCKED", userId: "u2", capsuleId: "c1", metadata: { received: 2, required: 2 } },
  ];

  it("accepts an untouched chain", () => {
    expect(check(buildChain(entries))).toBeNull();
  });

  it("hashes metadata independently of key order (jsonb does not keep it)", () => {
    const base = { prevHash: GENESIS, userId: "u", capsuleId: "c", action: "A", createdAt: new Date(0) };
    expect(computeHash({ ...base, metadata: { a: 1, b: { x: 1, y: 2 } } })).toBe(computeHash({ ...base, metadata: { b: { y: 2, x: 1 }, a: 1 } }));
  });

  it("detects a modified entry", () => {
    const rows = buildChain(entries);
    rows[1] = { ...rows[1], action: "CAPSULE_REVOKED" };
    expect(check(rows)).toEqual(expect.objectContaining({ seq: 2, reason: expect.stringMatching(/modified/i) }));
  });

  it("detects a modified metadata field", () => {
    const rows = buildChain(entries);
    rows[2] = { ...rows[2], metadata: { received: 1, required: 1 } };
    expect(check(rows)).toEqual(expect.objectContaining({ seq: 3 }));
  });

  it("detects a removed entry", () => {
    const rows = buildChain(entries);
    expect(check([rows[0], rows[2]])).toEqual(expect.objectContaining({ seq: 3, reason: expect.stringMatching(/link broken/i) }));
  });

  it("detects re-ordered entries", () => {
    const rows = buildChain(entries);
    expect(check([rows[1], rows[0], rows[2]])).not.toBeNull();
  });

  it("detects an entry inserted without a valid link", () => {
    const rows = buildChain(entries);
    const forged = { ...rows[0], seq: 99, id: "forged", action: "CAPSULE_UNLOCKED" };
    expect(check([rows[0], forged, rows[1]])).not.toBeNull();
  });
});
