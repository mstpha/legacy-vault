import React, { useCallback, useState } from "react";
import { View, Text, Switch, StyleSheet, ActivityIndicator, Alert, ScrollView } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { listPermissionsRequest, setPermissionRequest } from "../api/permissions.api";
import { Banner, IconBadge, EmptyState, Loading, Hero, HeroStats, ProgressBar } from "../components/ui";
import { colors, radius, shadow } from "../theme";

const ROLES = {
  TESTATOR: { label: "Testator", icon: "archive", color: colors.ink },
  GUARANTOR: { label: "Guarantor", icon: "shield-checkmark", color: colors.indigo },
  BENEFICIARY: { label: "Beneficiary", icon: "gift", color: colors.sky },
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

  if (loading) return <Loading />;

  if (forbidden || !matrix) {
    return (
      <View style={styles.center}>
        <EmptyState icon="lock-closed" title="Admins only" text="Admin access required to view this page." />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Hero
        icon="key"
        eyebrow="Administration"
        title="Roles & permissions"
        subtitle="Switching a permission off blocks that action immediately for every user with that role. It's enforced on the server, not just hidden in the app."
      >
        <HeroStats
          items={Object.keys(matrix).map((role) => ({
            value: `${matrix[role].filter((p) => p.enabled).length}/${matrix[role].length}`,
            label: (ROLES[role] || { label: role }).label,
          }))}
        />
      </Hero>

      {Object.keys(matrix).map((role) => {
        const meta = ROLES[role] || { label: role, icon: "person", color: colors.muted };
        const items = matrix[role];
        const enabledCount = items.filter((p) => p.enabled).length;
        return (
          <View key={role} style={styles.group}>
            <View style={styles.groupHead}>
              <IconBadge name={meta.icon} color={meta.color} size={34} iconSize={17} />
              <Text style={styles.groupTitle}>{meta.label}</Text>
              <Text style={styles.groupCount}>
                {enabledCount}/{items.length} on
              </Text>
            </View>
            <ProgressBar value={enabledCount / Math.max(1, items.length)} color={meta.color} style={styles.groupBar} />
            <View style={styles.card}>
              {items.map((item, i) => {
                const key = `${role}:${item.permission}`;
                return (
                  <View key={key} style={[styles.row, i === items.length - 1 && styles.rowLast]}>
                    <View style={styles.rowText}>
                      <Text style={[styles.rowLabel, !item.enabled && styles.rowLabelOff]}>{item.label}</Text>
                      <Text style={styles.rowKey}>{item.permission}</Text>
                    </View>
                    {pendingKey === key ? (
                      <ActivityIndicator color={colors.ink} />
                    ) : (
                      <Switch
                        value={item.enabled}
                        onValueChange={(v) => onToggle(role, item.permission, v)}
                        trackColor={{ false: colors.line, true: colors.green }}
                        thumbColor="#fff"
                      />
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.canvas },
  container: { padding: 20, paddingTop: 4, paddingBottom: 48 },
  groupBar: { marginBottom: 12 },
  group: { marginTop: 18 },
  groupHead: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  groupTitle: { flex: 1, fontSize: 16.5, fontWeight: "800", color: colors.ink, marginLeft: 12 },
  groupCount: { fontSize: 12, fontWeight: "700", color: colors.faint },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: 16,
    ...shadow.card,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  rowLast: { borderBottomWidth: 0 },
  rowText: { flex: 1, paddingRight: 12 },
  rowLabel: { fontSize: 14, fontWeight: "600", color: colors.ink },
  rowLabelOff: { color: colors.faint },
  rowKey: { fontSize: 11, color: colors.faint, marginTop: 2, fontFamily: "monospace" },
});
