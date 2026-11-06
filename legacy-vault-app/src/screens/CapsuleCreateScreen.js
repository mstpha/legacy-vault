import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { createCapsuleRequest, updateCapsuleRequest, attachFileRequest } from "../api/capsule.api";
import { checkBlockedPermission } from "../api/permissionCheck.api";
import { createEncryptor } from "../utils/encryption";
import { readAsBase64, formatSize } from "../utils/readFile";
import { Card, Field, Button, Banner, IconBadge, ActionBar } from "../components/ui";
import { colors, radius, TYPE_ICONS } from "../theme";

const TYPES = ["DOCUMENT", "CREDENTIAL", "MESSAGE", "IMAGE"];
const TYPE_HINTS = {
  DOCUMENT: "Wills, deeds, files",
  CREDENTIAL: "Passwords, accounts",
  MESSAGE: "A letter to loved ones",
  IMAGE: "Photos & scans",
};
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
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {blockedMessage && (
          <Banner tone="danger" icon="lock-closed" title="Creating capsules is disabled">
            {blockedMessage}
          </Banner>
        )}

        <Step n={1} title="Name & type" />
        <Card>
          <Field
            label="Title"
            icon="pricetag-outline"
            placeholder="e.g. Bank accounts + crypto wallet"
            value={title}
            onChangeText={setTitle}
            editable={!busy}
          />
          <Text style={styles.label}>What are you storing?</Text>
          <View style={styles.typeGrid}>
            {TYPES.map((t) => {
              const active = type === t;
              return (
                <Pressable
                  key={t}
                  style={({ pressed }) => [styles.typeTile, active && styles.typeTileActive, pressed && styles.pressed]}
                  onPress={() => setType(t)}
                  disabled={busy}
                >
                  <View style={[styles.typeIcon, active && styles.typeIconActive]}>
                    <Ionicons name={TYPE_ICONS[t]} size={18} color={active ? "#fff" : colors.indigo} />
                  </View>
                  <View style={styles.typeBody}>
                    <Text style={[styles.typeText, active && styles.typeTextActive]}>{t.charAt(0) + t.slice(1).toLowerCase()}</Text>
                    <Text style={[styles.typeHint, active && styles.typeHintActive]} numberOfLines={1}>
                      {TYPE_HINTS[t]}
                    </Text>
                  </View>
                  {active && <Ionicons name="checkmark-circle" size={18} color="#fff" style={styles.typeCheck} />}
                </Pressable>
              );
            })}
          </View>
        </Card>

        <Step n={2} title="Secret content" optional />
        <Card>
          <Field
            placeholder="Credentials, a message, notes about where to find a document..."
            multiline
            value={content}
            onChangeText={setContent}
            editable={!busy}
            inputStyle={styles.multiline}
            hint="You can also add or change this later, while the capsule is a draft."
            style={styles.noMargin}
          />
        </Card>

        <Step n={3} title="Attachments" optional />
        <Card>
          <View style={styles.attachRow}>
            {[
              ["Document", "document-attach-outline", pickDocument],
              ["Image", "image-outline", pickImage],
            ].map(([label, icon, pick]) => (
              <Pressable
                key={label}
                style={({ pressed }) => [styles.attachButton, busy && styles.dim, pressed && styles.pressed]}
                onPress={() => addAttachment(pick)}
                disabled={busy}
              >
                <View style={styles.attachIcon}>
                  <Ionicons name={icon} size={20} color={colors.indigo} />
                </View>
                <Text style={styles.attachButtonText}>Add {label.toLowerCase()}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>Max {formatSize(MAX_FILE_BYTES)} per file · encrypted before upload</Text>

          {attachments.map((a) => (
            <View key={a.id} style={styles.attachment}>
              <IconBadge
                name={a.mimeType.startsWith("image/") ? "image" : "document"}
                color={colors.indigo}
                soft
                size={36}
                iconSize={17}
              />
              <View style={styles.attachmentBody}>
                <Text style={styles.attachmentName} numberOfLines={1}>
                  {a.name}
                </Text>
                <Text style={styles.attachmentSize}>{formatSize(a.size)}</Text>
              </View>
              <Pressable onPress={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))} disabled={busy} hitSlop={10}>
                <Ionicons name="close-circle" size={22} color={colors.ghost} />
              </Pressable>
            </View>
          ))}
        </Card>

        {needsPassphrase && (
          <>
            <Step n={4} title="Encryption passphrase" />
            <Card>
              <Field
                placeholder="A strong passphrase (min. 8 characters)"
                icon="key-outline"
                secureTextEntry
                value={passphrase}
                onChangeText={setPassphrase}
                editable={!busy}
              />
              <Banner tone="action" icon="information-circle" style={styles.noMargin}>
                Remember it: you'll need it to read everything back. It's never sent to or stored on the server.
              </Banner>
            </Card>
          </>
        )}
      </ScrollView>

      <ActionBar>
        {busy ? (
          <View style={styles.statusBox}>
            <ActivityIndicator color={colors.ink} />
            <Text style={styles.statusText} numberOfLines={1}>
              {status}
            </Text>
          </View>
        ) : (
          <Button title="Create capsule" icon="lock-closed" onPress={onSubmit} disabled={!canSubmit} style={styles.flex} />
        )}
      </ActionBar>
    </View>
  );
}

function Step({ n, title, optional }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{n}</Text>
      </View>
      <Text style={styles.stepTitle}>{title}</Text>
      {optional && <Text style={styles.optional}>Optional</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  container: { padding: 20, paddingTop: 8, paddingBottom: 32 },
  flex: { flex: 1 },
  label: { fontSize: 13, fontWeight: "700", color: colors.text, marginBottom: 8 },
  hint: { fontSize: 12, color: colors.faint, marginTop: 10, textAlign: "center" },
  noMargin: { marginBottom: 0 },
  multiline: { minHeight: 120, textAlignVertical: "top" },
  dim: { opacity: 0.5 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },

  step: { flexDirection: "row", alignItems: "center", marginTop: 10, marginBottom: 10 },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  stepNumberText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  stepTitle: { flex: 1, fontSize: 15, fontWeight: "800", color: colors.ink },
  optional: { fontSize: 11.5, fontWeight: "700", color: colors.faint },

  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeTile: {
    width: "48.5%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: radius.md + 2,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.canvas,
  },
  typeTileActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  typeIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: colors.indigoSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  typeIconActive: { backgroundColor: "rgba(255,255,255,0.14)" },
  typeBody: { flex: 1, marginLeft: 10 },
  typeText: { fontSize: 13.5, fontWeight: "800", color: colors.ink },
  typeTextActive: { color: "#fff" },
  typeHint: { fontSize: 11, color: colors.muted, marginTop: 1 },
  typeHintActive: { color: colors.ghost },
  typeCheck: { marginLeft: 4 },

  attachRow: { flexDirection: "row", gap: 10 },
  attachButton: {
    flex: 1,
    alignItems: "center",
    gap: 8,
    paddingVertical: 18,
    borderRadius: radius.md + 2,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.indigoLine,
    backgroundColor: "#f8f9ff",
  },
  attachIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: colors.indigoSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  attachButtonText: { fontSize: 13, color: colors.indigoInk, fontWeight: "800" },
  attachment: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.md,
    padding: 10,
    marginTop: 10,
  },
  attachmentBody: { flex: 1, marginHorizontal: 10 },
  attachmentName: { fontSize: 13.5, fontWeight: "700", color: colors.ink },
  attachmentSize: { fontSize: 11.5, color: colors.faint, marginTop: 1 },

  statusBox: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, minHeight: 52 },
  statusText: { fontSize: 14, color: colors.text, fontWeight: "700", flexShrink: 1 },
});
