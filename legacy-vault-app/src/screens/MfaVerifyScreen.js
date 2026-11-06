import React, { useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";
import { useAuth } from "../context/AuthContext";
import { AuthLayout, CodeField, Button, LinkText } from "../components/ui";
import { colors } from "../theme";

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
    <AuthLayout
      icon="shield-checkmark"
      title="Two-factor check"
      subtitle={`Open your authenticator app and enter the 6-digit code${mfaPendingEmail ? ` for ${mfaPendingEmail}` : ""}.`}
      onBack={onCancel}
      footer={<LinkText onPress={onCancel}>Cancel and go back</LinkText>}
    >
      <CodeField value={code} onChangeText={setCode} autoFocus />
      <Button title="Verify" icon="shield-checkmark" onPress={onSubmit} disabled={code.length !== 6} loading={submitting} />
      <Text style={styles.fine}>Codes refresh every 30 seconds.</Text>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  fine: { fontSize: 12, color: colors.faint, textAlign: "center", marginTop: 12 },
});
