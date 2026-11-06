const { z } = require("zod");

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters."),
  fullName: z.string().min(2),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  mfaToken: z.string().length(6).optional(),
});

const mfaTokenSchema = z.object({
  token: z.string().length(6),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// --- Permissions ---
const setPermissionSchema = z.object({
  enabled: z.boolean(),
});

// --- Capsules (Sprint 2) ---
const capsuleTypeEnum = z.enum(["DOCUMENT", "CREDENTIAL", "MESSAGE", "IMAGE"]);

const createCapsuleSchema = z.object({
  title: z.string().min(1).max(200),
  type: capsuleTypeEnum,
});

const updateCapsuleSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  // Ciphertext produced client-side — see src/utils/encryption.js in the app.
  // Sent as a base64 string over JSON, stored as raw bytes in Postgres.
  encryptedContentBase64: z.string().min(1).optional(),
});

const thresholdsSchema = z.object({
  inactivityThresholdDays: z.number().int().min(1).max(3650),
  graceWindowDays: z.number().int().min(1).max(365),
  validationThreshold: z.number().int().min(1).max(20),
});

const addMemberSchema = z.object({
  email: z.string().email(),
});

const uploadFileSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  // Encrypted file bytes, base64-encoded (see app's src/utils/encryption.js).
  encryptedContentBase64: z.string().min(1),
});

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: { message: "Validation failed", details: result.error.flatten() },
      });
    }
    req.body = result.data;
    next();
  };
}

module.exports = {
  registerSchema,
  loginSchema,
  mfaTokenSchema,
  refreshSchema,
  validate,
  setPermissionSchema,
  createCapsuleSchema,
  updateCapsuleSchema,
  thresholdsSchema,
  addMemberSchema,
  uploadFileSchema,
};
