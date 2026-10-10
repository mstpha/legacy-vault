import React, { useCallback, useState } from "react";
import { View, Text, Switch, StyleSheet, ActivityIndicator, Alert, SectionList } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { listPermissionsRequest, setPermissionRequest } from "../api/permissions.api";

const ROLE_LABELS = {
  TESTATOR: "Testator",
  GUARANTOR: "Guarantor",
  BENEFICIARY: "Beneficiary",
};

export default function PermissionsScreen() {
  const [matrix, setMatrix] = useState(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [pendingKey, setPendingKey] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await listPermissionsRequest();
      setMatrix(data);
    } catch (err) {
      if (err.response?.status === 403) {
        setForbidden(true);
      } else {
        Alert.alert("Error", "Could not load the permissions matrix.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onToggle = async (role, permission, nextEnabled) => {
    const key = `${role}:${permission}`;
    setPendingKey(key);
    // Optimistic update, rolled back on failure.
    setMatrix((prev) => ({
      ...prev,
      [role]: prev[role].map((p) => (p.permission === permission ? { ...p, enabled: nextEnabled } : p)),
    }));
    try {
      await setPermissionRequest(role, permission, nextEnabled);
    } catch (err) {
      Alert.alert("Error", "Could not update this permission. Reverting.");
      await load();
    } finally {
      setPendingKey(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (forbidden || !matrix) {
    return (
      <View style={styles.center}>
        <Text style={styles.forbiddenText}>Admin access required to view this page.</Text>
      </View>
    );
  }

  const sections = Object.keys(matrix).map((role) => ({
    title: ROLE_LABELS[role] || role,
    role,
    data: matrix[role],
  }));

  return (
    <SectionList
      contentContainerStyle={styles.container}
      sections={sections}
      keyExtractor={(item) => `${item.role}:${item.permission}`}
      renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
      renderItem={({ item, section }) => {
        const key = `${section.role}:${item.permission}`;
        return (
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{item.label}</Text>
              <Text style={styles.rowKey}>{item.permission}</Text>
            </View>
            {pendingKey === key ? (
              <ActivityIndicator />
            ) : (
              <Switch value={item.enabled} onValueChange={(v) => onToggle(section.role, item.permission, v)} />
            )}
          </View>
        );
      }}
      ListHeaderComponent={
        <Text style={styles.intro}>
          Turning a permission off blocks that action immediately, for every user holding that role — it's
          enforced server-side, not just hidden in the app.
        </Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  forbiddenText: { color: "#666", fontSize: 14, textAlign: "center" },
  container: { padding: 20, paddingBottom: 48 },
  intro: { fontSize: 13, color: "#666", marginBottom: 16, lineHeight: 18 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: "700",
    color: "#374151",
    textTransform: "uppercase",
    marginTop: 20,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f3f4f6",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  rowText: { flex: 1, paddingRight: 12 },
  rowLabel: { fontSize: 14, fontWeight: "600" },
  rowKey: { fontSize: 11, color: "#999", marginTop: 2, fontFamily: "monospace" },
});
