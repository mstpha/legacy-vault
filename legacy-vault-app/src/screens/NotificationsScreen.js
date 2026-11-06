import React, { useCallback, useLayoutEffect, useState } from "react";
import { View, Text, SectionList, Pressable, StyleSheet, RefreshControl, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import {
  listNotificationsRequest,
  markNotificationReadRequest,
  markAllNotificationsReadRequest,
} from "../api/notification.api";
import { checkBlockedPermission } from "../api/permissionCheck.api";
import { EmptyState, Loading } from "../components/ui";
import { colors, radius, shadow } from "../theme";

const TONES = {
  info: { bg: "#eff6ff", fg: "#3b82f6" },
  warning: { bg: "#fffbeb", fg: "#d97706" },
  action: { bg: "#eef2ff", fg: "#6366f1" },
  success: { bg: "#f0fdf4", fg: "#16a34a" },
  danger: { bg: "#fef2f2", fg: "#ef4444" },
};

const ICONS = {
  GUARANTOR_ASSIGNED: "shield-checkmark",
  BENEFICIARY_ASSIGNED: "gift",
  INACTIVITY_ALERT: "time",
  VALIDATION_REQUEST: "checkmark-done-circle",
  VALIDATION_RECEIVED: "checkmark-circle",
  CAPSULE_UNLOCKED: "lock-open",
  CAPSULE_ACCESS_ATTEMPT: "warning",
  CAPSULE_REVOKED: "trash",
};

// These notifications only ever go to guarantors, so opening them needs "view capsules they guarantee".
const GUARANTOR_TYPES = new Set(["GUARANTOR_ASSIGNED", "VALIDATION_REQUEST"]);

function timeAgo(iso) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationsScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listNotificationsRequest();
      setItems(data.notifications);
      setFailed(false);
    } catch (err) {
      setFailed(true);
    } finally {
      setLoading(false);
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

  const unreadCount = items.filter((n) => !n.read).length;

  const onMarkAll = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await markAllNotificationsReadRequest();
    } catch (err) {
      load();
    }
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={onMarkAll}
          disabled={unreadCount === 0}
          hitSlop={10}
          style={[styles.headerAction, unreadCount === 0 && styles.headerActionDisabled]}
        >
          <Ionicons name="checkmark-done" size={15} color={unreadCount === 0 ? colors.ghost : colors.indigo} />
          <Text style={[styles.headerActionText, unreadCount === 0 && styles.headerActionTextDisabled]}>Read all</Text>
        </Pressable>
      ),
    });
  }, [navigation, unreadCount]);

  const onPressItem = async (item) => {
    if (!item.read) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
      markNotificationReadRequest(item.id).catch(() => {});
    }
    if (!item.capsuleId) return;

    if (item.target === "owner") {
      navigation.navigate("CapsuleDetail", { capsuleId: item.capsuleId });
      return;
    }

    // Check BEFORE navigating, so a disabled permission shows a message instead of opening the capsule.
    if (GUARANTOR_TYPES.has(item.type)) {
      const blocked = await checkBlockedPermission("GUARANTOR", ["capsule.view_assigned"]);
      if (blocked) return Alert.alert("Not available", blocked);
    }
    navigation.navigate("SharedCapsule", { capsuleId: item.capsuleId });
  };

  if (loading) return <Loading />;

  const sections = [
    { title: "New", data: items.filter((n) => !n.read) },
    { title: "Earlier", data: items.filter((n) => n.read) },
  ].filter((s) => s.data.length > 0);

  return (
    <SectionList
      style={styles.screen}
      contentContainerStyle={items.length === 0 ? styles.emptyContainer : styles.container}
      sections={sections}
      keyExtractor={(n) => n.id}
      stickySectionHeadersEnabled={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={
        <EmptyState
          icon={failed ? "cloud-offline-outline" : "notifications-off-outline"}
          title={failed ? "Couldn't load notifications" : "You're all caught up"}
          text={
            failed
              ? "Pull down to try again."
              : "Alerts about your capsules, guarantor requests and unlocks will show up here."
          }
        />
      }
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHead}>
          <Text style={styles.sectionLabel}>{section.title}</Text>
          {section.title === "New" && (
            <View style={styles.newCount}>
              <Text style={styles.newCountText}>{section.data.length}</Text>
            </View>
          )}
        </View>
      )}
      renderItem={({ item }) => {
        const tone = TONES[item.tone] || TONES.info;
        return (
          <Pressable
            style={({ pressed }) => [styles.card, !item.read && styles.cardUnread, pressed && styles.cardPressed]}
            onPress={() => onPressItem(item)}
          >
            <View style={[styles.iconBadge, { backgroundColor: tone.bg }]}>
              <Ionicons name={ICONS[item.type] || "notifications"} size={20} color={tone.fg} />
            </View>
            <View style={styles.cardBody}>
              <View style={styles.titleRow}>
                <Text style={[styles.title, !item.read && styles.titleUnread]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
              </View>
              <Text style={styles.message}>{item.message}</Text>
              {item.capsuleId && (
                <View style={styles.openRow}>
                  <Text style={[styles.openText, { color: tone.fg }]}>View capsule</Text>
                  <Ionicons name="arrow-forward" size={12} color={tone.fg} />
                </View>
              )}
            </View>
            {!item.read && <View style={styles.dot} />}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  container: { padding: 20, paddingTop: 4, paddingBottom: 40 },
  emptyContainer: { flexGrow: 1, justifyContent: "center" },

  headerAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.indigoSoft,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  headerActionDisabled: { backgroundColor: colors.hairline },
  headerActionText: { color: colors.indigo, fontSize: 13, fontWeight: "800" },
  headerActionTextDisabled: { color: colors.ghost },

  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, marginBottom: 10 },
  sectionLabel: { fontSize: 12, fontWeight: "800", color: colors.faint, textTransform: "uppercase", letterSpacing: 0.8 },
  newCount: { backgroundColor: colors.indigo, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 },
  newCountText: { color: "#fff", fontSize: 11, fontWeight: "800" },

  card: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...shadow.card,
  },
  cardUnread: { borderColor: colors.indigoLine, backgroundColor: "#fbfbff" },
  cardPressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  iconBadge: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  cardBody: { flex: 1, marginLeft: 12 },
  titleRow: { flexDirection: "row", alignItems: "center" },
  title: { flex: 1, fontSize: 14.5, fontWeight: "600", color: colors.text },
  titleUnread: { color: colors.ink, fontWeight: "800" },
  time: { fontSize: 11, color: colors.faint, marginLeft: 8, fontWeight: "600" },
  message: { fontSize: 13, color: colors.body, marginTop: 3, lineHeight: 19 },
  openRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  openText: { fontSize: 12.5, fontWeight: "800" },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.indigo, marginLeft: 8, marginTop: 4 },
});
