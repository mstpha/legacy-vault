import React, { useCallback, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator, ScrollView } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { usePreventScreenCapture } from "expo-screen-capture";
import {
  getCapsuleRequest,
  getCapsuleContentRequest,
  addGuarantorRequest,
  removeGuarantorRequest,
  addBeneficiaryRequest,
  removeBeneficiaryRequest,
  setThresholdsRequest,
  activateCapsuleRequest,
  revokeCapsuleRequest,
  confirmActivityRequest,
} from "../api/capsule.api";
import { getKeyRecipientsRequest, saveKeySharesRequest } from "../api/keys.api";
import { decryptText } from "../utils/encryption";
import { confirmSensitive } from "../utils/biometricLock";
import { wrapPassphraseFor } from "../utils/deviceKeys";
import { fingerprint } from "../utils/sealedBox";
import { useAuth } from "../context/AuthContext";

export default function CapsuleDetailScreen({ route, navigation }) {
  const { capsuleId } = route.params;
  const [capsule, setCapsule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [decrypting, setDecrypting] = useState(false);

  const [guarantorEmail, setGuarantorEmail] = useState("");
  const [beneficiaryEmail, setBeneficiaryEmail] = useState("");
  const [inactivityDays, setInactivityDays] = useState("90");
  const [graceDays, setGraceDays] = useState("14");
  const [threshold, setThreshold] = useState("2");

  const [viewPassphrase, setViewPassphrase] = useState("");
  const [decryptedContent, setDecryptedContent] = useState(null);

  usePreventScreenCapture(); // no screenshots / screen recording / app-switcher thumbnail of decrypted content
  const { user } = useAuth();
  const [recipients, setRecipients] = useState([]);
  const [sharePassphrase, setSharePassphrase] = useState("");
  const [sharing, setSharing] = useState(false);
  const [keysError, setKeysError] = useState(null); // why the device-key status couldn't load (shown instead of hiding the section)
  const scrollRef = useRef(null);
  const keysY = useRef(0); // where the Device keys section sits, so "Set up now" can scroll to it

  const load = useCallback(async () => {
    try {
      const data = await getCapsuleRequest(capsuleId);
      setCapsule(data);
      if (data.beneficiaries?.length) {
        getKeyRecipientsRequest(capsuleId)
          .then((result) => {
            setRecipients(result.recipients);
            setKeysError(null);
          })
          .catch((err) => {
            // Never block the rest of the screen, but SAY what went wrong.
            setKeysError(
              !err.response
                ? "Can't reach the server to load device key status."
                : err.response.status === 404 || err.response.status >= 500
                ? "The server couldn't load device keys. Restart the backend and make sure the device_keys database migration was run."
                : err.response.data?.error?.message || "Couldn't load device key status."
            );
          });
      } else {
        setRecipients([]);
        setKeysError(null);
      }
      setInactivityDays(String(data.inactivityThresholdDays));
      setGraceDays(String(data.graceWindowDays));
      setThreshold(String(data.validationThreshold));
    } catch (err) {
      Alert.alert("Error", "Could not load this capsule.");
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

  const runAction = async (fn, successMessage) => {
    setBusy(true);
    try {
      await fn();
      if (successMessage) Alert.alert("Done", successMessage);
      await load();
      return true;
    } catch (err) {
      Alert.alert("Error", err.response?.data?.error?.message || "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (loading || !capsule) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const isDraft = capsule.state === "DRAFT";
  const isAlert = capsule.state === "INACTIVITY_ALERT";

  const onAddGuarantor = () =>
    runAction(async () => {
      await addGuarantorRequest(capsuleId, guarantorEmail.trim().toLowerCase());
      setGuarantorEmail("");
    });

  const onAddBeneficiary = () =>
    runAction(async () => {
      await addBeneficiaryRequest(capsuleId, beneficiaryEmail.trim().toLowerCase());
      setBeneficiaryEmail("");
    });

  const onSaveThresholds = () =>
    runAction(() =>
      setThresholdsRequest(capsuleId, {
        inactivityThresholdDays: Number(inactivityDays),
        graceWindowDays: Number(graceDays),
        validationThreshold: Number(threshold),
      })
    );

  const onActivate = () =>
    Alert.alert("Activate capsule?", "Monitoring will begin immediately. You can still revoke it later.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Activate",
        onPress: async () => {
          const activated = await runAction(() => activateCapsuleRequest(capsuleId));
          if (activated && capsule.beneficiaries?.length) {
            Alert.alert(
              "Share access with device keys?",
              "Instead of telling your beneficiaries the passphrase, you can lock it to each person's device key so they open the capsule with their fingerprint. They need to create a device key first (Home > Device security).",
              [
                { text: "Later", style: "cancel" },
                {
                  text: "Set up now",
                  onPress: () => scrollRef.current?.scrollTo({ y: Math.max(0, keysY.current - 12), animated: true }),
                },
              ]
            );
          }
        },
      },
    ]);

  const onRevoke = () =>
    Alert.alert("Revoke capsule?", "This permanently erases its content. This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Revoke",
        style: "destructive",
        onPress: async () => {
          if (await confirmSensitive(user.id, "Confirm to revoke this capsule")) {
            runAction(() => revokeCapsuleRequest(capsuleId));
          }
        },
      },
    ]);

  const onConfirmActivity = () =>
    runAction(() => confirmActivityRequest(capsuleId), "You're confirmed active — the capsule is back to normal.");

  const onDecrypt = async () => {
    if (decrypting) return; // ignore extra taps while working
    setDecrypting(true);
    try {
      const blob = await getCapsuleContentRequest(capsuleId);
      if (!blob) {
        Alert.alert("No content yet", "This capsule doesn't have any text content stored.");
        return;
      }
      // Decryption blocks the JS thread for a few seconds (PBKDF2 in pure JS).
      // This pause lets React paint the spinner BEFORE the freeze starts.
      await new Promise((resolve) => setTimeout(resolve, 60));
      const text = decryptText(blob, viewPassphrase);
      setDecryptedContent(text);
    } catch (err) {
      Alert.alert("Could not decrypt", "Wrong passphrase, or the content is corrupted.");
    } finally {
      setDecrypting(false);
    }
  };

  // ---- device keys: seal the passphrase to each beneficiary's public key (on THIS phone) ----
  const shareable = recipients.filter((r) => r.publicKey);
  const canShareKeys = ["DRAFT", "ACTIVE", "INACTIVITY_ALERT", "PENDING_VALIDATION"].includes(capsule.state);

  const confirmFingerprints = (targets) =>
    new Promise((resolve) =>
      Alert.alert(
        "Check each key fingerprint",
        "Ask each person to read you the fingerprint shown in their Device security screen. Only continue if they match exactly. This stops someone swapping in their own key.\n\n" +
          targets.map((t) => `${t.fullName}\n${fingerprint(t.publicKey)}`).join("\n\n"),
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "They match, share", onPress: () => resolve(true) },
        ],
        { cancelable: false }
      )
    );

  const onShareKeys = async () => {
    if (sharing) return;
    if (!sharePassphrase) return Alert.alert("Passphrase needed", "Enter the capsule's encryption passphrase first.");
    if (shareable.length === 0) {
      return Alert.alert(
        "Nobody can receive a key yet",
        "None of your beneficiaries has created a device key. They can do it in the app under Device security."
      );
    }
    if (!(await confirmFingerprints(shareable))) return;
    if (!(await confirmSensitive(user.id, "Confirm to share this capsule's key"))) return;

    setSharing(true);
    try {
      // Make sure the passphrase is the right one, otherwise we'd lock the beneficiaries out.
      if (capsule.hasContent) {
        const blob = await getCapsuleContentRequest(capsuleId);
        await new Promise((resolve) => setTimeout(resolve, 60)); // let the spinner paint before the heavy decrypt
        if (blob) {
          try {
            decryptText(blob, sharePassphrase);
          } catch (err) {
            Alert.alert("Wrong passphrase", "That passphrase doesn't open this capsule, so it wasn't shared.");
            return;
          }
        }
      }
      const shares = shareable.map((r) => ({
        userId: r.userId,
        publicKey: r.publicKey,
        wrappedKey: wrapPassphraseFor(r.publicKey, sharePassphrase),
      }));
      await saveKeySharesRequest(capsuleId, shares);
      setSharePassphrase("");
      Alert.alert("Shared", "Your beneficiaries can open this capsule with their device key once it is unlocked.");
      await load();
    } catch (err) {
      Alert.alert("Could not share", err.response?.data?.error?.message || "Something went wrong.");
      load();
    } finally {
      setSharing(false);
    }
  };

  const disabledAll = busy || decrypting || sharing;

  return (
    <ScrollView ref={scrollRef} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{capsule.title}</Text>
      <Text style={styles.subtitle}>
        {capsule.type} · {capsule.state}
      </Text>

      {isAlert && (
        <View style={styles.alertBox}>
          <Text style={styles.alertText}>
            You've crossed your inactivity threshold. Confirm you're still active before the grace window expires.
          </Text>
          <Pressable style={styles.button} onPress={onConfirmActivity} disabled={disabledAll}>
            <Text style={styles.buttonText}>I'm still active</Text>
          </Pressable>
        </View>
      )}

      {capsule.hasContent && (
        <Section title="Content">
          <Text style={styles.hint}>
            Content is encrypted — enter the passphrase you set when creating it to view it here.
          </Text>
          <View style={styles.addRow}>
            <TextInput
              style={styles.addInput}
              placeholder="Passphrase"
              secureTextEntry
              value={viewPassphrase}
              onChangeText={setViewPassphrase}
              editable={!decrypting}
            />
            <Pressable
              style={[styles.addButton, (!viewPassphrase || decrypting) && styles.buttonDimmed]}
              onPress={onDecrypt}
              disabled={!viewPassphrase || disabledAll}
            >
              {decrypting ? <ActivityIndicator color="#fff" /> : <Text style={styles.addButtonText}>View</Text>}
            </Pressable>
          </View>
          {decrypting && <Text style={styles.hint}>Decrypting… this can take a few seconds.</Text>}
          {decryptedContent !== null && <Text style={styles.decryptedText}>{decryptedContent}</Text>}
        </Section>
      )}

      <Section title="Guarantors">
        {capsule.guarantors?.map((g) => (
          <MemberRow
            key={g.userId}
            label={g.user.fullName || g.user.email}
            onRemove={isDraft ? () => runAction(() => removeGuarantorRequest(capsuleId, g.userId)) : null}
          />
        ))}
        {isDraft && (
          <AddMemberRow value={guarantorEmail} onChangeText={setGuarantorEmail} onSubmit={onAddGuarantor} placeholder="Guarantor's email" />
        )}
      </Section>

      <Section title="Beneficiaries">
        {capsule.beneficiaries?.map((b) => (
          <MemberRow
            key={b.userId}
            label={b.user.fullName || b.user.email}
            onRemove={isDraft ? () => runAction(() => removeBeneficiaryRequest(capsuleId, b.userId)) : null}
          />
        ))}
        {isDraft && (
          <AddMemberRow value={beneficiaryEmail} onChangeText={setBeneficiaryEmail} onSubmit={onAddBeneficiary} placeholder="Beneficiary's email" />
        )}
      </Section>

      {canShareKeys && capsule.beneficiaries?.length > 0 && (
        <View onLayout={(event) => (keysY.current = event.nativeEvent.layout.y)}>
        <Section title="Device keys (no passphrase to hand over)">
          <Text style={styles.hint}>
            Seal this capsule's passphrase to each beneficiary's device key, on your phone. After unlock they open it with their
            fingerprint. The server only stores a sealed copy it cannot read.
          </Text>
          {keysError && (
            <View style={styles.keysError}>
              <Text style={styles.keysErrorText}>{keysError}</Text>
              <Pressable onPress={load}>
                <Text style={styles.keysRetry}>Retry</Text>
              </Pressable>
            </View>
          )}
          {!keysError && recipients.length === 0 && <Text style={styles.hint}>Checking your beneficiaries' device keys...</Text>}
          {recipients.map((r) => (
            <View key={r.userId} style={styles.recipientRow}>
              <Text style={styles.memberLabel}>{r.fullName || r.email}</Text>
              <Text style={r.hasShare ? styles.shareOk : styles.shareMissing}>
                {r.hasShare ? "Shared" : r.publicKey ? "Key ready" : "No device key yet"}
              </Text>
              {r.publicKey && <Text style={styles.fingerprintSmall}>{fingerprint(r.publicKey)}</Text>}
            </View>
          ))}
          {shareable.length > 0 && (
            <>
              <TextInput
                style={[styles.addInput, styles.shareInput]}
                placeholder="Capsule passphrase"
                secureTextEntry
                value={sharePassphrase}
                onChangeText={setSharePassphrase}
                editable={!sharing}
              />
              <Pressable style={[styles.secondaryButton, sharing && styles.buttonDimmed]} onPress={onShareKeys} disabled={sharing || !sharePassphrase}>
                {sharing ? <ActivityIndicator /> : <Text style={styles.secondaryButtonText}>Share with {shareable.length} device key(s)</Text>}
              </Pressable>
            </>
          )}
        </Section>
        </View>
      )}

      <Section title="Thresholds">
        <LabeledInput label="Inactivity delay (days)" value={inactivityDays} onChangeText={setInactivityDays} editable={isDraft} />
        <LabeledInput label="Grace window (days)" value={graceDays} onChangeText={setGraceDays} editable={isDraft} />
        <LabeledInput label="Guarantors required to unlock" value={threshold} onChangeText={setThreshold} editable={isDraft} />
        {isDraft && (
          <Pressable style={styles.secondaryButton} onPress={onSaveThresholds} disabled={disabledAll}>
            <Text style={styles.secondaryButtonText}>Save thresholds</Text>
          </Pressable>
        )}
      </Section>

      {capsule.files?.length > 0 && (
        <Section title="Files">
          {capsule.files.map((f) => (
            <Text key={f.id} style={styles.fileRow}>
              📎 {f.fileName}
            </Text>
          ))}
        </Section>
      )}
      {capsule.hasContent && (
        <Section title="Capsule Content">
          {decryptedContent !== null ? (
            <Text style={styles.decryptedText}>{decryptedContent}</Text>
          ) : (
            <Text style={styles.hint}>
              Decrypt the content using the passphrase in the Content section above.
            </Text>
          )}
        </Section>
      )}
      {isDraft && (
        <Pressable style={styles.button} onPress={onActivate} disabled={disabledAll}>
          <Text style={styles.buttonText}>Activate capsule</Text>
        </Pressable>
      )}

      {!["UNLOCKED", "ARCHIVED", "REVOKED"].includes(capsule.state) && (
        <Pressable style={styles.dangerButton} onPress={onRevoke} disabled={disabledAll}>
          <Text style={styles.dangerButtonText}>Revoke capsule</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function MemberRow({ label, onRemove }) {
  return (
    <View style={styles.memberRow}>
      <Text style={styles.memberLabel}>{label}</Text>
      {onRemove && (
        <Pressable onPress={onRemove}>
          <Text style={styles.removeText}>Remove</Text>
        </Pressable>
      )}
    </View>
  );
}

function AddMemberRow({ value, onChangeText, onSubmit, placeholder }) {
  return (
    <View style={styles.addRow}>
      <TextInput
        style={styles.addInput}
        placeholder={placeholder}
        autoCapitalize="none"
        keyboardType="email-address"
        value={value}
        onChangeText={onChangeText}
      />
      <Pressable style={styles.addButton} onPress={onSubmit} disabled={!value.trim()}>
        <Text style={styles.addButtonText}>Add</Text>
      </Pressable>
    </View>
  );
}

function LabeledInput({ label, value, onChangeText, editable }) {
  return (
    <View style={styles.labeledInputRow}>
      <Text style={styles.labeledInputLabel}>{label}</Text>
      <TextInput
        style={[styles.labeledInput, !editable && styles.labeledInputDisabled]}
        value={value}
        onChangeText={onChangeText}
        keyboardType="number-pad"
        editable={editable}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { fontSize: 13, color: "#666", marginTop: 4, marginBottom: 12 },
  alertBox: { backgroundColor: "#fef3c7", borderRadius: 10, padding: 14, marginBottom: 20 },
  alertText: { color: "#92400e", marginBottom: 10 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: "#374151", textTransform: "uppercase", marginBottom: 8 },
  memberRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  memberLabel: { fontSize: 14 },
  removeText: { color: "#ef4444", fontSize: 13 },
  addRow: { flexDirection: "row", marginTop: 10, gap: 8 },
  addInput: { flex: 1, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, padding: 10 },
  addButton: { backgroundColor: "#0f172a", borderRadius: 8, paddingHorizontal: 16, justifyContent: "center", minWidth: 64, alignItems: "center" },
  addButtonText: { color: "#fff", fontWeight: "600" },
  buttonDimmed: { opacity: 0.6 },
  labeledInputRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  labeledInputLabel: { fontSize: 13, color: "#374151", flex: 1 },
  labeledInput: { width: 70, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, padding: 8, textAlign: "center" },
  labeledInputDisabled: { backgroundColor: "#f3f4f6", color: "#999" },
  fileRow: { fontSize: 14, paddingVertical: 4 },
  hint: { fontSize: 12, color: "#999", marginBottom: 8 },
  decryptedText: { marginTop: 12, backgroundColor: "#f3f4f6", borderRadius: 8, padding: 12, fontSize: 14 },
  button: { backgroundColor: "#0f172a", borderRadius: 10, padding: 14, alignItems: "center", marginTop: 8 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secondaryButton: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, padding: 10, alignItems: "center", marginTop: 8 },
  secondaryButtonText: { color: "#374151", fontWeight: "600" },
  dangerButton: { borderWidth: 1, borderColor: "#ef4444", borderRadius: 10, padding: 14, alignItems: "center", marginTop: 12 },
  dangerButtonText: { color: "#ef4444", fontWeight: "600" },
  recipientRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  shareOk: { fontSize: 12, color: "#16a34a", fontWeight: "600", marginTop: 2 },
  shareMissing: { fontSize: 12, color: "#9ca3af", marginTop: 2 },
  fingerprintSmall: { fontSize: 11, color: "#94a3b8", letterSpacing: 0.5, marginTop: 2 },
  shareInput: { marginTop: 12 },
  keysError: { backgroundColor: "#fef2f2", borderRadius: 8, padding: 10, marginBottom: 8 },
  keysErrorText: { color: "#b91c1c", fontSize: 12.5, lineHeight: 18 },
  keysRetry: { color: "#0f172a", fontWeight: "700", marginTop: 6 },
});