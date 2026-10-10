import React, { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { listCapsulesRequest } from "../api/capsule.api";

const STATE_LABELS = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  INACTIVITY_ALERT: "Inactivity alert",
  PENDING_VALIDATION: "Pending validation",
  UNLOCKED: "Unlocked",
  REVOKED: "Revoked",
  ARCHIVED: "Opened",
};

// A small call-to-action tag so the user can see at a glance where they're needed.
function actionTag(role, state) {
  if (role === "testator" && state === "INACTIVITY_ALERT") return "Confirm you're active";
  if (role === "guarantor" && state === "PENDING_VALIDATION") return "Validation needed";
  if (role === "beneficiary" && state === "UNLOCKED") return "Ready to open";
  return null;
}

export default function CapsuleListScreen({ navigation }) {
  const [capsules, setCapsules] = useState({ asTestator: [], asGuarantor: [], asBeneficiary: [] });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listCapsulesRequest();
      setCapsules(data);
    } catch (err) {
      Alert.alert("Error", "Could not load your capsules.");
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

  const sections = [
    { title: "My capsules (I'm the testator)", data: capsules.asTestator, role: "testator" },
    { title: "Where I'm a guarantor", data: capsules.asGuarantor, role: "guarantor" },
    { title: "Where I'm a beneficiary", data: capsules.asBeneficiary, role: "beneficiary" },
  ];

  const onPressItem = (item, role) => {
    if (role === "testator") {
      navigation.navigate("CapsuleDetail", { capsuleId: item.id });
    } else {
      navigation.navigate("SharedCapsule", { capsuleId: item.id });
    }
  };

  return (
    <FlatList
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      data={sections}
      keyExtractor={(s) => s.role}
      renderItem={({ item: section }) => (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {section.role === "guarantor" && capsules.blocked?.guarantor ? (
            <Text style={styles.blocked}>🔒 {capsules.blocked.guarantor}</Text>
          ) : section.data.length === 0 ? (
            <Text style={styles.empty}>Nothing here yet.</Text>
          ) : (
            section.data.map((item) => {
              const tag = actionTag(section.role, item.state);
              return (
                <Pressable key={item.id} style={styles.card} onPress={() => onPressItem(item, section.role)}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {tag && (
                      <View style={styles.tag}>
                        <Text style={styles.tagText}>{tag}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.cardSubtitle}>
                    {item.type} · {STATE_LABELS[item.state] || item.state}
                    {section.role !== "testator" && item.testator?.fullName ? ` · by ${item.testator.fullName}` : ""}
                  </Text>
                </Pressable>
              );
            })
          )}
        </View>
      )}
      ListFooterComponent={
        <Pressable style={styles.fab} onPress={() => navigation.navigate("CapsuleCreate")}>
          <Text style={styles.fabText}>+ New capsule</Text>
        </Pressable>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: "#666", marginBottom: 8, textTransform: "uppercase" },
  empty: { color: "#999", fontSize: 13, fontStyle: "italic" },
  blocked: { color: "#b91c1c", backgroundColor: "#fef2f2", borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: "#f3f4f6", borderRadius: 10, padding: 14, marginBottom: 8 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: "600", marginRight: 8 },
  cardSubtitle: { fontSize: 13, color: "#666", marginTop: 2 },
  tag: { backgroundColor: "#6366f1", borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  tagText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  fab: { backgroundColor: "#0f172a", borderRadius: 10, padding: 16, alignItems: "center", marginTop: 8 },
  fabText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});