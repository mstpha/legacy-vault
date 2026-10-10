import React, { useCallback, useLayoutEffect, useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, ActivityIndicator, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import {
  listNotificationsRequest,
  markNotificationReadRequest,
  markAllNotificationsReadRequest,
} from "../api/notification.api";
import { checkBlockedPermission } from "../api/permissionCheck.api";

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
        <Pressable onPress={onMarkAll} disabled={unreadCount === 0} hitSlop={10}>
          <Text style={[styles.headerAction, unreadCount === 0 && styles.headerActionDisabled]}>Mark all read</Text>
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={items.length === 0 ? styles.emptyContainer : styles.container}
      data={items}
      keyExtractor={(n) => n.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons name={failed ? "cloud-offline-outline" : "notifications-off-outline"} size={44} color="#cbd5e1" />
          <Text style={styles.emptyTitle}>{failed ? "Couldn't load notifications" : "You're all caught up"}</Text>
          <Text style={styles.emptyText}>
            {failed
              ? "Pull down to try again."
              : "Alerts about your capsules, guarantor requests and unlocks will show up here."}
          </Text>
        </View>
      }
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
                {!item.read && <View style={styles.dot} />}
              </View>
              <Text style={styles.message}>{item.message}</Text>
              <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
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
  container: { padding: 16, paddingBottom: 40 },
  emptyContainer: { flexGrow: 1, justifyContent: "center" },
  empty: { alignItems: "center", paddingHorizontal: 40 },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: "#0f172a", marginTop: 14 },
  emptyText: { fontSize: 13, color: "#64748b", textAlign: "center", marginTop: 6, lineHeight: 19 },
  headerAction: { color: "#0f172a", fontSize: 14, fontWeight: "600" },
  headerActionDisabled: { color: "#cbd5e1" },
  card: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#f1f5f9",
  },
  cardUnread: { borderColor: "#c7d2fe", backgroundColor: "#fcfcff" },
  cardPressed: { opacity: 0.7 },
  iconBadge: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardBody: { flex: 1, marginLeft: 12 },
  titleRow: { flexDirection: "row", alignItems: "center" },
  title: { flex: 1, fontSize: 15, fontWeight: "600", color: "#334155" },
  titleUnread: { color: "#0f172a", fontWeight: "700" },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#6366f1", marginLeft: 8 },
  message: { fontSize: 13, color: "#475569", marginTop: 3, lineHeight: 19 },
  time: { fontSize: 11, color: "#94a3b8", marginTop: 6 },
});