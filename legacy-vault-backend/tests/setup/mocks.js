// Runs after the Jest framework is installed (jest `setupFilesAfterEnv`), so jest.mock is available.
// External services are replaced; the database is REAL on purpose (this is end-to-end).
jest.setTimeout(60000);
// Outgoing email: captured in memory so tests can read verification codes and notification mails.
jest.mock("../../src/config/mailer", () => {
  const sent = [];
  return {
    sendEmail: jest.fn(async (message) => {
      sent.push(message);
      return { sent: true };
    }),
    __sent: sent,
  };
});

// Supabase Storage: no network. Files are "uploaded" to nowhere and signed URLs are fake.
jest.mock("../../src/services/storage.service", () => ({
  uploadEncryptedFile: jest.fn(async (capsuleId, fileName, mimeType, buffer) => ({
    storagePath: `${capsuleId}/mock-${fileName}`,
    originalMimeType: mimeType,
    sizeBytes: buffer.length,
  })),
  getSignedDownloadUrl: jest.fn(async (storagePath) => `https://storage.test/${storagePath}`),
  deleteFiles: jest.fn(async () => undefined),
}));

// Redis is only needed by /health/ready (the BullMQ worker is never started in tests).
jest.mock("../../src/config/redis", () => ({
  ping: jest.fn(async () => "PONG"),
}));
