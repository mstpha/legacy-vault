import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator, ScrollView } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { createCapsuleRequest, updateCapsuleRequest, attachFileRequest } from "../api/capsule.api";
import { checkBlockedPermission } from "../api/permissionCheck.api";
import { createEncryptor } from "../utils/encryption";
import { readAsBase64, formatSize } from "../utils/readFile";

const TYPES = ["DOCUMENT", "CREDENTIAL", "MESSAGE", "IMAGE"];
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB file ≈ 6.7 MB request; server limit is 10mb
const MAX_IMAGE_WIDTH = 1600; // images are downscaled to this width before encryption
const frame = () => new Promise((resolve) => setTimeout(resolve, 30)); // lets React paint before heavy work
const tooLarge = () => Alert.alert("File too large", `Please choose a file under ${formatSize(MAX_FILE_BYTES)}.`);

// Each picker resolves to { name, mimeType, base64, size }, or a falsy value if cancelled / not allowed.
export default function CapsuleCreateScreen({ navigation }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("DOCUMENT");
  const [content, setContent] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [status, setStatus] = useState(""); // non-empty = busy, and says what we're doing
  const [blockedMessage, setBlockedMessage] = useState(null);

  // Warn as soon as the screen opens if creating capsules is currently disabled.
  useEffect(() => {
    checkBlockedPermission("TESTATOR", ["capsule.create"]).then(setBlockedMessage);
  }, []);

  const busy = !!status;
  const needsPassphrase = content.trim().length > 0 || attachments.length > 0;
  const canSubmit = !busy && title.trim().length > 0 && (!needsPassphrase || passphrase.length >= 8);

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: "*/*" });
    if (result.canceled) return null;
    const a = result.assets[0];
    if (a.size > MAX_FILE_BYTES) return tooLarge();
    setStatus("Preparing file…");
    const base64 = await readAsBase64(a.uri); // read now, while the cached copy exists
    return { name: a.name, mimeType: a.mimeType || "application/octet-stream", base64, size: a.size };
  };

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert("Permission needed", "Allow photo library access to attach an image.");
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    if (result.canceled) return null;
    const a = result.assets[0];
    setStatus("Preparing file…");
    // Resize + recompress natively (fast): phone photos shrink from MBs to a few hundred KB.
    const resize = a.width > MAX_IMAGE_WIDTH ? [{ resize: { width: MAX_IMAGE_WIDTH } }] : [];
    const { base64 } = await ImageManipulator.manipulateAsync(a.uri, resize, {
      compress: 0.7,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });
    const size = Math.round((base64.length * 3) / 4);
    if (size > MAX_FILE_BYTES) return tooLarge();
    const base = (a.fileName || a.uri.split("/").pop() || `image-${Date.now()}`).replace(/\.[^.]+$/, "");
    return { name: `${base}.jpg`, mimeType: "image/jpeg", base64, size };
  };

  const addAttachment = async (pick) => {
    if (busy) return;
    try {
      const file = await pick();
      if (file) setAttachments((prev) => [...prev, { id: `${Date.now()}`, ...file }]);
    } catch (err) {
      console.error("Could not read file:", err);
      Alert.alert("Error", "Could not read that file. Try another one.");
    } finally {
      setStatus("");
    }
  };

  const onSubmit = async () => {
    if (!canSubmit) return;
    try {
      // 0) Ask the server first whether everything we're about to do is allowed (before slow work).
      setStatus("Checking permissions…");
      const required = ["capsule.create"];
      if (content.trim()) required.push("capsule.edit_draft");
      if (attachments.length) required.push("capsule.upload_file");
      const blocked = await checkBlockedPermission("TESTATOR", required);
      setBlockedMessage(blocked);
      if (blocked) return Alert.alert("Not allowed", blocked);

      // 1) Encrypt EVERYTHING on-device first, so a failure leaves nothing behind on the server.
      let encryptedContentBase64 = null;
      const files = [];
      if (needsPassphrase) {
        setStatus("Preparing encryption… (a few seconds)");
        await frame();
        const enc = await createEncryptor(passphrase); // key derived ONCE, reused for everything
        if (content.trim()) {
          setStatus("Encrypting content…");
          encryptedContentBase64 = await enc.encryptText(content.trim());
        }
        for (const [i, a] of attachments.entries()) {
          const label = `Encrypting file ${i + 1} of ${attachments.length}…`;
          setStatus(label);
          const encrypted = await enc.encryptBase64(a.base64, (p) => setStatus(`${label} ${Math.round(p * 100)}%`));
          files.push({ fileName: a.name, mimeType: a.mimeType, encryptedContentBase64: encrypted });
        }
      }

      // 2) Create the capsule, then 3) upload content + files in parallel.
      setStatus("Creating capsule…");
      const capsule = await createCapsuleRequest({ title: title.trim(), type });
      setStatus("Uploading…");
      await Promise.all([
        ...(encryptedContentBase64 ? [updateCapsuleRequest(capsule.id, { encryptedContentBase64 })] : []),
        ...files.map((f) => attachFileRequest(capsule.id, f)),
      ]);

      navigation.replace("CapsuleDetail", { capsuleId: capsule.id });
    } catch (err) {
      console.error("Capsule creation failed:", err.response?.data || err.message || err);
      const offline = err.request && !err.response;
      Alert.alert(
        "Error",
        err.response?.data?.error?.message ||
          (offline ? "Network error — is the backend reachable?" : "Could not create the capsule.")
      );
    } finally {
      setStatus("");
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {blockedMessage && (
        <View style={styles.blockedBanner}>
          <Text style={styles.blockedText}>{blockedMessage}</Text>
        </View>
      )}

      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Bank accounts + crypto wallet"
        value={title}
        onChangeText={setTitle}
        editable={!busy}
      />

      <Text style={styles.label}>Type</Text>
      <View style={styles.typeRow}>
        {TYPES.map((t) => (
          <Pressable key={t} style={[styles.chip, type === t && styles.chipActive]} onPress={() => setType(t)} disabled={busy}>
            <Text style={[styles.chipText, type === t && styles.chipTextActive]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Content (optional — can also be added later)</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        placeholder="Credentials, a message, notes about where to find a document..."
        multiline
        value={content}
        onChangeText={setContent}
        editable={!busy}
      />

      <Text style={styles.label}>Attachments (optional, max {formatSize(MAX_FILE_BYTES)} each)</Text>
      <View style={styles.attachRow}>
        {[["📄 Add a document", pickDocument], ["🖼️ Add an image", pickImage]].map(([label, pick]) => (
          <Pressable key={label} style={[styles.attachButton, busy && styles.dim]} onPress={() => addAttachment(pick)} disabled={busy}>
            <Text style={styles.attachButtonText}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {attachments.map((a) => (
        <View key={a.id} style={styles.attachment}>
          <Text style={styles.attachmentName} numberOfLines={1}>{`${a.name}  ·  ${formatSize(a.size)}`}</Text>
          <Pressable onPress={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))} disabled={busy}>
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        </View>
      ))}

      {needsPassphrase && (
        <>
          <Text style={styles.label}>Encryption passphrase</Text>
          <Text style={styles.hint}>
            Required to encrypt this content and any attachments. You'll need to remember it to read everything back
            later — it is never sent to or stored on the server.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="A strong passphrase (min. 8 characters)"
            secureTextEntry
            value={passphrase}
            onChangeText={setPassphrase}
            editable={!busy}
          />
        </>
      )}

      {busy ? (
        <View style={styles.statusBox}>
          <ActivityIndicator color="#0f172a" />
          <Text style={styles.statusText}>{status}</Text>
        </View>
      ) : (
        <Pressable style={[styles.button, !canSubmit && styles.dim]} onPress={onSubmit} disabled={!canSubmit}>
          <Text style={styles.buttonText}>Create capsule</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, backgroundColor: "#fff", flexGrow: 1 },
  label: { fontSize: 13, fontWeight: "700", color: "#374151", marginTop: 16, marginBottom: 6 },
  hint: { fontSize: 12, color: "#999", marginBottom: 8 },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, padding: 14, fontSize: 16 },
  multiline: { minHeight: 100, textAlignVertical: "top" },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  chipActive: { backgroundColor: "#0f172a", borderColor: "#0f172a" },
  chipText: { fontSize: 13, color: "#374151" },
  chipTextActive: { color: "#fff" },
  attachRow: { flexDirection: "row", gap: 8 },
  attachButton: { flex: 1, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, padding: 12, alignItems: "center" },
  attachButtonText: { fontSize: 13, color: "#374151", fontWeight: "600" },
  attachment: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#f3f4f6", borderRadius: 8, padding: 10, marginTop: 8 },
  attachmentName: { flex: 1, fontSize: 13, marginRight: 8 },
  removeText: { color: "#ef4444", fontSize: 13 },
  blockedBanner: { backgroundColor: "#fef2f2", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#fecaca" },
  blockedText: { color: "#b91c1c", fontSize: 13, lineHeight: 19 },
  button: { backgroundColor: "#0f172a", borderRadius: 10, padding: 14, alignItems: "center", marginTop: 28 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  dim: { opacity: 0.5 },
  statusBox: { alignItems: "center", marginTop: 28, gap: 10 },
  statusText: { fontSize: 14, color: "#374151" },
});