import React, { useCallback, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
import { getKeyRecipientsRequest, saveKeySharesRequest } from "../api/keys.api";
import { decryptText } from "../utils/encryption";
import { confirmSensitive } from "../utils/biometricLock";
import { wrapPassphraseFor } from "../utils/deviceKeys";
import { fingerprint } from "../utils/sealedBox";
import { useAuth } from "../context/AuthContext";
import { Card, Field, Button, Banner, IconBadge, Pill, Loading, Hero, HeroPills, HeroPill, HeroStats, Lifecycle, Avatar, ActionBar } from "../components/ui";
import { colors, radius, TYPE_ICONS, STATE_LABELS, STATE_COLORS } from "../theme";

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

  if (loading || !capsule) return <Loading />;

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
    <View style={styles.screen}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* --- Hero: title, type, state, key numbers --- */}
        <Hero
          icon={TYPE_ICONS[capsule.type] || "archive"}
          eyebrow={`${capsule.type.charAt(0) + capsule.type.slice(1).toLowerCase()} capsule`}
          title={capsule.title}
        >
          <HeroPills>
            <HeroPill label={STATE_LABELS[capsule.state] || capsule.state} dot={STATE_COLORS[capsule.state]} />
            {capsule.hasContent && <HeroPill label="Encrypted content" icon="lock-closed" />}
            {capsule.files?.length > 0 && <HeroPill label={`${capsule.files.length} file${capsule.files.length > 1 ? "s" : ""}`} icon="attach" />}
          </HeroPills>
          <HeroStats
            items={[
              { value: capsule.guarantors?.length || 0, label: "Guarantors" },
              { value: capsule.beneficiaries?.length || 0, label: "Beneficiaries" },
              { value: `${capsule.inactivityThresholdDays}d`, label: "Inactivity" },
            ]}
          />
        </Hero>

        {capsule.state === "REVOKED" ? (
          <Banner tone="danger" icon="ban" title="Revoked">
            This capsule was revoked and its content erased.
          </Banner>
        ) : (
          <Card style={styles.lifeCard}>
            <Lifecycle state={capsule.state} />
          </Card>
        )}

        {isAlert && (
          <Banner tone="warning" icon="time" title="Are you still there?">
            <Text style={styles.alertText}>
              You've crossed your inactivity threshold. Confirm you're still active before the grace window expires.
            </Text>
            <Button title="I'm still active" icon="checkmark-circle" compact onPress={onConfirmActivity} disabled={disabledAll} />
          </Banner>
        )}

        {capsule.hasContent && (
          <Section title="Content" subtitle="Decrypted only on this phone" icon="lock-closed" color={colors.indigo}>
            <View style={styles.addRow}>
              <Field
                placeholder="Passphrase"
                icon="key-outline"
                secureTextEntry
                value={viewPassphrase}
                onChangeText={setViewPassphrase}
                editable={!decrypting}
                style={styles.addField}
              />
              <Button
                title="View"
                icon="eye"
                compact
                onPress={onDecrypt}
                disabled={!viewPassphrase || disabledAll}
                loading={decrypting}
                style={styles.addButton}
              />
            </View>
            {decrypting && <Text style={styles.hint}>Decrypting… this can take a few seconds.</Text>}
            {decryptedContent !== null && (
              <View style={styles.decrypted}>
                <View style={styles.decryptedHead}>
                  <Ionicons name="lock-open" size={13} color={colors.greenInk} />
                  <Text style={styles.decryptedLabel}>Decrypted on this device</Text>
                </View>
                <Text selectable style={styles.decryptedText}>
                  {decryptedContent}
                </Text>
              </View>
            )}
          </Section>
        )}

        <Section
          title="Guarantors"
          subtitle={`${capsule.validationThreshold} must validate to unlock`}
          icon="shield-checkmark"
          color={colors.indigo}
          count={capsule.guarantors?.length}
        >
          {capsule.guarantors?.length === 0 && !isDraft && <Text style={styles.hint}>No guarantors.</Text>}
          {capsule.guarantors?.map((g) => (
            <MemberRow
              key={g.userId}
              name={g.user.fullName}
              email={g.user.email}
              onRemove={isDraft ? () => runAction(() => removeGuarantorRequest(capsuleId, g.userId)) : null}
            />
          ))}
          {isDraft && (
            <AddMemberRow value={guarantorEmail} onChangeText={setGuarantorEmail} onSubmit={onAddGuarantor} placeholder="Guarantor's email" />
          )}
        </Section>

        <Section
          title="Beneficiaries"
          subtitle="Can read the capsule once unlocked"
          icon="gift"
          color={colors.sky}
          count={capsule.beneficiaries?.length}
        >
          {capsule.beneficiaries?.length === 0 && !isDraft && <Text style={styles.hint}>No beneficiaries.</Text>}
          {capsule.beneficiaries?.map((b) => (
            <MemberRow
              key={b.userId}
              name={b.user.fullName}
              email={b.user.email}
              onRemove={isDraft ? () => runAction(() => removeBeneficiaryRequest(capsuleId, b.userId)) : null}
            />
          ))}
          {isDraft && (
            <AddMemberRow value={beneficiaryEmail} onChangeText={setBeneficiaryEmail} onSubmit={onAddBeneficiary} placeholder="Beneficiary's email" />
          )}
        </Section>

        {canShareKeys && capsule.beneficiaries?.length > 0 && (
          <View onLayout={(event) => (keysY.current = event.nativeEvent.layout.y)}>
            <Section title="Device keys" subtitle="No passphrase to hand over" icon="finger-print" color={colors.teal}>
              <Text style={styles.hint}>
                Seal this capsule's passphrase to each beneficiary's device key, on your phone. After unlock they open it with their
                fingerprint. The server only stores a sealed copy it cannot read.
              </Text>
              {keysError && (
                <Banner tone="danger">
                  <Text style={styles.keysErrorText}>{keysError}</Text>
                  <Pressable onPress={load} hitSlop={8}>
                    <Text style={styles.keysRetry}>Retry</Text>
                  </Pressable>
                </Banner>
              )}
              {!keysError && recipients.length === 0 && (
                <View style={styles.checking}>
                  <ActivityIndicator size="small" color={colors.faint} />
                  <Text style={styles.hintInline}>Checking your beneficiaries' device keys…</Text>
                </View>
              )}
              {recipients.map((r) => (
                <View key={r.userId} style={styles.memberRow}>
                  <Avatar label={r.fullName || r.email} />
                  <View style={styles.memberBody}>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {r.fullName || r.email}
                    </Text>
                    {r.publicKey && <Text style={styles.fingerprintSmall}>{fingerprint(r.publicKey)}</Text>}
                  </View>
                  <Pill
                    label={r.hasShare ? "Shared" : r.publicKey ? "Key ready" : "No key yet"}
                    icon={r.hasShare ? "checkmark" : r.publicKey ? "key" : "time-outline"}
                    color={r.hasShare ? "#16a34a" : r.publicKey ? colors.indigo : colors.faint}
                  />
                </View>
              ))}
              {shareable.length > 0 && (
                <>
                  <Field
                    placeholder="Capsule passphrase"
                    icon="key-outline"
                    secureTextEntry
                    value={sharePassphrase}
                    onChangeText={setSharePassphrase}
                    editable={!sharing}
                    style={styles.shareField}
                  />
                  <Button
                    title={`Share with ${shareable.length} device key${shareable.length === 1 ? "" : "s"}`}
                    icon="share-social"
                    variant="secondary"
                    onPress={onShareKeys}
                    disabled={sharing || !sharePassphrase}
                    loading={sharing}
                  />
                </>
              )}
            </Section>
          </View>
        )}

        <Section
          title="Thresholds"
          subtitle={isDraft ? "Editable while the capsule is a draft" : "Locked once activated"}
          icon="options"
          color={colors.amber}
        >
          <LabeledInput
            icon="time-outline"
            label="Inactivity delay"
            unit="days"
            value={inactivityDays}
            onChangeText={setInactivityDays}
            editable={isDraft}
          />
          <LabeledInput
            icon="hourglass-outline"
            label="Grace window"
            unit="days"
            value={graceDays}
            onChangeText={setGraceDays}
            editable={isDraft}
          />
          <LabeledInput
            icon="people-outline"
            label="Guarantors to unlock"
            value={threshold}
            onChangeText={setThreshold}
            editable={isDraft}
            last
          />
          {isDraft && (
            <Button
              title="Save thresholds"
              icon="save-outline"
              variant="secondary"
              compact
              onPress={onSaveThresholds}
              disabled={disabledAll}
              style={styles.saveButton}
            />
          )}
        </Section>

        {capsule.files?.length > 0 && (
          <Section title="Files" subtitle="Encrypted attachments" icon="attach" color={colors.muted} count={capsule.files.length}>
            {capsule.files.map((f, i) => (
              <View key={f.id} style={[styles.fileRow, i === capsule.files.length - 1 && styles.lastRow]}>
                <IconBadge name="document" color={colors.indigo} soft size={34} iconSize={16} />
                <Text style={styles.fileName} numberOfLines={1}>
                  {f.fileName}
                </Text>
                <Ionicons name="lock-closed" size={13} color={colors.ghost} />
              </View>
            ))}
          </Section>
        )}

        {!["UNLOCKED", "ARCHIVED", "REVOKED"].includes(capsule.state) && (
          <Card tone="danger" style={styles.dangerCard}>
            <View style={styles.dangerHead}>
              <Ionicons name="warning" size={16} color={colors.redInk} />
              <Text style={styles.dangerTitle}>Danger zone</Text>
            </View>
            <Text style={styles.dangerText}>Revoking permanently erases this capsule's content. This cannot be undone.</Text>
            <Button title="Revoke capsule" icon="trash-outline" variant="danger" compact onPress={onRevoke} disabled={disabledAll} />
          </Card>
        )}
      </ScrollView>

      {isDraft && (
        <ActionBar>
          <Button title="Activate capsule" icon="play-circle" onPress={onActivate} disabled={disabledAll} style={styles.flex} />
        </ActionBar>
      )}
    </View>
  );
}

function Section({ title, subtitle, icon, color, count, children }) {
  return (
    <Card style={styles.section}>
      <View style={styles.sectionHead}>
        <IconBadge name={icon} color={color} soft size={36} iconSize={17} />
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
        </View>
        {count > 0 && <Text style={styles.sectionCount}>{count}</Text>}
      </View>
      {children}
    </Card>
  );
}

function MemberRow({ name, email, onRemove }) {
  return (
    <View style={styles.memberRow}>
      <Avatar label={name || email} />
      <View style={styles.memberBody}>
        <Text style={styles.memberName} numberOfLines={1}>
          {name || email}
        </Text>
        {name && email ? (
          <Text style={styles.memberEmail} numberOfLines={1}>
            {email}
          </Text>
        ) : null}
      </View>
      {onRemove && (
        <Pressable onPress={onRemove} hitSlop={10} accessibilityLabel={`Remove ${name || email}`}>
          <Ionicons name="close-circle" size={22} color={colors.ghost} />
        </Pressable>
      )}
    </View>
  );
}

function AddMemberRow({ value, onChangeText, onSubmit, placeholder }) {
  return (
    <View style={styles.addRow}>
      <Field
        placeholder={placeholder}
        icon="mail-outline"
        autoCapitalize="none"
        keyboardType="email-address"
        value={value}
        onChangeText={onChangeText}
        style={styles.addField}
      />
      <Button title="Add" icon="add" compact onPress={onSubmit} disabled={!value.trim()} style={styles.addButton} />
    </View>
  );
}

function LabeledInput({ icon, label, unit, value, onChangeText, editable, last }) {
  return (
    <View style={[styles.labeledInputRow, last && styles.lastRow]}>
      <View style={styles.labeledIcon}>
        <Ionicons name={icon} size={16} color={colors.muted} />
      </View>
      <Text style={styles.labeledInputLabel}>{label}</Text>
      <TextInput
        style={[styles.labeledInput, !editable && styles.labeledInputDisabled]}
        value={value}
        onChangeText={onChangeText}
        keyboardType="number-pad"
        editable={editable}
      />
      <Text style={styles.unit}>{unit || ""}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  container: { padding: 20, paddingTop: 4, paddingBottom: 32 },
  flex: { flex: 1 },

  lifeCard: { paddingVertical: 14, paddingHorizontal: 8 },
  alertText: { color: colors.amberInk, fontSize: 13, lineHeight: 19, marginBottom: 10 },

  section: { padding: 16 },
  sectionHead: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  sectionHeading: { flex: 1, marginLeft: 12 },
  sectionTitle: { fontSize: 15.5, fontWeight: "800", color: colors.ink },
  sectionSubtitle: { fontSize: 12, color: colors.muted, marginTop: 1 },
  sectionCount: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.muted,
    backgroundColor: colors.hairline,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
    overflow: "hidden",
  },
  hint: { fontSize: 12.5, color: colors.muted, lineHeight: 18, marginBottom: 10 },
  hintInline: { fontSize: 12.5, color: colors.muted },
  checking: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },

  addRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 8 },
  addField: { flex: 1, marginBottom: 0 },
  addButton: { minHeight: 50, borderRadius: radius.md + 2 },

  decrypted: {
    marginTop: 12,
    backgroundColor: colors.greenSoft,
    borderWidth: 1,
    borderColor: "#bbf7d0",
    borderRadius: radius.md,
    padding: 12,
  },
  decryptedHead: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 6 },
  decryptedLabel: { fontSize: 11, fontWeight: "800", color: colors.greenInk, textTransform: "uppercase", letterSpacing: 0.5 },
  decryptedText: { fontSize: 14, color: colors.ink, lineHeight: 21 },

  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  memberBody: { flex: 1, marginHorizontal: 12 },
  memberName: { fontSize: 14, fontWeight: "700", color: colors.ink },
  memberEmail: { fontSize: 12, color: colors.faint, marginTop: 1 },

  fingerprintSmall: { fontSize: 11, color: colors.faint, letterSpacing: 0.5, marginTop: 2, fontVariant: ["tabular-nums"] },
  shareField: { marginTop: 14, marginBottom: 10 },
  keysErrorText: { color: colors.redInk, fontSize: 12.5, lineHeight: 18 },
  keysRetry: { color: colors.ink, fontWeight: "800", marginTop: 6 },

  labeledInputRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  lastRow: { borderBottomWidth: 0 },
  labeledIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: colors.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  labeledInputLabel: { fontSize: 14, color: colors.text, flex: 1, marginLeft: 12, fontWeight: "600" },
  labeledInput: {
    width: 64,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.canvas,
    borderRadius: radius.sm,
    paddingVertical: 8,
    textAlign: "center",
    fontSize: 15,
    fontWeight: "800",
    color: colors.ink,
  },
  labeledInputDisabled: { backgroundColor: colors.hairline, borderColor: colors.hairline, color: colors.muted },
  unit: { fontSize: 12, color: colors.faint, marginLeft: 8, width: 30 },
  saveButton: { marginTop: 12 },

  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  fileName: { flex: 1, fontSize: 14, color: colors.ink, fontWeight: "600" },

  dangerCard: { marginTop: 8 },
  dangerHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  dangerTitle: { fontSize: 14, fontWeight: "800", color: colors.redInk },
  dangerText: { fontSize: 12.5, color: colors.muted, lineHeight: 18, marginTop: 4, marginBottom: 12 },
});
