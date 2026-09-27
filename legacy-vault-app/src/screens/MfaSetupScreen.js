import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator, Image, ScrollView } from "react-native";
import { useAuth } from "../context/AuthContext";
import { mfaSetupRequest, mfaConfirmRequest } from "../api/auth.api";

export default function MfaSetupScreen({ navigation }) {
  const { refreshMe, applyAccessToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [secret, setSecret] = useState(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const result = await mfaSetupRequest();
        setSecret(result.secret);
        setQrCodeDataUrl(result.qrCodeDataUrl);
      } catch (err) {
        Alert.alert("Error", "Could not start MFA setup. Please try again.");
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onConfirm = async () => {
    setSubmitting(true);
    try {
      const result = await mfaConfirmRequest(code.trim());
      if (result.accessToken) {
        await applyAccessToken(result.accessToken);
      }
      await refreshMe();
      Alert.alert("Two-factor enabled", "Your account is now protected with an authenticator code.", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert("Invalid code", err.response?.data?.error?.message || "Please check the code and try again.");

    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Scan this QR code</Text>
      <Text style={styles.subtitle}>Use Google Authenticator, Authy, or any TOTP app.</Text>

      {qrCodeDataUrl ? <Image source={{ uri: qrCodeDataUrl }} style={styles.qrImage} /> : null}

      <Text style={styles.orText}>— or enter this key manually —</Text>
      <Text selectable style={styles.secret}>
        {secret}
      </Text>

      <Text style={styles.subtitle}>Then enter the 6-digit code it generates to confirm:</Text>
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
        <Pressable style={[styles.button, code.length !== 6 && styles.buttonDisabled]} onPress={onConfirm} disabled={code.length !== 6}>
          <Text style={styles.buttonText}>Confirm and enable</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { flexGrow: 1, alignItems: "center", padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 20, fontWeight: "700", marginTop: 12 },
  subtitle: { fontSize: 14, color: "#666", textAlign: "center", marginVertical: 12 },
  qrImage: { width: 220, height: 220, marginVertical: 8 },
  orText: { fontSize: 12, color: "#999", marginTop: 16 },
  secret: {
    fontFamily: "monospace",
    fontSize: 14,
    backgroundColor: "#f3f4f6",
    padding: 10,
    borderRadius: 8,
    marginTop: 6,
    marginBottom: 8,
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
    marginBottom: 12,
    fontSize: 20,
    textAlign: "center",
    letterSpacing: 6,
  },
  button: { width: "100%", backgroundColor: "#0f172a", borderRadius: 10, padding: 14, alignItems: "center" },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});