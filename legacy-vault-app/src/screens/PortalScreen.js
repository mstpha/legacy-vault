import React, { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { listCapsulesRequest } from "../api/capsule.api";
import { Banner, EmptyState, StatePill, Pill, IconBadge, Loading, Hero, HeroStats, SectionLabel } from "../components/ui";
import { colors, radius, shadow, STATE_COLORS, TYPE_ICONS } from "../theme";

// One screen, two portals: the navigator passes route.params.role = "guarantor" | "beneficiary".
const PORTALS = {
  guarantor: {
    title: "Guarantor portal",
    intro: "Capsules where you're named as a guarantor. You're only asked to act when an owner stays inactive.",
    icon: "shield-checkmark",
    actionState: "PENDING_VALIDATION",
    actionLabel: "Validation needed",
    actionStat: "To validate",
    actionSummary: (n) => `${n} capsule${n > 1 ? "s" : ""} waiting for your validation`,
    emptyTitle: "No capsules to guard yet",
    empty: "You haven't been named as a guarantor on any capsule yet.",
    listKey: "asGuarantor",
  },
  beneficiary: {
    title: "Beneficiary portal",
    intro: "Capsules left to you. Once one is unlocked you can read it as often as you like.",
    icon: "gift",
    actionState: "UNLOCKED",
    actionLabel: "Ready to open",
    actionStat: "Ready to open",
    actionSummary: (n) => `${n} capsule${n > 1 ? "s" : ""} ready to open`,
    emptyTitle: "Nothing left to you yet",
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

  if (!data && !failed) return <Loading />;

  // Capsules that need the user come first.
  const capsules = [...(data?.[portal.listKey] || [])].sort(
    (a, b) => Number(b.state === portal.actionState) - Number(a.state === portal.actionState)
  );
  const blockedMessage = route.params?.role === "guarantor" ? data?.blocked?.guarantor : null;
  const actionCount = capsules.filter((c) => c.state === portal.actionState).length;
  const owners = new Set(capsules.map((c) => c.testator?.fullName).filter(Boolean)).size;

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.container}
      data={blockedMessage ? [] : capsules}
      keyExtractor={(c) => c.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={
        <View>
          <Hero icon={portal.icon} eyebrow="Portal" title={portal.title} subtitle={portal.intro}>
            {!blockedMessage && (
              <HeroStats
                items={[
                  { value: capsules.length, label: "Capsules" },
                  { value: actionCount, label: portal.actionStat },
                  { value: owners, label: owners === 1 ? "Owner" : "Owners" },
                ]}
              />
            )}
          </Hero>
          {actionCount > 0 && !blockedMessage && (
            <Banner tone="action" title="Your attention is needed">
              {portal.actionSummary(actionCount)}
            </Banner>
          )}
          {capsules.length > 0 && !blockedMessage && <SectionLabel>All capsules</SectionLabel>}
        </View>
      }
      ListEmptyComponent={
        blockedMessage ? (
          <Banner tone="danger" icon="lock-closed">
            {blockedMessage}
          </Banner>
        ) : (
          <View style={styles.emptyCard}>
            <EmptyState
              icon={failed ? "cloud-offline-outline" : portal.icon}
              title={failed ? "Couldn't load your capsules" : portal.emptyTitle}
              text={failed ? "Pull down to retry." : portal.empty}
            />
          </View>
        )
      }
      renderItem={({ item }) => {
        const needsAction = item.state === portal.actionState;
        const stateColor = STATE_COLORS[item.state] || colors.muted;
        return (
          <Pressable
            style={({ pressed }) => [styles.card, needsAction && styles.cardAction, pressed && styles.pressed]}
            onPress={() => navigation.navigate("SharedCapsule", { capsuleId: item.id })}
          >
            <View style={[styles.stripe, { backgroundColor: stateColor }]} />
            <IconBadge name={TYPE_ICONS[item.type] || "archive"} color={stateColor} soft size={44} iconSize={21} />
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <View style={styles.ownerRow}>
                <Ionicons name="person-circle-outline" size={14} color={colors.faint} />
                <Text style={styles.owner} numberOfLines={1}>
                  {item.testator?.fullName || "—"}
                </Text>
              </View>
              <View style={styles.pillRow}>
                <StatePill state={item.state} />
                {needsAction && <Pill label={portal.actionLabel} color={colors.indigo} soft={false} icon="alert-circle" />}
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.ghost} />
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  container: { padding: 20, paddingTop: 4, paddingBottom: 48 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderStyle: "dashed",
  },
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
  ownerRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  owner: { fontSize: 12.5, color: colors.muted, flexShrink: 1 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 9 },
});
