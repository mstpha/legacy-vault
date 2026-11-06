import React, { useState } from "react";
import { View, Text, StyleSheet, Alert, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { mfaDisableRequest } from "../api/auth.api";
import { Card, CodeField, Button, IconBadge } from "../components/ui";
import { colors, radius } from "../theme";

const LOSES = [
  "A stolen password is enough to sign in",
  "Your capsules lose an extra layer of protection",
];

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
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.statusCard}>
        <IconBadge name="shield-checkmark" color={colors.green} size={56} iconSize={28} />
        <Text style={styles.statusTitle}>Two-factor is on</Text>
        <Text style={styles.statusText}>Your account is protected by an authenticator code.</Text>
      </View>

      <Text style={styles.heading}>Turning it off means</Text>
      <View style={styles.loses}>
        {LOSES.map((line) => (
          <View key={line} style={styles.loseRow}>
            <Ionicons name="close-circle" size={18} color={colors.red} />
            <Text style={styles.loseText}>{line}</Text>
          </View>
        ))}
      </View>

      <Card>
        <Text style={styles.label}>Enter your current 6-digit code to confirm</Text>
        <CodeField value={code} onChangeText={setCode} />
        <Button title="Turn off two-factor" variant="dangerSolid" onPress={onSubmit} disabled={code.length !== 6} loading={submitting} />
        <Button title="Keep it on" variant="ghost" onPress={() => navigation.goBack()} style={styles.cancel} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  container: { padding: 20, paddingTop: 8, paddingBottom: 48 },
  statusCard: {
    alignItems: "center",
    backgroundColor: colors.greenSoft,
    borderWidth: 1,
    borderColor: "#bbf7d0",
    borderRadius: radius.xl,
    padding: 22,
  },
  statusTitle: { fontSize: 19, fontWeight: "800", color: colors.ink, marginTop: 12 },
  statusText: { fontSize: 13.5, color: colors.greenInk, marginTop: 4, textAlign: "center" },
  heading: { fontSize: 15, fontWeight: "800", color: colors.ink, marginTop: 22, marginBottom: 10 },
  loses: { gap: 10, marginBottom: 18 },
  loseRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  loseText: { flex: 1, fontSize: 13.5, color: colors.body },
  label: { fontSize: 13, fontWeight: "700", color: colors.text, marginBottom: 12, textAlign: "center" },
  cancel: { marginTop: 4 },
});
