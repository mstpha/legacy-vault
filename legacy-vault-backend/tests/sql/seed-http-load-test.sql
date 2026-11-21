-- Paste this whole script into pgAdmin's Query Tool while connected to the
-- disposable local database named legacy_vault_test.
-- Change these two values to the same credentials used by load:http.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $seed$
DECLARE
  test_email text := 'load-test@example.test';
  test_password text := 'LoadTestOnly-2026!';
BEGIN
  IF current_database() !~* 'test' THEN
    RAISE EXCEPTION 'Refusing to seed non-test database: %', current_database();
  END IF;

  INSERT INTO public.role_permissions ("id", "role", "permission", "label", "enabled", "updatedAt")
  VALUES
    (gen_random_uuid()::text, 'TESTATOR'::"Role", 'capsule.create', 'Create a capsule', true, now()),
    (gen_random_uuid()::text, 'TESTATOR'::"Role", 'capsule.edit_draft', 'Edit a draft capsule', true, now()),
    (gen_random_uuid()::text, 'TESTATOR'::"Role", 'capsule.delete_draft', 'Delete a draft capsule', true, now()),
    (gen_random_uuid()::text, 'TESTATOR'::"Role", 'capsule.manage_members', 'Assign guarantors / beneficiaries', true, now()),
    (gen_random_uuid()::text, 'TESTATOR'::"Role", 'capsule.manage_thresholds', 'Set inactivity delay & validation threshold', true, now()),
    (gen_random_uuid()::text, 'TESTATOR'::"Role", 'capsule.activate', 'Activate a capsule (Draft -> Active)', true, now()),
    (gen_random_uuid()::text, 'TESTATOR'::"Role", 'capsule.revoke', 'Revoke a capsule', true, now()),
    (gen_random_uuid()::text, 'TESTATOR'::"Role", 'capsule.confirm_activity', 'Confirm activity during a grace window', true, now()),
    (gen_random_uuid()::text, 'TESTATOR'::"Role", 'capsule.upload_file', 'Attach an encrypted file to a capsule', true, now()),
    (gen_random_uuid()::text, 'GUARANTOR'::"Role", 'capsule.view_assigned', 'View capsules they guarantee (status only)', true, now()),
    (gen_random_uuid()::text, 'GUARANTOR'::"Role", 'validation.submit', 'Submit a validation vote', true, now()),
    (gen_random_uuid()::text, 'BENEFICIARY'::"Role", 'capsule.view_unlocked', 'View an unlocked capsule content', true, now())
  ON CONFLICT ("role", "permission") DO UPDATE
  SET "label" = EXCLUDED."label",
      "enabled" = true,
      "updatedAt" = now();

  INSERT INTO public.users (
    "id",
    "email",
    "passwordHash",
    "fullName",
    "mfaEnabled",
    "role",
    "lastSeenAt",
    "createdAt",
    "updatedAt",
    "emailVerified",
    "emailVerificationAttempts"
  )
  VALUES (
    gen_random_uuid()::text,
    test_email,
    crypt(test_password, gen_salt('bf', 12)),
    'HTTP Load Test',
    false,
    'TESTATOR'::"Role",
    now(),
    now(),
    now(),
    true,
    0
  )
  ON CONFLICT ("email") DO UPDATE
  SET "passwordHash" = EXCLUDED."passwordHash",
      "fullName" = EXCLUDED."fullName",
      "mfaEnabled" = false,
      "mfaSecret" = NULL,
      "role" = 'TESTATOR'::"Role",
      "lastSeenAt" = now(),
      "updatedAt" = now(),
      "emailVerified" = true,
      "emailVerificationCodeHash" = NULL,
      "emailVerificationExpiresAt" = NULL,
      "emailVerificationAttempts" = 0;

  RAISE NOTICE 'HTTP load test account is ready: %', test_email;
END
$seed$;
