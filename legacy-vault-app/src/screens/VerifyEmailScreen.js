
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "../context/AuthContext";

export default function VerifyEmailScreen({ route, navigation }) {
  const email = route.params?.email || "";
  const { verifyEmail } = useAuth();

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleVerify = async () => {
    if (!/^\d{6}$/.test(code)) {
      Alert.alert("Invalid code", "Enter the six-digit code from your email.");
      return;
    }

    try {
      setLoading(true);
      const result = await verifyEmail({ email, code });

      Alert.alert(
        "Email verified",
        result.message || "You can now log in.",
        [{ text: "Continue", onPress: () => navigation.replace("Login") }]
      );
    } catch (error) {
      const message =
        error.response?.data?.message ||
        error.response?.data?.error?.message ||
        "Invalid or expired code. Please try again.";

      Alert.alert("Verification failed", message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Verify your email</Text>
      <Text style={styles.description}>
        Enter the six-digit code sent to {email}.
      </Text>

      <TextInput
        style={styles.input}
        value={code}
        onChangeText={(value) =>
          setCode(value.replace(/\D/g, "").slice(0, 6))
        }
        keyboardType="number-pad"
        maxLength={6}
        placeholder="000000"
        accessibilityLabel="Six-digit email verification code"
      />

      <Pressable
        style={[styles.button, loading && styles.disabled]}
        onPress={handleVerify}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Confirm email</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    color: "#555",
    marginBottom: 24,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    padding: 14,
    fontSize: 24,
    textAlign: "center",
    letterSpacing: 8,
    marginBottom: 20,
  },
  button: {
    backgroundColor: "#2347D8",
    borderRadius: 10,
    padding: 16,
    alignItems: "center",
  },
  disabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
