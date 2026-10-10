import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { unreadCountRequest } from "../api/notification.api";

// Lives in the Home screen's header (top right). Refreshes the unread count whenever
// the screen comes back into focus, and every 45 seconds while the app is open.
export default function NotificationBell({ navigation }) {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setUnread(await unreadCountRequest());
    } catch (err) {
      // Silent: a failed badge refresh shouldn't bother the user.
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = navigation.addListener("focus", refresh);
    const timer = setInterval(refresh, 45000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [navigation, refresh]);

  return (
    <Pressable
      onPress={() => navigation.navigate("Notifications")}
      hitSlop={12}
      style={styles.button}
      accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
    >
      <Ionicons name={unread > 0 ? "notifications" : "notifications-outline"} size={24} color="#0f172a" />
      {unread > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 99 ? "99+" : unread}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { padding: 4 },
  badge: {
    position: "absolute",
    top: -2,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
});