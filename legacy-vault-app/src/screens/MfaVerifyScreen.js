import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { useAuth } from "../context/AuthContext";

export default function MfaVerifyScreen({ navigation }) {
  const { mfaPendingEmail, submitMfaCode, cancelMfaLogin } = useAuth();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    setSubmitting(true);
    try {
      await submitMfaCode(code.trim());
      // Success flips isAuthenticated true and RootNavigator swaps stacks automatically.
    } catch (err) {
      Alert.alert("Verification failed", err.response?.data?.error?.message || "Invalid code, try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const onCancel = () => {
    cancelMfaLogin();
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Two-factor verification</Text>
      <Text style={styles.subtitle}>
        Enter the 6-digit code from your authenticator app{mfaPendingEmail ? ` for ${mfaPendingEmail}` : ""}.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="123456"
        keyboardType="number-pad"
        maxLength={6}
        value={code}
        onChangeText={setCode}
      />

      {submitting ? (
        <ActivityIndicator style={styles.button} />
      ) : (
        <Pressable style={[styles.button, code.length !== 6 && styles.buttonDisabled]} onPress={onSubmit} disabled={code.length !== 6}>
          <Text style={styles.buttonText}>Verify</Text>
        </Pressable>
      )}

      <Text style={styles.link} onPress={onCancel}>
        Cancel
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  subtitle: { fontSize: 14, color: "#666", textAlign: "center", marginTop: 8, marginBottom: 28 },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    fontSize: 20,
    textAlign: "center",
    letterSpacing: 6,
  },
  button: { backgroundColor: "#0f172a", borderRadius: 10, padding: 14, alignItems: "center", marginTop: 8 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { marginTop: 20, color: "#2563eb", textAlign: "center", fontSize: 14 },
});
