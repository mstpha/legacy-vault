import React, { useCallback, useState } from "react";
import { View, Text, Pressable, Switch, StyleSheet, Alert, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { authenticate, getAuthCapability, isLockEnabled, setLockEnabled, LOCK_GRACE_MS } from "../utils/biometricLock";
import { createDeviceKey, deleteDeviceKey, getDeviceKeyInfo } from "../utils/deviceKeys";
import { getMyKeyRequest, registerPublicKeyRequest, removeMyKeyRequest } from "../api/keys.api";

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

  if (!capability) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const canLock = capability.kind !== "none";
  const synced = key.exists && serverKey === key.publicKey;

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
      {/* ---------- App lock ---------- */}
      <Text style={styles.sectionLabel}>App lock</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.cardTitle}>Lock with {capability.kind === "biometric" ? capability.label.toLowerCase() : "phone PIN"}</Text>
            <Text style={styles.cardBody}>
              Asks to unlock when you open the app and after {Math.round(LOCK_GRACE_MS / 1000)} seconds away, and hides the screen in the app switcher.
            </Text>
          </View>
          <Switch value={lockOn} onValueChange={onToggleLock} disabled={!canLock || busy} />
        </View>
        <View style={[styles.note, !canLock && styles.noteWarn]}>
          <Ionicons name={canLock ? "information-circle" : "warning"} size={16} color={canLock ? "#475569" : "#b45309"} />
          <Text style={[styles.noteText, !canLock && styles.noteTextWarn]}>{lockDescription}</Text>
        </View>
        <Text style={styles.fine}>
          Your fingerprint or face never leaves your phone. The app only learns "yes" or "no" from the phone.
        </Text>
      </View>

      {/* ---------- Device key ---------- */}
      <Text style={styles.sectionLabel}>Device key</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{key.exists ? "Device key active" : "No device key yet"}</Text>
        <Text style={styles.cardBody}>
          A key pair made on this phone. Capsule owners can lock a capsule's passphrase to your public key, so you open it with your
          fingerprint instead of typing a passphrase. The private key never leaves this phone.
        </Text>

        {key.exists && (
          <>
            <View style={styles.fingerprintBox}>
              <Text style={styles.fingerprintLabel}>Your key fingerprint</Text>
              <Text style={styles.fingerprint}>{key.fingerprint}</Text>
              <Text style={styles.fine}>Owners should check this matches what they see before sharing a capsule with you.</Text>
            </View>
            <Text style={styles.cardBody}>{MODE_TEXT[key.mode] || MODE_TEXT.none}</Text>
            {!synced && serverKey !== undefined && (
              <View style={[styles.note, styles.noteWarn]}>
                <Ionicons name="warning" size={16} color="#b45309" />
                <Text style={[styles.noteText, styles.noteTextWarn]}>
                  The server doesn't have this phone's key, so owners can't share with you yet.
                </Text>
              </View>
            )}
          </>
        )}

        <View style={styles.buttons}>
          {!key.exists ? (
            <Pressable style={[styles.primary, busy && styles.dim]} onPress={onCreateKey} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Create device key</Text>}
            </Pressable>
          ) : (
            <>
              {!synced && serverKey !== undefined && (
                <Pressable style={[styles.primary, busy && styles.dim]} onPress={onResync} disabled={busy}>
                  <Text style={styles.primaryText}>Register this key with the server</Text>
                </Pressable>
              )}
              <Pressable style={[styles.secondary, busy && styles.dim]} onPress={confirmReplace} disabled={busy}>
                <Text style={styles.secondaryText}>Replace key</Text>
              </Pressable>
              <Pressable style={[styles.danger, busy && styles.dim]} onPress={onRemoveKey} disabled={busy}>
                <Text style={styles.dangerText}>Remove key</Text>
              </Pressable>
            </>
          )}
        </View>
        {!canLock && (
          <Text style={styles.fine}>Without a phone screen lock the key can still be created, but nothing will ask before it is used.</Text>
        )}
      </View>

      <Text style={styles.footer}>
        Keep your capsule passphrase safe even if you use device keys: if you lose this phone, the passphrase is the way back in.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { padding: 20, paddingBottom: 48 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10, marginTop: 8 },
  card: { backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 18, borderWidth: 1, borderColor: "#f1f5f9" },
  row: { flexDirection: "row", alignItems: "center" },
  rowText: { flex: 1, marginRight: 12 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  cardBody: { fontSize: 13, color: "#64748b", lineHeight: 19, marginTop: 4 },
  note: { flexDirection: "row", gap: 8, backgroundColor: "#f1f5f9", borderRadius: 10, padding: 10, marginTop: 12 },
  noteWarn: { backgroundColor: "#fffbeb" },
  noteText: { flex: 1, fontSize: 12.5, color: "#475569", lineHeight: 18 },
  noteTextWarn: { color: "#92400e" },
  fine: { fontSize: 11.5, color: "#94a3b8", lineHeight: 17, marginTop: 10 },
  fingerprintBox: { backgroundColor: "#f8fafc", borderRadius: 10, padding: 12, marginTop: 12, marginBottom: 8 },
  fingerprintLabel: { fontSize: 11, fontWeight: "700", color: "#64748b", textTransform: "uppercase" },
  fingerprint: { fontSize: 17, fontWeight: "700", color: "#0f172a", letterSpacing: 1, marginTop: 4, fontVariant: ["tabular-nums"] },
  buttons: { marginTop: 14, gap: 8 },
  primary: { backgroundColor: "#0f172a", borderRadius: 10, padding: 13, alignItems: "center" },
  primaryText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  secondary: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, padding: 12, alignItems: "center" },
  secondaryText: { color: "#374151", fontSize: 14, fontWeight: "600" },
  danger: { borderWidth: 1, borderColor: "#fecaca", borderRadius: 10, padding: 12, alignItems: "center" },
  dangerText: { color: "#ef4444", fontSize: 14, fontWeight: "600" },
  dim: { opacity: 0.6 },
  footer: { fontSize: 12, color: "#94a3b8", lineHeight: 18, textAlign: "center", marginTop: 4 },
});
