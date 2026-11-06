import React, { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { AuthLayout, CodeField, Button, LinkText } from "../components/ui";
import { colors, radius } from "../theme";

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
    <AuthLayout
      icon="mail-open"
      title="Check your inbox"
      subtitle="Enter the six-digit code we just emailed you."
      onBack={() => navigation.goBack()}
      footer={
        <LinkText prefix="Wrong address?" onPress={() => navigation.goBack()}>
          Go back
        </LinkText>
      }
    >
      <View style={styles.emailChip}>
        <Ionicons name="mail" size={15} color={colors.indigo} />
        <Text style={styles.email} numberOfLines={1}>
          {email}
        </Text>
      </View>
      <CodeField value={code} onChangeText={setCode} accessibilityLabel="Six-digit email verification code" autoFocus />
      <Button title="Confirm email" icon="checkmark" onPress={handleVerify} loading={loading} disabled={code.length !== 6} />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  emailChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 8,
    maxWidth: "100%",
    backgroundColor: colors.indigoSoft,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 22,
  },
  email: { fontSize: 14, fontWeight: "700", color: colors.indigoInk, flexShrink: 1 },
});
