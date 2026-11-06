import React, { useCallback, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
import { getSharedKeyRequest } from "../api/keys.api";
import { decryptText, decryptToBase64 } from "../utils/encryption";
import { confirmSensitive } from "../utils/biometricLock";
import { openWithDeviceKey } from "../utils/deviceKeys";
import { useAuth } from "../context/AuthContext";
import { readViaFetch } from "../utils/readFile";
import { Card, Field, Button, Banner, IconBadge, Loading, Hero, HeroPills, HeroPill, Lifecycle, ProgressBar, Divider } from "../components/ui";
import { colors, radius, STATE_LABELS, STATE_COLORS } from "../theme";

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

  const { user } = useAuth();
  const [deviceBusy, setDeviceBusy] = useState(false);
  const decryptedFiles = useRef([]); // decrypted copies written to the cache: deleted when the screen is left

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

  // Don't leave decrypted text, the passphrase or decrypted files behind once the screen is left.
  useFocusEffect(
    useCallback(
      () => () => {
        setContent(null);
        setPassphrase("");
        setBlob(null);
        decryptedFiles.current.forEach((uri) => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}));
        decryptedFiles.current = [];
      },
      []
    )
  );

  if (loading || !capsule) return <Loading />;

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
        {
          text: "I confirm, validate",
          style: "destructive",
          onPress: async () => {
            if (await confirmSensitive(user.id, "Confirm your validation")) submitValidation();
          },
        },
      ]
    );

  // ---- beneficiary: read-only access ----
  // Tells the server the content was decrypted successfully. The FIRST confirmation archives
  // the capsule ("Opened"); after that you can still read it as often as you like.
  const confirmRead = () => confirmFirstReadRequest(capsuleId).then(load).catch(() => {});

  const onOpenText = async (pp = passphrase, alreadyAuthenticated = false) => {
    if (opening) return;
    if (!alreadyAuthenticated && !(await confirmSensitive(user.id, "Confirm to open this capsule"))) return;
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
        setContent(decryptText(encrypted, pp));
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
  const onOpenFile = async (file, pp = passphrase, alreadyAuthenticated = false) => {
    if (fileBusyId) return;
    if (!pp) return Alert.alert("Passphrase needed", "Enter the passphrase above, or unlock with your device key.");
    if (!alreadyAuthenticated && !(await confirmSensitive(user.id, "Confirm to open this file"))) return;
    setFileBusyId(file.id);
    try {
      const { url } = await getSharedFileRequest(capsuleId, file.id);
      const encrypted = await readViaFetch(url);
      await paint();

      const base64 = decryptToBase64(encrypted, pp);
      if (!base64) throw new Error("empty result");

      const safeName = file.fileName.replace(/[^\w.\- ]/g, "_");
      const uri = `${FileSystem.cacheDirectory}${safeName}`;
      await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
      decryptedFiles.current.push(uri);
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

  // Opens the sealed passphrase with THIS phone's private key (the biometric prompt appears here).
  const onUnlockWithDevice = async () => {
    if (deviceBusy || opening) return;
    setDeviceBusy(true);
    try {
      const { wrappedKey } = await getSharedKeyRequest(capsuleId);
      const unsealed = await openWithDeviceKey(user.id, wrappedKey, "Unlock this capsule with your device key");
      setPassphrase(unsealed);
      if (capsule.hasContent) await onOpenText(unsealed, true);
      else Alert.alert("Unlocked", "Your device key worked. Tap Open next to a file to decrypt it.");
    } catch (err) {
      if (err.code === "AUTH_CANCELLED") return;
      const reasons = {
        KEY_MISSING: "This phone has no device key. Create one under Device security, or enter the passphrase instead.",
        KEY_UNREADABLE: "This phone's device key can't be read (biometrics may have changed). Enter the passphrase instead.",
        WRONG_KEY: "The key shared with you doesn't match this phone's key. Ask the owner to share again, or enter the passphrase.",
      };
      Alert.alert("Device key didn't work", reasons[err.code] || err.response?.data?.error?.message || "Enter the passphrase instead.");
    } finally {
      setDeviceBusy(false);
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
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {/* --- Hero --- */}
      <Hero
        icon={unlocked ? "lock-open" : capsule.state === "REVOKED" ? "ban" : "lock-closed"}
        eyebrow={`From ${capsule.testatorName || "—"}`}
        title={capsule.title}
        subtitle={statusMessage(capsule)}
      >
        <HeroPills>
          <HeroPill label={STATE_LABELS[capsule.state] || capsule.state} dot={STATE_COLORS[capsule.state]} />
          {roles.guarantor && <HeroPill label="You're a guarantor" icon="shield-checkmark" />}
          {roles.beneficiary && <HeroPill label="You're a beneficiary" icon="gift" />}
        </HeroPills>
      </Hero>

      {capsule.state !== "REVOKED" && (
        <Card style={styles.lifeCard}>
          <Lifecycle state={capsule.state} />
        </Card>
      )}

      {roles.guarantor && (
        <Card>
          <SectionHead icon="shield-checkmark" color={colors.indigo} title="As guarantor" subtitle="You confirm when the owner can't" />
          {capsule.state === "PENDING_VALIDATION" ? (
            <>
              <View style={styles.progressHead}>
                <Text style={styles.body}>Validations received</Text>
                <Text style={styles.progressCount}>
                  {capsule.validationsReceived} / {capsule.validationThreshold}
                </Text>
              </View>
              <ProgressBar
                value={capsule.validationsReceived / Math.max(1, capsule.validationThreshold)}
                track={colors.indigoSoft}
                height={8}
                style={styles.progress}
              />
              {capsule.hasValidated ? (
                <Banner tone="success" style={styles.doneBanner}>
                  You've validated this capsule.
                </Banner>
              ) : (
                <Button title="Validate capsule" icon="checkmark-done-circle" onPress={onValidate} loading={validating} style={styles.primary} />
              )}
            </>
          ) : (
            <View style={styles.infoBox}>
              <Ionicons name={capsule.hasValidated ? "checkmark-circle" : "time-outline"} size={20} color={capsule.hasValidated ? colors.green : colors.faint} />
              <Text style={styles.infoText}>{guarantorHint}</Text>
            </View>
          )}
        </Card>
      )}

      {roles.beneficiary && (
        <Card>
          <SectionHead icon="gift" color={colors.sky} title="As beneficiary" subtitle="Read-only, as often as you like" />

          {!unlocked ? (
            <View style={styles.lockedBox}>
              <View style={styles.lockedIcon}>
                <Ionicons name={capsule.state === "REVOKED" ? "ban-outline" : "lock-closed"} size={26} color={colors.faint} />
              </View>
              <Text style={styles.lockedTitle}>{capsule.state === "REVOKED" ? "Nothing to open" : "Still locked"}</Text>
              <Text style={styles.lockedText}>
                {capsule.state === "REVOKED"
                  ? "This capsule was revoked, so there is nothing to open."
                  : "This capsule is locked. You'll be notified as soon as it's unlocked."}
              </Text>
            </View>
          ) : !capsule.hasContent && !hasFiles ? (
            <Text style={styles.body}>This capsule has no content.</Text>
          ) : (
            <>
              {capsule.hasKeyShare && (
                <>
                  <Pressable
                    onPress={onUnlockWithDevice}
                    disabled={deviceBusy || opening}
                    style={({ pressed }) => [styles.deviceUnlock, (deviceBusy || opening) && styles.dim, pressed && styles.pressed]}
                  >
                    <View style={styles.deviceIcon}>
                      {deviceBusy ? <ActivityIndicator color="#fff" /> : <Ionicons name="finger-print" size={26} color="#fff" />}
                    </View>
                    <View style={styles.deviceBody}>
                      <Text style={styles.deviceTitle}>Unlock with this device</Text>
                      <Text style={styles.deviceText}>Use your fingerprint, face or PIN</Text>
                    </View>
                    <Ionicons name="arrow-forward" size={18} color="#fff" />
                  </Pressable>
                  <Divider label="or enter the passphrase" />
                </>
              )}
              <Text style={styles.hint}>
                Enter the passphrase {owner} gave you. It's decrypted on this device only.
              </Text>
              <View style={styles.row}>
                <Field
                  placeholder="Passphrase"
                  icon="key-outline"
                  secureTextEntry
                  value={passphrase}
                  onChangeText={setPassphrase}
                  editable={!opening && !fileBusyId}
                  style={styles.rowField}
                />
                {capsule.hasContent && (
                  <Button
                    title="Open"
                    icon="eye"
                    compact
                    onPress={() => onOpenText()}
                    disabled={!passphrase}
                    loading={opening}
                    style={styles.openButton}
                  />
                )}
              </View>
              {opening && <Text style={styles.hint}>Decrypting… this can take a few seconds.</Text>}
              {content !== null && (
                <View style={styles.content}>
                  <View style={styles.contentHead}>
                    <Ionicons name="lock-open" size={13} color={colors.greenInk} />
                    <Text style={styles.contentLabel}>Decrypted on this device</Text>
                  </View>
                  <Text selectable style={styles.contentText}>
                    {content}
                  </Text>
                </View>
              )}

              {hasFiles && (
                <View style={styles.files}>
                  <Text style={styles.filesTitle}>Attached files</Text>
                  {capsule.files.map((f, i) => (
                    <View key={f.id} style={[styles.fileRow, i === capsule.files.length - 1 && styles.lastRow]}>
                      <IconBadge name="document" color={colors.indigo} soft size={36} iconSize={17} />
                      <Text style={styles.fileName} numberOfLines={1}>
                        {f.fileName}
                      </Text>
                      <Button
                        title="Open"
                        variant="secondary"
                        compact
                        onPress={() => onOpenFile(f)}
                        disabled={!!fileBusyId && fileBusyId !== f.id}
                        loading={fileBusyId === f.id}
                        style={styles.fileButton}
                      />
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </Card>
      )}
    </ScrollView>
  );
}

function SectionHead({ icon, color, title, subtitle }) {
  return (
    <View style={styles.sectionHead}>
      <IconBadge name={icon} color={color} soft size={36} iconSize={17} />
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  container: { padding: 20, paddingTop: 4, paddingBottom: 48 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  dim: { opacity: 0.5 },

  lifeCard: { paddingVertical: 14, paddingHorizontal: 8 },

  sectionHead: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  sectionHeading: { flex: 1, marginLeft: 12 },
  sectionTitle: { fontSize: 15.5, fontWeight: "800", color: colors.ink },
  sectionSubtitle: { fontSize: 12, color: colors.muted, marginTop: 1 },
  body: { fontSize: 14, color: colors.body, lineHeight: 21 },
  hint: { fontSize: 12.5, color: colors.muted, marginBottom: 10, lineHeight: 18 },

  infoBox: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.canvas, borderRadius: radius.md, padding: 14 },
  infoText: { flex: 1, fontSize: 13.5, color: colors.body, lineHeight: 20 },

  progressHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressCount: { fontSize: 15, fontWeight: "800", color: colors.indigo },
  progress: { marginTop: 8 },
  doneBanner: { marginTop: 14, marginBottom: 0 },
  primary: { marginTop: 14 },

  lockedBox: { alignItems: "center", backgroundColor: colors.canvas, borderRadius: radius.lg, paddingVertical: 22, paddingHorizontal: 18 },
  lockedIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  lockedTitle: { fontSize: 15.5, fontWeight: "800", color: colors.ink, marginTop: 12 },
  lockedText: { fontSize: 13, color: colors.muted, textAlign: "center", marginTop: 4, lineHeight: 19 },

  deviceUnlock: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    padding: 14,
  },
  deviceIcon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  deviceBody: { flex: 1, marginLeft: 14 },
  deviceTitle: { fontSize: 15.5, fontWeight: "800", color: "#fff" },
  deviceText: { fontSize: 12.5, color: colors.ghost, marginTop: 2 },

  row: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  rowField: { flex: 1, marginBottom: 0 },
  openButton: { minHeight: 50, borderRadius: radius.md + 2, minWidth: 84 },

  content: {
    marginTop: 14,
    backgroundColor: colors.greenSoft,
    borderWidth: 1,
    borderColor: "#bbf7d0",
    borderRadius: radius.md,
    padding: 12,
  },
  contentHead: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 6 },
  contentLabel: { fontSize: 11, fontWeight: "800", color: colors.greenInk, textTransform: "uppercase", letterSpacing: 0.5 },
  contentText: { fontSize: 14, color: colors.ink, lineHeight: 21 },

  files: { marginTop: 18 },
  filesTitle: { fontSize: 12, fontWeight: "800", color: colors.faint, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  lastRow: { borderBottomWidth: 0 },
  fileName: { flex: 1, fontSize: 14, color: colors.ink, marginHorizontal: 12, fontWeight: "600" },
  fileButton: { minWidth: 72 },
});
