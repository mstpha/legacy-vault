import client from "./client";

export const createCapsuleRequest = (payload) => client.post("/capsules", payload).then((r) => r.data.capsule);

export const listCapsulesRequest = () => client.get("/capsules").then((r) => r.data.capsules);

export const getCapsuleRequest = (id) => client.get(`/capsules/${id}`).then((r) => r.data.capsule);

export const getCapsuleContentRequest = (id) =>
  client.get(`/capsules/${id}/content`).then((r) => r.data.encryptedContentBase64);

export const updateCapsuleRequest = (id, payload) =>
  client.patch(`/capsules/${id}`, payload).then((r) => r.data.capsule);

export const deleteCapsuleRequest = (id) => client.delete(`/capsules/${id}`);

export const addGuarantorRequest = (id, email) =>
  client.post(`/capsules/${id}/guarantors`, { email }).then((r) => r.data.guarantor);

export const removeGuarantorRequest = (id, userId) => client.delete(`/capsules/${id}/guarantors/${userId}`);

export const addBeneficiaryRequest = (id, email) =>
  client.post(`/capsules/${id}/beneficiaries`, { email }).then((r) => r.data.beneficiary);

export const removeBeneficiaryRequest = (id, userId) => client.delete(`/capsules/${id}/beneficiaries/${userId}`);

export const setThresholdsRequest = (id, payload) =>
  client.put(`/capsules/${id}/thresholds`, payload).then((r) => r.data.capsule);

export const activateCapsuleRequest = (id) => client.post(`/capsules/${id}/activate`).then((r) => r.data.capsule);

export const revokeCapsuleRequest = (id) => client.post(`/capsules/${id}/revoke`).then((r) => r.data.capsule);

export const confirmActivityRequest = (id) =>
  client.post(`/capsules/${id}/confirm-activity`).then((r) => r.data.capsule);

export const attachFileRequest = (id, payload) =>
  client.post(`/capsules/${id}/files`, payload).then((r) => r.data.file);

// --- Guarantor / beneficiary side ---

export const getSharedCapsuleRequest = (id) => client.get(`/capsules/${id}/shared`).then((r) => r.data.capsule);

export const getSharedContentRequest = (id) =>
  client.get(`/capsules/${id}/shared/content`).then((r) => r.data.encryptedContentBase64);

export const validateCapsuleRequest = (id) => client.post(`/capsules/${id}/validate`).then((r) => r.data.result);

// The beneficiary's device confirms a successful decryption; the first confirmation archives the capsule.
export const confirmFirstReadRequest = (id) =>
  client.post(`/capsules/${id}/shared/confirm-read`).then((r) => r.data.result);

// Short-lived signed link to an attachment's ENCRYPTED bytes (resolves to { url, fileName, mimeType }).
export const getSharedFileRequest = (id, fileId) =>
  client.get(`/capsules/${id}/shared/files/${fileId}`).then((r) => r.data.file);
