import React, { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { listCapsulesRequest } from "../api/capsule.api";
import { PageHeader, Segmented, IconBadge, StatePill, Pill, Banner, EmptyState, Button } from "../components/ui";
import { colors, radius, shadow, STATE_COLORS, TYPE_ICONS } from "../theme";

// A small call-to-action tag so the user can see at a glance where they're needed.
function actionTag(role, state) {
  if (role === "testator" && state === "INACTIVITY_ALERT") return "Confirm you're active";
  if (role === "guarantor" && state === "PENDING_VALIDATION") return "Validation needed";
  if (role === "beneficiary" && state === "UNLOCKED") return "Ready to open";
  return null;
}

const TABS = {
  testator: {
    label: "Mine",
    listKey: "asTestator",
    icon: "archive",
    emptyTitle: "No capsules yet",
    empty: "Create your first capsule to store a document, a message or credentials for the people you trust.",
  },
  guarantor: {
    label: "Guarantor",
    listKey: "asGuarantor",
    icon: "shield-checkmark",
    emptyTitle: "Not a guarantor yet",
    empty: "When someone names you as a guarantor, their capsule appears here.",
  },
  beneficiary: {
    label: "Beneficiary",
    listKey: "asBeneficiary",
    icon: "gift",
    emptyTitle: "Nothing left to you yet",
    empty: "Capsules where you're a beneficiary appear here, readable once unlocked.",
  },
};

const titleCase = (s) => s.charAt(0) + s.slice(1).toLowerCase();

export default function CapsuleListScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const [capsules, setCapsules] = useState({ asTestator: [], asGuarantor: [], asBeneficiary: [] });
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState(route.params?.tab || "testator");

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

  const onPressItem = (item, role) => {
    if (role === "testator") {
      navigation.navigate("CapsuleDetail", { capsuleId: item.id });
    } else {
      navigation.navigate("SharedCapsule", { capsuleId: item.id });
    }
  };

  const options = Object.entries(TABS).map(([key, t]) => {
    const list = capsules[t.listKey] || [];
    return { key, label: t.label, count: list.length, alert: list.some((c) => actionTag(key, c.state)) };
  });

  const current = TABS[tab];
  const blocked = tab === "guarantor" ? capsules.blocked?.guarantor : null;
  // Capsules that need the user come first.
  const data = blocked
    ? []
    : [...(capsules[current.listKey] || [])].sort((a, b) => Number(!!actionTag(tab, b.state)) - Number(!!actionTag(tab, a.state)));

  return (
    <View style={styles.screen}>
      <FlatList
        contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        data={data}
        keyExtractor={(c) => c.id}
        ListHeaderComponent={
          <>
            <PageHeader title="Capsules" subtitle="Everything you've created or been entrusted with." />
            <Segmented options={options} value={tab} onChange={setTab} />
          </>
        }
        ListEmptyComponent={
          blocked ? (
            <Banner tone="danger" icon="lock-closed">
              {blocked}
            </Banner>
          ) : (
            <View style={styles.emptyCard}>
              <EmptyState
                icon={current.icon}
                title={current.emptyTitle}
                text={current.empty}
                action={
                  tab === "testator" ? (
                    <Button
                      title="Create a capsule"
                      icon="add"
                      compact
                      onPress={() => navigation.navigate("CapsuleCreate")}
                      style={styles.emptyButton}
                    />
                  ) : null
                }
              />
            </View>
          )
        }
        renderItem={({ item }) => {
          const tag = actionTag(tab, item.state);
          const stateColor = STATE_COLORS[item.state] || colors.muted;
          return (
            <Pressable
              style={({ pressed }) => [styles.card, tag && styles.cardAction, pressed && styles.pressed]}
              onPress={() => onPressItem(item, tab)}
            >
              <View style={[styles.stripe, { backgroundColor: stateColor }]} />
              <IconBadge name={TYPE_ICONS[item.type] || "archive"} color={stateColor} soft size={44} iconSize={21} />
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.cardSubtitle} numberOfLines={1}>
                  {titleCase(item.type)}
                  {tab !== "testator" && item.testator?.fullName ? ` · from ${item.testator.fullName}` : ""}
                </Text>
                <View style={styles.pillRow}>
                  <StatePill state={item.state} />
                  {tag && <Pill label={tag} color={colors.indigo} soft={false} icon="alert-circle" />}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.ghost} />
            </Pressable>
          );
        }}
      />

      <Pressable
        style={({ pressed }) => [styles.fab, { bottom: insets.bottom + 20 }, pressed && styles.pressed]}
        onPress={() => navigation.navigate("CapsuleCreate")}
      >
        <Ionicons name="add" size={22} color="#fff" />
        <Text style={styles.fabText}>New capsule</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  container: { padding: 20, paddingTop: 4 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderStyle: "dashed",
  },
  emptyButton: { marginTop: 16 },

  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 14,
    paddingLeft: 18,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: "hidden",
    ...shadow.card,
  },
  cardAction: { borderColor: colors.indigoLine, backgroundColor: "#fbfbff" },
  stripe: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  cardBody: { flex: 1, marginLeft: 14, marginRight: 8 },
  cardTitle: { fontSize: 15.5, fontWeight: "800", color: colors.ink },
  cardSubtitle: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 9 },

  fab: {
    position: "absolute",
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    paddingVertical: 14,
    paddingLeft: 16,
    paddingRight: 20,
    ...shadow.hero,
  },
  fabText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
