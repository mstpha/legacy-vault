import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useApiStatus } from "../hooks/useApiStatus";
import { colors } from "../theme";

// Thin strip at the bottom of every screen, shown only when the app is NOT on the primary server.
export default function ConnectionBanner() {
  const { label, backupDb, activeServer } = useApiStatus();
  const insets = useSafeAreaInsets();
  if (!label) return null;

  const severe = activeServer !== "backup" || backupDb === "B" || backupDb === "draining";
  return (
    <View
      pointerEvents="none"
      accessibilityRole="alert"
      style={[styles.bar, severe ? styles.severe : styles.info, { paddingBottom: 6 + insets.bottom }]}
    >
      <Ionicons name="cloud-offline-outline" size={14} color={severe ? colors.redInk : colors.amberInk} />
      <Text style={[styles.text, { color: severe ? colors.redInk : colors.amberInk }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingTop: 6,
    borderTopWidth: 1,
  },
  info: { backgroundColor: colors.amberSoft, borderTopColor: colors.amber },
  severe: { backgroundColor: colors.redSoft, borderTopColor: colors.redLine },
  text: { fontSize: 12, fontWeight: "600" },
});
