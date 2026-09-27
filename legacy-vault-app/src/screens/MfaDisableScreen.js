import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { useAuth } from "../context/AuthContext";
import { mfaDisableRequest } from "../api/auth.api";

export default function MfaDisableScreen({ navigation }) {
  const { refreshMe, applyAccessToken } = useAuth();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    setSubmitting(true);
    try {
      const result = await mfaDisableRequest(code.trim());
      if (result.accessToken) {
        await applyAccessToken(result.accessToken);
      }
      await refreshMe();
      Alert.alert("Two-factor disabled", "Your account no longer requires an authenticator code to log in.", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert("Invalid code", err.response?.data?.error?.message || "Please check the code and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Disable two-factor authentication</Text>
      <Text style={styles.subtitle}>
        Enter the current 6-digit code from your authenticator app to confirm you want to turn this off.
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
        <Pressable
          style={[styles.button, code.length !== 6 && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={code.length !== 6}
        >
          <Text style={styles.buttonText}>Confirm and disable</Text>
        </Pressable>
      )}

      <Text style={styles.link} onPress={() => navigation.goBack()}>
        Cancel
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 20, fontWeight: "700", textAlign: "center" },
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
  button: { backgroundColor: "#ef4444", borderRadius: 10, padding: 14, alignItems: "center", marginTop: 8 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { marginTop: 20, color: "#2563eb", textAlign: "center", fontSize: 14 },
});