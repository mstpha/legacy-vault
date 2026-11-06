import React, { useState } from "react";
import { View, Text, StyleSheet, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { AuthLayout, Field, Button, LinkText, Divider } from "../components/ui";
import { colors } from "../theme";

const PROMISES = [
  ["lock-closed", "Encrypted on your phone"],
  ["people", "Released by guarantors"],
  ["finger-print", "Opened with biometrics"],
];

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
    <AuthLayout
      icon="archive"
      title="Welcome back"
      subtitle="Sign in to manage what you leave behind."
      footer={
        <>
          <LinkText prefix="New to the vault?" onPress={() => navigation.navigate("Register")}>
            Create an account
          </LinkText>
          <Divider style={styles.divider} />
          <View style={styles.promises}>
            {PROMISES.map(([icon, label]) => (
              <View key={label} style={styles.promise}>
                <View style={styles.promiseIcon}>
                  <Ionicons name={icon} size={16} color={colors.indigo} />
                </View>
                <Text style={styles.promiseText}>{label}</Text>
              </View>
            ))}
          </View>
        </>
      }
    >
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
        placeholder="Your password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={() => email && password && onSubmit()}
      />
      <Button
        title="Log in"
        icon="arrow-forward"
        onPress={onSubmit}
        disabled={!email || !password}
        loading={submitting}
        style={styles.button}
      />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  button: { marginTop: 6 },
  divider: { marginTop: 24, marginBottom: 18 },
  promises: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  promise: { flex: 1, alignItems: "center" },
  promiseIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.indigoSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  promiseText: { fontSize: 11.5, color: colors.muted, textAlign: "center", marginTop: 6, lineHeight: 15, fontWeight: "600" },
});
