import React, { useState } from "react";
import { View, Text, StyleSheet, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { AuthLayout, Field, Button, LinkText, ProgressBar } from "../components/ui";
import { colors } from "../theme";

export default function RegisterScreen({ navigation }) {
  const { register } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = fullName.trim().length >= 2 && email.trim() && password.length >= 10;
  // 0..1 progress towards the 10-character minimum, shown as a small meter.
  const strength = Math.min(password.length / 10, 1);
  const longEnough = password.length >= 10;

  const onSubmit = async () => {
    const normalizedEmail = email.trim().toLowerCase();

    setSubmitting(true);
    try {
      await register({ email: email.trim().toLowerCase(), password, fullName: fullName.trim() });
      navigation.navigate("VerifyEmail", {
        email: normalizedEmail,
      });
    } catch (err) {
      const details = err.response?.data?.error?.details;
      const message =
        err.response?.data?.error?.message ||
        (details ? JSON.stringify(details) : "Something went wrong. Please try again.");
      Alert.alert("Registration failed", message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      icon="person-add"
      title="Create your vault"
      subtitle="It takes less than a minute."
      onBack={() => navigation.goBack()}
      footer={
        <LinkText prefix="Already have an account?" onPress={() => navigation.goBack()}>
          Log in
        </LinkText>
      }
    >
      <Field label="Full name" icon="person-outline" placeholder="Jane Doe" value={fullName} onChangeText={setFullName} />
      <Field
        label="Email"
        icon="mail-outline"
        placeholder="you@example.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Field
        label="Password"
        icon="lock-closed-outline"
        placeholder="At least 10 characters"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={styles.passwordField}
      />
      <ProgressBar value={strength} color={longEnough ? colors.green : colors.amber} height={5} />
      <View style={styles.meterRow}>
        <Ionicons
          name={longEnough ? "checkmark-circle" : "ellipse-outline"}
          size={14}
          color={longEnough ? colors.green : colors.faint}
        />
        <Text style={[styles.meterText, longEnough && styles.meterTextOk]}>
          {longEnough
            ? "Password is long enough"
            : `${10 - password.length} more character${10 - password.length === 1 ? "" : "s"} needed`}
        </Text>
      </View>

      <Button title="Create account" onPress={onSubmit} disabled={!canSubmit} loading={submitting} style={styles.button} />
      <Text style={styles.fine}>We'll email you a six-digit code to verify your address.</Text>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  passwordField: { marginBottom: 10 },
  meterRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  meterText: { fontSize: 12.5, color: colors.faint, fontWeight: "600" },
  meterTextOk: { color: colors.greenInk },
  button: { marginTop: 22 },
  fine: { fontSize: 12, color: colors.faint, textAlign: "center", marginTop: 12 },
});
