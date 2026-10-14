import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import {
  LOCK_GRACE_MS,
  authenticate,
  getAuthCapability,
  isLockEnabled,
  onLockSettingChange,
  setLockEnabled,
} from "../utils/biometricLock";

// Wraps the signed-in part of the app. When the user has turned the app lock on, it:
//   - asks for fingerprint / face / PIN when the app starts and when it comes back after more
//     than LOCK_GRACE_MS in the background
//   - covers the screen while the app is in the background, so nothing shows in the app switcher
// It is drawn as an OVERLAY on top of the navigator (not instead of it), so the user's place
// in the app is kept. If the setting is off, or the phone has no screen lock, it does nothing.
export default function BiometricGate({ children }) {
  const { user, logout } = useAuth();
  const userId = user?.id;

  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(true); // starts locked until we know the setting
  const [ready, setReady] = useState(false); // false = still reading the setting: show a cover, never the app
  const [covered, setCovered] = useState(false);
  const [message, setMessage] = useState("");

  const backgroundedAt = useRef(null);
  const promptOpen = useRef(false);

  const unlock = useCallback(async () => {
    if (promptOpen.current) return;
    promptOpen.current = true;
    setMessage("");
    const success = await authenticate("Unlock Digital Legacy Vault");
    promptOpen.current = false;
    if (success) setLocked(false);
    else setMessage("Not unlocked. Try again, or log out.");
  }, []);

  // Read the setting on mount, and whenever it changes in Security settings.
  useEffect(() => {
    if (!userId) return undefined;
    let active = true;

    const apply = async (isOn) => {
      if (!isOn) {
        setEnabled(false);
        setLocked(false);
        setReady(true);
        return;
      }
      const capability = await getAuthCapability();
      if (!active) return;
      if (capability.kind === "none") {
        // The phone's screen lock was removed: the lock can't work. Switch it off instead of trapping the user.
        await setLockEnabled(userId, false).catch(() => {});
        setEnabled(false);
        setLocked(false);
        setReady(true);
        return;
      }
      setEnabled(true);
      setReady(true);
    };

    isLockEnabled(userId).then((isOn) => {
      if (!active) return;
      apply(isOn);
      // Settings changes made while the app is open (turning it on never locks you out mid-session).
    });
    const stop = onLockSettingChange((isOn) => {
      if (isOn) {
        setEnabled(true);
        setLocked(false);
      } else {
        setEnabled(false);
        setLocked(false);
      }
    });
    return () => {
      active = false;
      stop();
    };
  }, [userId]);

  // Prompt automatically whenever we become locked.
  useEffect(() => {
    if (enabled && locked) unlock();
  }, [enabled, locked, unlock]);

  // Lock after time in the background; cover the screen while away.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (promptOpen.current) return; // the system prompt itself makes the app "inactive": ignore that
      if (state === "active") {
        setCovered(false);
        if (enabled && backgroundedAt.current && Date.now() - backgroundedAt.current > LOCK_GRACE_MS) setLocked(true);
        backgroundedAt.current = null;
      } else {
        if (backgroundedAt.current === null) backgroundedAt.current = Date.now();
        if (enabled) setCovered(true);
      }
    });
    return () => subscription.remove();
  }, [enabled]);

  const showOverlay = !ready || (enabled && (locked || covered));

  return (
    <View style={styles.root}>
      {children}
      {showOverlay && (
        <View style={styles.overlay}>
          <View style={styles.iconCircle}>
            <Ionicons name="lock-closed" size={34} color="#fff" />
          </View>
          <Text style={styles.title}>Digital Legacy Vault</Text>
          {ready && locked ? (
            <>
              <Text style={styles.subtitle}>{message || "Locked. Use your fingerprint, face or phone PIN to continue."}</Text>
              <Pressable style={styles.button} onPress={unlock}>
                <Ionicons name="finger-print" size={20} color="#0f172a" />
                <Text style={styles.buttonText}>Unlock</Text>
              </Pressable>
              <Pressable style={styles.link} onPress={logout}>
                <Text style={styles.linkText}>Log out instead</Text>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator color="#94a3b8" style={{ marginTop: 20 }} />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    zIndex: 1000,
    elevation: 1000,
  },
  iconCircle: { width: 76, height: 76, borderRadius: 38, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  title: { color: "#fff", fontSize: 20, fontWeight: "700", marginTop: 18 },
  subtitle: { color: "#cbd5e1", fontSize: 14, textAlign: "center", marginTop: 8, lineHeight: 21 },
  button: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28, marginTop: 28 },
  buttonText: { color: "#0f172a", fontSize: 16, fontWeight: "700" },
  link: { marginTop: 18, padding: 8 },
  linkText: { color: "#94a3b8", fontSize: 13 },
});
