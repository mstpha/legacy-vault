import client from "./client";

// The signed-in user's own PUBLIC key (the private key never leaves the phone).
export const getMyKeyRequest = () => client.get("/keys/me").then((r) => r.data);
export const registerPublicKeyRequest = (publicKey) => client.put("/keys/me", { publicKey }).then((r) => r.data);
export const removeMyKeyRequest = () => client.delete("/keys/me");

// Owner: who can receive a sealed key for this capsule (with their public keys).
export const getKeyRecipientsRequest = (capsuleId) =>
  client.get(`/capsules/${capsuleId}/key-recipients`).then((r) => r.data);

// Owner: upload passphrases sealed to each recipient's key. shares = [{ userId, publicKey, wrappedKey }]
export const saveKeySharesRequest = (capsuleId, shares) =>
  client.put(`/capsules/${capsuleId}/key-shares`, { shares }).then((r) => r.data);

// Beneficiary: my sealed blob (only once the capsule is unlocked).
export const getSharedKeyRequest = (capsuleId) => client.get(`/capsules/${capsuleId}/shared/key`).then((r) => r.data);
