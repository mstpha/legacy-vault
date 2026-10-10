import React, { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { listCapsulesRequest } from "../api/capsule.api";

// One screen, two portals: the navigator passes route.params.role = "guarantor" | "beneficiary".
const STATE_LABELS = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  INACTIVITY_ALERT: "Inactivity alert",
  PENDING_VALIDATION: "Pending validation",
  UNLOCKED: "Unlocked",
  ARCHIVED: "Opened",
  REVOKED: "Revoked",
};

const STATE_COLORS = {
  DRAFT: "#64748b",
  ACTIVE: "#16a34a",
  INACTIVITY_ALERT: "#d97706",
  PENDING_VALIDATION: "#6366f1",
  UNLOCKED: "#0ea5e9",
  ARCHIVED: "#64748b",
  REVOKED: "#ef4444",
};

const PORTALS = {
  guarantor: {
    title: "Guarantor portal",
    intro: "Capsules where you're named as a guarantor. You're only asked to act when an owner stays inactive.",
    icon: "shield-checkmark",
    actionState: "PENDING_VALIDATION",
    actionLabel: "Validation needed",
    actionSummary: (n) => `${n} capsule${n > 1 ? "s" : ""} waiting for your validation`,
    empty: "You haven't been named as a guarantor on any capsule yet.",
    listKey: "asGuarantor",
  },
  beneficiary: {
    title: "Beneficiary portal",
    intro: "Capsules left to you. Once one is unlocked you can read it as often as you like.",
    icon: "gift",
    actionState: "UNLOCKED",
    actionLabel: "Ready to open",
    actionSummary: (n) => `${n} capsule${n > 1 ? "s" : ""} ready to open`,
    empty: "You haven't been named as a beneficiary on any capsule yet.",
    listKey: "asBeneficiary",
  },
};

export default function PortalScreen({ route, navigation }) {
  const portal = PORTALS[route.params?.role] || PORTALS.guarantor;
  const [data, setData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await listCapsulesRequest());
      setFailed(false);
    } catch (err) {
      setFailed(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (!data && !failed) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Capsules that need the user come first.
  const capsules = [...(data?.[portal.listKey] || [])].sort(
    (a, b) => Number(b.state === portal.actionState) - Number(a.state === portal.actionState)
  );
  const blockedMessage = route.params?.role === "guarantor" ? data?.blocked?.guarantor : null;
  const actionCount = capsules.filter((c) => c.state === portal.actionState).length;

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.container}
      data={blockedMessage ? [] : capsules}
      keyExtractor={(c) => c.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Ionicons name={portal.icon} size={22} color="#fff" />
          </View>
          <Text style={styles.intro}>{portal.intro}</Text>
          {actionCount > 0 && !blockedMessage && (
            <View style={styles.actionBanner}>
              <Ionicons name="alert-circle" size={18} color="#4338ca" />
              <Text style={styles.actionBannerText}>{portal.actionSummary(actionCount)}</Text>
            </View>
          )}
        </View>
      }
      ListEmptyComponent={
        blockedMessage ? (
          <Text style={styles.blocked}>🔒 {blockedMessage}</Text>
        ) : (
          <Text style={styles.empty}>{failed ? "Couldn't load your capsules. Pull down to retry." : portal.empty}</Text>
        )
      }
      renderItem={({ item }) => {
        const needsAction = item.state === portal.actionState;
        return (
          <Pressable
            style={({ pressed }) => [styles.card, needsAction && styles.cardAction, pressed && styles.pressed]}
            onPress={() => navigation.navigate("SharedCapsule", { capsuleId: item.id })}
          >
            <View style={styles.cardTop}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
            </View>
            <Text style={styles.owner}>Owner: {item.testator?.fullName || "—"}</Text>
            <View style={styles.pillRow}>
              <View style={[styles.pill, { backgroundColor: STATE_COLORS[item.state] || "#64748b" }]}>
                <Text style={styles.pillText}>{STATE_LABELS[item.state] || item.state}</Text>
              </View>
              {needsAction && (
                <View style={styles.actionPill}>
                  <Text style={styles.actionPillText}>{portal.actionLabel}</Text>
                </View>
              )}
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { padding: 20, paddingBottom: 48 },
  header: { marginBottom: 18 },
  headerIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" },
  intro: { fontSize: 14, color: "#475569", lineHeight: 21, marginTop: 12 },
  actionBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#eef2ff", borderRadius: 10, padding: 12, marginTop: 14 },
  actionBannerText: { color: "#4338ca", fontSize: 13, fontWeight: "600", flex: 1 },
  empty: { color: "#94a3b8", fontSize: 14, fontStyle: "italic", textAlign: "center", marginTop: 24 },
  blocked: { color: "#b91c1c", backgroundColor: "#fef2f2", borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: "#f1f5f9" },
  cardAction: { borderColor: "#c7d2fe", backgroundColor: "#fcfcff" },
  pressed: { opacity: 0.7 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: "#0f172a", marginRight: 8 },
  owner: { fontSize: 13, color: "#64748b", marginTop: 4 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  pill: { borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  pillText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  actionPill: { borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10, backgroundColor: "#6366f1" },
  actionPillText: { color: "#fff", fontSize: 11, fontWeight: "700" },
});
