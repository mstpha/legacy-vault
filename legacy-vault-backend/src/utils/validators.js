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

module.exports = { registerSchema, loginSchema, mfaTokenSchema, refreshSchema, validate };
