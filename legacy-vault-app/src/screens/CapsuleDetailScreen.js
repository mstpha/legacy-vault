import React, { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator, ScrollView } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
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
import { decryptText } from "../utils/encryption";

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

  const load = useCallback(async () => {
    try {
      const data = await getCapsuleRequest(capsuleId);
      setCapsule(data);
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
    } catch (err) {
      Alert.alert("Error", err.response?.data?.error?.message || "Something went wrong.");
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
      { text: "Activate", onPress: () => runAction(() => activateCapsuleRequest(capsuleId)) },
    ]);

  const onRevoke = () =>
    Alert.alert("Revoke capsule?", "This permanently erases its content. This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Revoke", style: "destructive", onPress: () => runAction(() => revokeCapsuleRequest(capsuleId)) },
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

  const disabledAll = busy || decrypting;

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
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
});