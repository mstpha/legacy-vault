jest.mock("../../src/config/db", () => ({}));
const { computeHash, checkRows, GENESIS } = require("../../src/services/audit.service");

function buildChain(entries) {
  const rows = [];
  let prevHash = GENESIS;
  entries.forEach((entry, index) => {
    const row = {
      seq: index + 1,
      id: `id-${index + 1}`,
      userId: null,
      capsuleId: null,
      metadata: null,
      ...entry,
      createdAt: new Date(Date.UTC(2026, 9, 1, 12, 0, index)),
      prevHash,
    };
    row.hash = computeHash(row);
    prevHash = row.hash;
    rows.push(row);
  });
  return rows;
}

const entries = [
  { action: "CAPSULE_CREATED", userId: "u1", capsuleId: "c1", metadata: { type: "MESSAGE" } },
  { action: "CAPSULE_ACTIVATED", userId: "u1", capsuleId: "c1" },
  { action: "CAPSULE_UNLOCKED", userId: "u2", capsuleId: "c1", metadata: { received: 2, required: 2 } },
];
const check = (rows) => checkRows(rows, { prevHash: GENESIS, checked: 0 });

describe("audit hash chain", () => {
  it("accepts an untouched chain and hashes metadata independently of key order", () => {
    expect(check(buildChain(entries))).toBeNull();
    const base = {
      prevHash: GENESIS,
      userId: "u",
      capsuleId: "c",
      action: "A",
      createdAt: new Date(0),
    };
    expect(computeHash({ ...base, metadata: { a: 1, b: { x: 1, y: 2 } } })).toBe(
      computeHash({ ...base, metadata: { b: { y: 2, x: 1 }, a: 1 } })
    );
  });

  it("detects altered, removed, reordered, and forged entries", () => {
    const altered = buildChain(entries);
    altered[1] = { ...altered[1], action: "CAPSULE_REVOKED" };
    expect(check(altered)).toEqual(expect.objectContaining({ seq: 2 }));

    const removed = buildChain(entries);
    expect(check([removed[0], removed[2]])).toEqual(expect.objectContaining({ seq: 3 }));

    const reordered = buildChain(entries);
    expect(check([reordered[1], reordered[0], reordered[2]])).not.toBeNull();

    const forged = buildChain(entries);
    forged.splice(1, 0, { ...forged[0], seq: 99, id: "forged", action: "CAPSULE_UNLOCKED" });
    expect(check(forged)).not.toBeNull();
  });

  it("detects metadata tampering", () => {
    const rows = buildChain(entries);
    rows[2] = { ...rows[2], metadata: { received: 1, required: 1 } };
    expect(check(rows)).toEqual(expect.objectContaining({ seq: 3 }));
  });
});
