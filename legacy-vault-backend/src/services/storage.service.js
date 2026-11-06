const crypto = require("crypto");
const { getSupabase } = require("../config/supabase");
const { ApiError } = require("../middleware/errorHandler");

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "capsule-files";

// `encryptedBuffer` must already be ciphertext — this service never sees plaintext,
// it just moves bytes. Path is namespaced by capsule so RLS/signed-URL policies on
// the bucket can be scoped per capsule if you choose to add them later.
async function uploadEncryptedFile(capsuleId, fileName, mimeType, encryptedBuffer) {
  const supabase = getSupabase();
  // The original name stays in capsule_files.fileName; the object key only gets a safe slug
  // (no slashes, "..", control characters) plus a random suffix so two uploads can never collide.
  const safeName = String(fileName).normalize("NFKD").replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_").slice(0, 100) || "file";
  const path = `${capsuleId}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${safeName}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, encryptedBuffer, {
    contentType: "application/octet-stream", // always octet-stream: it's ciphertext, not the original mimeType
    upsert: false,
  });

  if (error) throw new ApiError(502, `File upload failed: ${error.message}`);

  return { storagePath: path, originalMimeType: mimeType, sizeBytes: encryptedBuffer.length };
}

async function getSignedDownloadUrl(storagePath, expiresInSeconds = 300) {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw new ApiError(502, `Could not generate download link: ${error.message}`);
  return data.signedUrl;
}

// RM10: a revoked capsule's content must be "definitively erased" - that includes the encrypted attachments.
async function deleteFiles(storagePaths) {
  if (!storagePaths || storagePaths.length === 0) return;
  const supabase = getSupabase();
  const { error } = await supabase.storage.from(BUCKET).remove(storagePaths);
  if (error) throw new ApiError(502, `File deletion failed: ${error.message}`);
}

module.exports = { uploadEncryptedFile, getSignedDownloadUrl, deleteFiles };
