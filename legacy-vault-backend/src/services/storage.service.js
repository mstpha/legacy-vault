const { getSupabase } = require("../config/supabase");
const { ApiError } = require("../middleware/errorHandler");

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "capsule-files";

// `encryptedBuffer` must already be ciphertext — this service never sees plaintext,
// it just moves bytes. Path is namespaced by capsule so RLS/signed-URL policies on
// the bucket can be scoped per capsule if you choose to add them later.
async function uploadEncryptedFile(capsuleId, fileName, mimeType, encryptedBuffer) {
  const supabase = getSupabase();
  const path = `${capsuleId}/${Date.now()}-${fileName}`;

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

module.exports = { uploadEncryptedFile, getSignedDownloadUrl };
