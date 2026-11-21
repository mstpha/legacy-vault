jest.mock("../../src/config/logger", () => ({
  error: jest.fn(),
  warn: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const { ApiError, errorHandler } = require("../../src/middleware/errorHandler");

function createErrorApp() {
  const app = express();
  app.get("/internal", (_req, _res, next) => next(new Error("database URL contains private details")));
  app.get("/database-down", (_req, _res, next) => {
    const error = new Error("private connection string");
    error.code = "P1001";
    next(error);
  });
  app.get("/bad-request", (_req, _res, next) => {
    next(new ApiError(400, "Invalid request", { fieldErrors: { email: ["Invalid email"] } }));
  });
  app.use(errorHandler);
  return app;
}

describe("HTTP error handling", () => {
  const app = createErrorApp();

  it("does not expose internal exception details", async () => {
    const response = await request(app).get("/internal");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { message: "Internal server error" } });
    expect(JSON.stringify(response.body)).not.toMatch(/database URL|private details/i);
  });

  it("maps database outages to a generic retryable 503", async () => {
    const response = await request(app).get("/database-down");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: { message: "Service temporarily unavailable.", code: "DB_UNAVAILABLE" },
    });
  });

  it("returns client validation details for a 4xx response", async () => {
    const response = await request(app).get("/bad-request");

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual(
      expect.objectContaining({
        message: "Invalid request",
        details: { fieldErrors: { email: ["Invalid email"] } },
      })
    );
  });
});
