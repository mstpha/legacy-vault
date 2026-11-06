import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Alert, Image, ScrollView } from "react-native";
import { useAuth } from "../context/AuthContext";
import { mfaSetupRequest, mfaConfirmRequest } from "../api/auth.api";
import { Card, CodeField, Button, Loading, Hero, Divider } from "../components/ui";
import { colors, radius } from "../theme";

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

  if (loading) return <Loading />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Hero
        icon="shield-checkmark"
        eyebrow="About a minute"
        title="Protect your vault"
        subtitle="After this, signing in needs your password and a code from your phone, so a stolen password alone isn't enough."
      />

      <Step n={1} title="Scan the QR code" text="Open Google Authenticator, Authy, or any TOTP app and scan this code." />
      <Card style={styles.qrCard}>
        {qrCodeDataUrl ? (
          <View style={styles.qrFrame}>
            <Image source={{ uri: qrCodeDataUrl }} style={styles.qrImage} />
          </View>
        ) : null}
        <Divider label="or enter this key manually" style={styles.divider} />
        <Text selectable style={styles.secret}>
          {secret}
        </Text>
      </Card>

      <Step n={2} title="Enter the code" text="Type the 6-digit code your app now shows." />
      <Card>
        <CodeField value={code} onChangeText={setCode} />
        <Button title="Confirm and enable" icon="shield-checkmark" onPress={onConfirm} disabled={code.length !== 6} loading={submitting} />
      </Card>
    </ScrollView>
  );
}

function Step({ n, title, text }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{n}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepText}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  container: { padding: 20, paddingTop: 4, paddingBottom: 48 },
  step: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12, marginTop: 10 },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  stepNumberText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  stepTitle: { fontSize: 15.5, fontWeight: "800", color: colors.ink },
  stepText: { fontSize: 13, color: colors.muted, marginTop: 2, lineHeight: 19 },
  qrCard: { alignItems: "center", marginBottom: 12 },
  qrFrame: {
    padding: 12,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: "#fff",
  },
  qrImage: { width: 200, height: 200 },
  divider: { alignSelf: "stretch" },
  secret: {
    fontFamily: "monospace",
    fontSize: 14,
    fontWeight: "700",
    color: colors.indigoInk,
    backgroundColor: colors.indigoSoft,
    borderWidth: 1,
    borderColor: colors.indigoLine,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    letterSpacing: 1.5,
    textAlign: "center",
  },
});
