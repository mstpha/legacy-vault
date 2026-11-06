import React, { useCallback, useState } from "react";
import { View, Text, Switch, StyleSheet, Alert, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { authenticate, getAuthCapability, isLockEnabled, setLockEnabled, LOCK_GRACE_MS } from "../utils/biometricLock";
import { createDeviceKey, deleteDeviceKey, getDeviceKeyInfo } from "../utils/deviceKeys";
import { getMyKeyRequest, registerPublicKeyRequest, removeMyKeyRequest } from "../api/keys.api";
import { Banner, Button, Card, Hero, HeroPill, HeroPills, IconBadge, Loading, SectionLabel } from "../components/ui";
import { colors, radius } from "../theme";

const MODE_TEXT = {
  hw: "Locked to this phone's secure hardware and your biometrics.",
  app: "Kept in secure storage; this app asks for your fingerprint, face or PIN before every use.",
  none: "Kept in secure storage, but this phone has no screen lock, so nothing asks before it is used.",
};

export default function SecuritySettingsScreen() {
  const { user } = useAuth();
  const userId = user?.id;

  const [capability, setCapability] = useState(null);
  const [lockOn, setLockOn] = useState(false);
  const [key, setKey] = useState({ exists: false });
  const [serverKey, setServerKey] = useState(undefined); // undefined = unknown, null = none registered
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [cap, enabled, info] = await Promise.all([getAuthCapability(), isLockEnabled(userId), getDeviceKeyInfo(userId)]);
    setCapability(cap);
    setLockOn(enabled);
    setKey(info);
    try {
      setServerKey((await getMyKeyRequest()).publicKey);
    } catch (err) {
      setServerKey(undefined);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!capability) return <Loading />;

  const canLock = capability.kind !== "none";
  const synced = key.exists && serverKey === key.publicKey;
  const protections = Number(lockOn) + Number(key.exists);

  const lockDescription =
    capability.kind === "biometric"
      ? `${capability.label} is set up on this phone.`
      : capability.kind === "device"
      ? "No fingerprint or face is set up, so your phone's PIN, pattern or password will be used. Adding a fingerprint or face in your phone settings makes it faster."
      : "This phone has no screen lock (or doesn't support one). Set a PIN, pattern, fingerprint or face in your phone settings to be able to use the app lock.";

  const onToggleLock = async (value) => {
    if (busy) return;
    setBusy(true);
    try {
      // Turning it on proves it works; turning it off proves it's really you.
      const ok = await authenticate(value ? "Turn on the app lock" : "Turn off the app lock");
      if (!ok) return;
      await setLockEnabled(userId, value);
      setLockOn(value);
    } finally {
      setBusy(false);
    }
  };

  const registerKey = async (publicKey) => {
    await registerPublicKeyRequest(publicKey);
    setServerKey(publicKey);
  };

  const onCreateKey = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const created = await createDeviceKey(userId);
      await registerKey(created.publicKey);
      setKey(await getDeviceKeyInfo(userId));
      Alert.alert("Device key created", "Owners can now share capsules with you without telling you a passphrase.");
    } catch (err) {
      if (err.code !== "AUTH_CANCELLED") {
        Alert.alert("Could not create the key", err.response?.data?.error?.message || err.message || "Something went wrong.");
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmReplace = () =>
    Alert.alert(
      "Replace your device key?",
      "Every capsule that was shared with your current key will stop opening with this phone, and the owners will have to share again. You can still use the passphrase.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Replace", style: "destructive", onPress: onCreateKey },
      ]
    );

  const onRemoveKey = () =>
    Alert.alert(
      "Remove your device key?",
      "The key is deleted from this phone and from the server. Shares made to it can no longer be opened.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await removeMyKeyRequest();
              await deleteDeviceKey(userId);
              setKey({ exists: false });
              setServerKey(null);
            } catch (err) {
              Alert.alert("Error", err.response?.data?.error?.message || "Could not remove the key.");
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );

  const onResync = async () => {
    setBusy(true);
    try {
      await registerKey(key.publicKey);
    } catch (err) {
      Alert.alert("Error", err.response?.data?.error?.message || "Could not register the key.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Hero
        icon={protections === 2 ? "shield-checkmark" : "finger-print"}
        eyebrow="This phone"
        title="Device security"
        subtitle={
          protections === 2
            ? "This phone is fully protected: the app is locked and your device key is ready."
            : "Lock the app with your biometrics and create a device key to open shared capsules without a passphrase."
        }
      >
        <HeroPills>
          <HeroPill label={`App lock ${lockOn ? "on" : "off"}`} dot={lockOn ? colors.green : colors.amber} />
          <HeroPill label={`Device key ${key.exists ? (synced ? "active" : "not synced") : "not set up"}`} dot={key.exists && synced ? colors.green : colors.amber} />
        </HeroPills>
      </Hero>

      {/* ---------- App lock ---------- */}
      <SectionLabel>App lock</SectionLabel>
      <Card>
        <View style={styles.row}>
          <IconBadge name="finger-print" color={lockOn ? colors.green : colors.teal} size={44} iconSize={22} />
          <View style={styles.rowText}>
            <Text style={styles.cardTitle}>Lock with {capability.kind === "biometric" ? capability.label.toLowerCase() : "phone PIN"}</Text>
            <Text style={styles.status}>{lockOn ? "On" : "Off"}</Text>
          </View>
          <Switch
            value={lockOn}
            onValueChange={onToggleLock}
            disabled={!canLock || busy}
            trackColor={{ false: colors.line, true: colors.green }}
            thumbColor="#fff"
          />
        </View>
        <Text style={styles.cardBody}>
          Asks to unlock when you open the app and after {Math.round(LOCK_GRACE_MS / 1000)} seconds away, and hides the screen in the app switcher.
        </Text>
        <Banner tone={canLock ? "info" : "warning"} style={styles.note}>
          {lockDescription}
        </Banner>
        <View style={styles.fineRow}>
          <Ionicons name="lock-closed" size={12} color={colors.faint} />
          <Text style={styles.fine}>Your fingerprint or face never leaves your phone. The app only learns "yes" or "no".</Text>
        </View>
      </Card>

      {/* ---------- Device key ---------- */}
      <SectionLabel>Device key</SectionLabel>
      <Card>
        <View style={styles.row}>
          <IconBadge name="key" color={key.exists ? colors.green : colors.amber} size={44} iconSize={21} />
          <View style={styles.rowText}>
            <Text style={styles.cardTitle}>{key.exists ? "Device key active" : "No device key yet"}</Text>
            <Text style={styles.status}>{key.exists ? (synced ? "Registered with the server" : "Not registered yet") : "Optional"}</Text>
          </View>
        </View>
        <Text style={styles.cardBody}>
          A key pair made on this phone. Capsule owners can lock a capsule's passphrase to your public key, so you open it with your
          fingerprint instead of typing a passphrase. The private key never leaves this phone.
        </Text>

        {key.exists && (
          <>
            <View style={styles.fingerprintBox}>
              <View style={styles.fingerprintHead}>
                <Ionicons name="finger-print" size={14} color={colors.indigo} />
                <Text style={styles.fingerprintLabel}>Your key fingerprint</Text>
              </View>
              <Text selectable style={styles.fingerprint}>
                {key.fingerprint}
              </Text>
              <Text style={styles.fine}>Owners should check this matches what they see before sharing a capsule with you.</Text>
            </View>
            <Text style={styles.cardBody}>{MODE_TEXT[key.mode] || MODE_TEXT.none}</Text>
            {!synced && serverKey !== undefined && (
              <Banner tone="warning" style={styles.note}>
                The server doesn't have this phone's key, so owners can't share with you yet.
              </Banner>
            )}
          </>
        )}

        <View style={styles.buttons}>
          {!key.exists ? (
            <Button title="Create device key" icon="key" onPress={onCreateKey} loading={busy} />
          ) : (
            <>
              {!synced && serverKey !== undefined && (
                <Button title="Register this key with the server" icon="cloud-upload" onPress={onResync} disabled={busy} />
              )}
              <View style={styles.buttonRow}>
                <Button title="Replace key" icon="swap-horizontal" variant="secondary" compact onPress={confirmReplace} disabled={busy} style={styles.flex} />
                <Button title="Remove key" icon="trash-outline" variant="danger" compact onPress={onRemoveKey} disabled={busy} style={styles.flex} />
              </View>
            </>
          )}
        </View>
        {!canLock && (
          <Text style={styles.fine}>Without a phone screen lock the key can still be created, but nothing will ask before it is used.</Text>
        )}
      </Card>

      <View style={styles.footer}>
        <Ionicons name="information-circle-outline" size={16} color={colors.faint} />
        <Text style={styles.footerText}>
          Keep your capsule passphrase safe even if you use device keys: if you lose this phone, the passphrase is the way back in.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  container: { padding: 20, paddingTop: 4, paddingBottom: 48 },
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center" },
  rowText: { flex: 1, marginHorizontal: 12 },
  cardTitle: { fontSize: 15.5, fontWeight: "800", color: colors.ink },
  status: { fontSize: 12.5, color: colors.muted, marginTop: 2, fontWeight: "600" },
  cardBody: { fontSize: 13, color: colors.muted, lineHeight: 19, marginTop: 12 },
  note: { marginTop: 12, marginBottom: 0 },
  fineRow: { flexDirection: "row", gap: 6, marginTop: 12, alignItems: "flex-start" },
  fine: { flex: 1, fontSize: 11.5, color: colors.faint, lineHeight: 17, marginTop: 4 },
  fingerprintBox: {
    backgroundColor: colors.indigoSoft,
    borderWidth: 1,
    borderColor: colors.indigoLine,
    borderRadius: radius.md + 2,
    padding: 14,
    marginTop: 14,
  },
  fingerprintHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  fingerprintLabel: { fontSize: 11, fontWeight: "800", color: colors.indigoInk, textTransform: "uppercase", letterSpacing: 0.6 },
  fingerprint: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.ink,
    letterSpacing: 1.5,
    marginTop: 8,
    fontVariant: ["tabular-nums"],
  },
  buttons: { marginTop: 16, gap: 10 },
  buttonRow: { flexDirection: "row", gap: 10 },
  footer: { flexDirection: "row", gap: 8, paddingHorizontal: 4, marginTop: 4 },
  footerText: { flex: 1, fontSize: 12, color: colors.faint, lineHeight: 18 },
});
