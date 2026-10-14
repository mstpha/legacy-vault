import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { useAuth } from "../context/AuthContext";

export default function LoginScreen({ navigation }) {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    setSubmitting(true);
    try {
      const result = await login({ email: email.trim().toLowerCase(), password });
      if (result.mfaRequired) {
        navigation.navigate("MfaVerify");
      }
      // If MFA isn't required, isAuthenticated flips to true and RootNavigator
      // swaps to the app stack automatically — no manual navigation needed.


    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;

      console.log("Login failed:", status, data);

      const errorMessage =
        data?.error?.message ||
        data?.message ||
        "";

      if (status === 403 && errorMessage === "EMAIL_NOT_VERIFIED") {
        navigation.navigate("VerifyEmail", {
          email: email.trim().toLowerCase(),
        });
        return;
      }

      Alert.alert(
        "Login failed",
        errorMessage || "Something went wrong. Please try again."
      );
    } finally {
      setSubmitting(false);
    }

  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Digital Legacy Vault</Text>
      <Text style={styles.subtitle}>Sign in to your account</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {submitting ? (
        <ActivityIndicator style={styles.button} />
      ) : (
        <Pressable
          style={[styles.button, (!email || !password) && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={!email || !password}
        >
          <Text style={styles.buttonText}>Log in</Text>
        </Pressable>
      )}

      <Text style={styles.link} onPress={() => navigation.navigate("Register")}>
        No account yet? Register
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 26, fontWeight: "700", textAlign: "center" },
  subtitle: { fontSize: 14, color: "#666", textAlign: "center", marginBottom: 28 },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#0f172a",
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { marginTop: 20, color: "#2563eb", textAlign: "center", fontSize: 14 },
});
