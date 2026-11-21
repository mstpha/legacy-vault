jest.mock("axios", () => {
  const transport = { request: jest.fn() };
  return {
    create: jest.fn(() => transport),
    isCancel: jest.fn(() => false),
    __transport: transport,
  };
});

jest.mock("../../src/config", () => ({
  HA_CONFIG: {
    maxRetriesPerServer: 2,
    retryBaseDelayMs: 1,
    retryAfterMaxTotalMs: 20000,
    requestTimeoutMs: 1000,
  },
}));

jest.mock("../../src/api/health", () => ({
  SERVERS: {
    primary: { apiUrl: "https://primary.example.test/api" },
    backup: { apiUrl: "https://backup.example.test/api" },
  },
  pickServer: jest.fn(async () => "primary"),
  markDown: jest.fn(),
  markUp: jest.fn(),
}));

const axios = require("axios");
const health = require("../../src/api/health");
const apiClient = require("../../src/api/client");
const client = apiClient.default;
const { setAuthHandlers } = apiClient;
const transport = axios.__transport;

describe("mobile API client resilience", () => {
  beforeEach(() => {
    transport.request.mockReset();
    health.pickServer.mockResolvedValue("primary");
    health.markDown.mockClear();
    health.markUp.mockClear();
    setAuthHandlers({
      getAccessToken: async () => "old-token",
      refreshTokens: async () => "new-token",
      onAuthFailure: jest.fn(),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("adds authorization and a stable idempotency key to successful writes", async () => {
    transport.request.mockResolvedValue({ data: { saved: true } });
    const response = await client.post("/capsules", { title: "Test" });
    const sent = transport.request.mock.calls[0][0];

    expect(response.data).toEqual({ saved: true });
    expect(sent.baseURL).toBe("https://primary.example.test/api");
    expect(sent.headers.Authorization).toBe("Bearer old-token");
    expect(sent.headers["Idempotency-Key"]).toBeTruthy();
  });

  it("refreshes once after 401 and replays the write with the same idempotency key", async () => {
    const unauthorized = Object.assign(new Error("unauthorized"), {
      response: { status: 401, headers: {} },
    });
    const refreshTokens = jest.fn(async () => "new-token");
    transport.request
      .mockRejectedValueOnce(unauthorized)
      .mockResolvedValueOnce({ data: { saved: true } });
    setAuthHandlers({ refreshTokens });

    await expect(client.post("/capsules", { title: "Test" })).resolves.toEqual({
      data: { saved: true },
    });
    const first = transport.request.mock.calls[0][0];
    const replay = transport.request.mock.calls[1][0];

    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(first.headers.Authorization).toBe("Bearer old-token");
    expect(replay.headers.Authorization).toBe("Bearer new-token");
    expect(replay.headers["Idempotency-Key"]).toBe(first.headers["Idempotency-Key"]);
  });

  it("fails over after transient primary failures without changing the write key", async () => {
    jest.useFakeTimers();
    const networkError = new Error("network unavailable");
    transport.request
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({ data: { accepted: true } });

    const pending = client.post("/capsules", { title: "Retry safely" });
    await jest.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ data: { accepted: true } });

    const requests = transport.request.mock.calls.map(([config]) => config);
    expect(requests.map((config) => config.baseURL)).toEqual([
      "https://primary.example.test/api",
      "https://primary.example.test/api",
      "https://primary.example.test/api",
      "https://backup.example.test/api",
    ]);
    expect(new Set(requests.map((config) => config.headers["Idempotency-Key"])).size).toBe(1);
    expect(health.markDown).toHaveBeenCalledTimes(3);
  });

  it("does not retry client errors", async () => {
    const badRequest = Object.assign(new Error("bad request"), {
      response: { status: 400, headers: {} },
    });
    transport.request.mockRejectedValueOnce(badRequest);

    await expect(client.get("/capsules")).rejects.toBe(badRequest);
    expect(transport.request).toHaveBeenCalledTimes(1);
    expect(health.markDown).not.toHaveBeenCalled();
  });
});
