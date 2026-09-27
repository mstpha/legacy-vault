import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useAuth } from "../context/AuthContext";

export default function HomeScreen({ navigation }) {
  const { user, logout } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome{user?.fullName ? `, ${user.fullName}` : ""}</Text>

      <View style={styles.card}>
        <Row label="Email" value={user?.email} />
        <Row label="Two-factor auth" value={user?.mfaEnabled ? "Enabled" : "Not enabled"} />
      </View>

      {user?.mfaEnabled ? (
        <Pressable style={[styles.button, styles.disableButton]} onPress={() => navigation.navigate("MfaDisable")}>
          <Text style={[styles.buttonText, styles.disableText]}>Disable two-factor authentication</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.button} onPress={() => navigation.navigate("MfaSetup")}>
          <Text style={styles.buttonText}>Enable two-factor authentication</Text>
        </Pressable>
      )}

      <Pressable style={[styles.button, styles.logoutButton]} onPress={logout}>
        <Text style={[styles.buttonText, styles.logoutText]}>Log out</Text>
      </Pressable>

      <Text style={styles.note}>
        This is the Sprint 1 slice: authentication only. Capsule creation, guarantors, and
        beneficiary access land in later sprints.
      </Text>
    </View>
  );
}

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 20 },
  card: { backgroundColor: "#f3f4f6", borderRadius: 12, padding: 16, marginBottom: 20 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  rowLabel: { color: "#666" },
  rowValue: { fontWeight: "600" },
  button: { backgroundColor: "#0f172a", borderRadius: 10, padding: 14, alignItems: "center", marginBottom: 12 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  logoutButton: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#ef4444" },
  logoutText: { color: "#ef4444" },
  disableButton: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#d1d5db" },
  disableText: { color: "#374151" },
  note: { marginTop: 24, fontSize: 12, color: "#999", textAlign: "center" },
});