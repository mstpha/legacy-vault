import React, { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator, ScrollView } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  getSharedCapsuleRequest,
  getSharedContentRequest,
  validateCapsuleRequest,
  confirmFirstReadRequest,
  getSharedFileRequest,
} from "../api/capsule.api";
import { decryptText, decryptToBase64 } from "../utils/encryption";
import { readViaFetch } from "../utils/readFile";

const STATE_LABELS = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  INACTIVITY_ALERT: "Inactivity alert",
  PENDING_VALIDATION: "Pending validation",
  UNLOCKED: "Unlocked",
  ARCHIVED: "Opened",
  REVOKED: "Revoked",
};

const STATE_COLORS = {
  DRAFT: "#64748b",
  ACTIVE: "#16a34a",
  INACTIVITY_ALERT: "#d97706",
  PENDING_VALIDATION: "#6366f1",
  UNLOCKED: "#0ea5e9",
  ARCHIVED: "#64748b",
  REVOKED: "#ef4444",
};

const paint = () => new Promise((resolve) => setTimeout(resolve, 60)); // lets the spinner render before a heavy decrypt

function statusMessage(capsule) {
  const owner = capsule.testatorName || "The owner";
  switch (capsule.state) {
    case "DRAFT":
      return `${owner} is still setting this capsule up.`;
    case "ACTIVE":
      return `${owner} is being monitored for inactivity. You'll be notified if anything needs your attention.`;
    case "INACTIVITY_ALERT":
      return `${owner} has been inactive and was asked to confirm they're still active. Nothing is needed from you yet.`;
    case "PENDING_VALIDATION":
      return `${owner} didn't respond to the inactivity alert. Guarantors are being asked to validate before the capsule can be unlocked.`;
    case "UNLOCKED":
    case "ARCHIVED":
      return "This capsule has been unlocked.";
    case "REVOKED":
      return `${owner} revoked this capsule. Its content has been erased.`;
    default:
      return "";
  }
}

export default function SharedCapsuleScreen({ route, navigation }) {
  const { capsuleId } = route.params;
  const [capsule, setCapsule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);

  const [passphrase, setPassphrase] = useState("");
  const [blob, setBlob] = useState(null);
  const [opening, setOpening] = useState(false);
  const [content, setContent] = useState(null);
  const [fileBusyId, setFileBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      setCapsule(await getSharedCapsuleRequest(capsuleId));
    } catch (err) {
      Alert.alert("Error", err.response?.data?.error?.message || "Could not load this capsule.");
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [capsuleId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading || !capsule) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const { roles } = capsule;
  const unlocked = ["UNLOCKED", "ARCHIVED"].includes(capsule.state);
  const owner = capsule.testatorName || "the owner";
  const hasFiles = capsule.files.length > 0;

  // ---- guarantor: validation ----
  const submitValidation = async () => {
    if (validating) return;
    setValidating(true);
    try {
      const result = await validateCapsuleRequest(capsuleId);
      Alert.alert(
        result.unlocked ? "Capsule unlocked" : "Validation recorded",
        result.unlocked
          ? "Enough guarantors have validated. The beneficiaries have been notified."
          : `${result.validationsReceived} of ${result.validationThreshold} validations received.`
      );
      await load();
    } catch (err) {
      Alert.alert("Could not validate", err.response?.data?.error?.message || "Something went wrong.");
    } finally {
      setValidating(false);
    }
  };

  const onValidate = () =>
    Alert.alert(
      "Validate this capsule?",
      `Only validate if you can confirm that ${owner} is unable to manage this capsule. This can't be undone, and when enough guarantors validate, the capsule unlocks for the beneficiaries.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "I confirm, validate", style: "destructive", onPress: submitValidation },
      ]
    );

  // ---- beneficiary: read-only access ----
  // Tells the server the content was decrypted successfully. The FIRST confirmation archives
  // the capsule ("Opened"); after that you can still read it as often as you like.
  const confirmRead = () => confirmFirstReadRequest(capsuleId).then(load).catch(() => {});

  const onOpenText = async () => {
    if (opening) return;
    setOpening(true);
    try {
      let encrypted = blob;
      if (!encrypted) {
        try {
          encrypted = await getSharedContentRequest(capsuleId);
        } catch (err) {
          Alert.alert("Can't open", err.response?.data?.error?.message || "Could not fetch the content.");
          return;
        }
        if (!encrypted) {
          Alert.alert("No text content", "The owner didn't store any text in this capsule.");
          return;
        }
        setBlob(encrypted);
      }

      await paint();
      try {
        setContent(decryptText(encrypted, passphrase));
        confirmRead();
      } catch (err) {
        Alert.alert("Could not decrypt", "Wrong passphrase, or the content is corrupted.");
      }
    } finally {
      setOpening(false);
    }
  };

  // Downloads the ENCRYPTED file, decrypts it on this device, then hands it to the share sheet
  // (open / save to Files / send to another app).
  const onOpenFile = async (file) => {
    if (fileBusyId) return;
    if (!passphrase) return Alert.alert("Passphrase needed", "Enter the passphrase above first.");
    setFileBusyId(file.id);
    try {
      const { url } = await getSharedFileRequest(capsuleId, file.id);
      const encrypted = await readViaFetch(url);
      await paint();

      const base64 = decryptToBase64(encrypted, passphrase);
      if (!base64) throw new Error("empty result");

      const safeName = file.fileName.replace(/[^\w.\- ]/g, "_");
      const uri = `${FileSystem.cacheDirectory}${safeName}`;
      await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
      confirmRead();

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: file.mimeType });
      } else {
        Alert.alert("Decrypted", "The file was decrypted, but sharing isn't available on this device.");
      }
    } catch (err) {
      Alert.alert(
        "Could not open the file",
        err.response?.data?.error?.message || "Wrong passphrase, or the file is corrupted."
      );
    } finally {
      setFileBusyId(null);
    }
  };

  const guarantorHint = capsule.hasValidated
    ? "You've validated this capsule."
    : unlocked
    ? "This capsule is already unlocked."
    : capsule.state === "REVOKED"
    ? "Nothing more is needed from you."
    : "Nothing is needed from you right now. You'll be notified if the owner stays inactive and validation is required.";

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{capsule.title}</Text>
      <Text style={styles.owner}>Owner: {capsule.testatorName}</Text>

      <View style={styles.pillRow}>
        <View style={[styles.statePill, { backgroundColor: STATE_COLORS[capsule.state] || "#64748b" }]}>
          <Text style={styles.statePillText}>{STATE_LABELS[capsule.state] || capsule.state}</Text>
        </View>
        {roles.guarantor && (
          <View style={styles.rolePill}>
            <Text style={styles.rolePillText}>Guarantor</Text>
          </View>
        )}
        {roles.beneficiary && (
          <View style={styles.rolePill}>
            <Text style={styles.rolePillText}>Beneficiary</Text>
          </View>
        )}
      </View>

      <Text style={styles.status}>{statusMessage(capsule)}</Text>

      {roles.guarantor && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>As guarantor</Text>
          {capsule.state === "PENDING_VALIDATION" ? (
            <>
              <Text style={styles.body}>
                {capsule.validationsReceived} of {capsule.validationThreshold} validations received.
              </Text>
              {capsule.hasValidated ? (
                <Text style={styles.done}>✓ You've validated this capsule.</Text>
              ) : (
                <Pressable style={[styles.primary, validating && styles.dimmed]} onPress={onValidate} disabled={validating}>
                  {validating ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Validate capsule</Text>}
                </Pressable>
              )}
            </>
          ) : (
            <Text style={styles.body}>{guarantorHint}</Text>
          )}
        </View>
      )}

      {roles.beneficiary && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>As beneficiary</Text>

          {!unlocked ? (
            <Text style={styles.body}>
              {capsule.state === "REVOKED"
                ? "This capsule was revoked, so there is nothing to open."
                : "This capsule is locked. You'll be notified as soon as it's unlocked."}
            </Text>
          ) : !capsule.hasContent && !hasFiles ? (
            <Text style={styles.body}>This capsule has no content.</Text>
          ) : (
            <>
              <Text style={styles.hint}>
                Read-only. You can open this as often as you like. The content is encrypted: enter the passphrase{" "}
                {owner} gave you, and it's decrypted on this device only.
              </Text>
              <View style={styles.row}>
                <TextInput
                  style={styles.input}
                  placeholder="Passphrase"
                  secureTextEntry
                  value={passphrase}
                  onChangeText={setPassphrase}
                  editable={!opening && !fileBusyId}
                />
                {capsule.hasContent && (
                  <Pressable
                    style={[styles.openButton, (!passphrase || opening) && styles.dimmed]}
                    onPress={onOpenText}
                    disabled={!passphrase || opening}
                  >
                    {opening ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Open</Text>}
                  </Pressable>
                )}
              </View>
              {opening && <Text style={styles.hint}>Decrypting… this can take a few seconds.</Text>}
              {content !== null && <Text style={styles.content}>{content}</Text>}

              {hasFiles && (
                <View style={styles.files}>
                  <Text style={styles.filesTitle}>Attached files</Text>
                  {capsule.files.map((f) => (
                    <View key={f.id} style={styles.fileRow}>
                      <Text style={styles.fileName} numberOfLines={1}>
                        📎 {f.fileName}
                      </Text>
                      <Pressable
                        style={[styles.fileButton, fileBusyId && styles.dimmed]}
                        onPress={() => onOpenFile(f)}
                        disabled={!!fileBusyId}
                      >
                        {fileBusyId === f.id ? <ActivityIndicator size="small" color="#0f172a" /> : <Text style={styles.fileButtonText}>Open</Text>}
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { padding: 24, backgroundColor: "#fff", flexGrow: 1 },
  title: { fontSize: 22, fontWeight: "700", color: "#0f172a" },
  owner: { fontSize: 13, color: "#64748b", marginTop: 4 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  statePill: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 12 },
  statePillText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  rolePill: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 12, backgroundColor: "#f1f5f9" },
  rolePillText: { color: "#334155", fontSize: 12, fontWeight: "600" },
  status: { fontSize: 14, color: "#475569", lineHeight: 21, marginTop: 16 },
  section: { marginTop: 28 },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: "#374151", textTransform: "uppercase", marginBottom: 8 },
  body: { fontSize: 14, color: "#475569", lineHeight: 21 },
  hint: { fontSize: 12, color: "#94a3b8", marginBottom: 8, lineHeight: 18 },
  done: { fontSize: 15, fontWeight: "600", color: "#16a34a", marginTop: 10 },
  primary: { backgroundColor: "#0f172a", borderRadius: 10, padding: 14, alignItems: "center", marginTop: 12 },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  dimmed: { opacity: 0.6 },
  row: { flexDirection: "row", gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, padding: 10 },
  openButton: { backgroundColor: "#0f172a", borderRadius: 8, paddingHorizontal: 18, justifyContent: "center", alignItems: "center", minWidth: 72 },
  content: { marginTop: 14, backgroundColor: "#f3f4f6", borderRadius: 8, padding: 12, fontSize: 14, lineHeight: 21 },
  files: { marginTop: 20 },
  filesTitle: { fontSize: 12, fontWeight: "700", color: "#64748b", marginBottom: 6 },
  fileRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 },
  fileName: { flex: 1, fontSize: 14, marginRight: 10 },
  fileButton: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 16, minWidth: 64, alignItems: "center" },
  fileButtonText: { color: "#0f172a", fontSize: 13, fontWeight: "600" },
});
