import React, { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { listAuditRequest, verifyAuditRequest } from "../api/audit.api";
import { Banner, Button, EmptyState, Hero } from "../components/ui";
import { colors, radius, shadow } from "../theme";

// action -> [what a person reads, icon, colour family]
const ACTIONS = {
  USER_REGISTERED: ["Account created", "person-add", "info"],
  USER_LOGGED_IN: ["Signed in", "log-in", "info"],
  USER_LOGGED_OUT: ["Signed out", "log-out", "info"],
  MFA_ENABLED: ["Two-factor turned on", "shield-checkmark", "success"],
  MFA_DISABLED: ["Two-factor turned off", "shield-outline", "warning"],
  MFA_LOGIN_REJECTED: ["Wrong two-factor code", "close-circle", "danger"],
  CAPSULE_CREATED: ["Capsule created", "archive", "info"],
  CAPSULE_UPDATED: ["Capsule updated", "create", "info"],
  CAPSULE_DELETED: ["Draft deleted", "trash", "warning"],
  CAPSULE_ACTIVATED: ["Capsule activated", "play-circle", "success"],
  CAPSULE_REVOKED: ["Capsule revoked", "ban", "danger"],
  THRESHOLDS_UPDATED: ["Thresholds changed", "options", "info"],
  FILE_ATTACHED: ["File attached", "attach", "info"],
  GUARANTOR_ADDED: ["Guarantor added", "person-add", "info"],
  GUARANTOR_REMOVED: ["Guarantor removed", "person-remove", "warning"],
  BENEFICIARY_ADDED: ["Beneficiary added", "person-add", "info"],
  BENEFICIARY_REMOVED: ["Beneficiary removed", "person-remove", "warning"],
  ACTIVITY_CONFIRMED: ["Owner confirmed still active", "checkmark-circle", "success"],
  INACTIVITY_ALERT_TRIGGERED: ["Inactivity alert sent", "time", "warning"],
  ESCALATED_TO_PENDING_VALIDATION: ["Sent to guarantors for validation", "hourglass", "action"],
  VALIDATION_SUBMITTED: ["Guarantor validated", "checkmark-done-circle", "action"],
  CAPSULE_UNLOCKED: ["Capsule unlocked", "lock-open", "success"],
  CAPSULE_CONTENT_ACCESSED: ["Content opened", "eye", "info"],
  FILE_DOWNLOADED: ["File downloaded", "download", "info"],
  CAPSULE_FIRST_ACCESS: ["First read confirmed", "book", "success"],
  CAPSULE_ARCHIVED: ["Capsule archived", "file-tray-full", "info"],
  ACCESS_ATTEMPT_BLOCKED: ["Early access attempt blocked", "warning", "danger"],
  KEY_SHARE_DELIVERED: ["Device key share delivered", "key", "info"],
  PERMISSION_CHANGED: ["Permission changed", "key", "warning"],
  PUBLIC_KEY_REGISTERED: ["Device key registered", "finger-print", "info"],
  PUBLIC_KEY_CHANGED: ["Device key replaced", "swap-horizontal", "warning"],
  PUBLIC_KEY_REMOVED: ["Device key removed", "finger-print", "warning"],
  KEY_SHARES_UPDATED: ["Keys shared with beneficiaries", "share", "info"],
};

const TONES = {
  info: { bg: "#eff6ff", fg: "#3b82f6" },
  warning: { bg: "#fffbeb", fg: "#d97706" },
  action: { bg: "#eef2ff", fg: "#6366f1" },
  success: { bg: "#f0fdf4", fg: "#16a34a" },
  danger: { bg: "#fef2f2", fg: "#ef4444" },
};

const FILTERS = [
  { key: null, label: "All", icon: "albums-outline" },
  { key: "accounts", label: "Accounts", icon: "person-outline" },
  { key: "capsules", label: "Capsules", icon: "archive-outline" },
  { key: "lifecycle", label: "Alerts & unlock", icon: "time-outline" },
  { key: "access", label: "Access", icon: "eye-outline" },
  { key: "security", label: "Security", icon: "shield-outline" },
];

const describe = (action) => ACTIONS[action] || [action.replace(/_/g, " ").toLowerCase(), "document-text", "info"];

function metadataLine(metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  const parts = Object.entries(metadata)
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  return parts.length ? parts.join("  ·  ") : null;
}

export default function AuditLogScreen() {
  const { user } = useAuth();
  const [entries, setEntries] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [group, setGroup] = useState(null);
  const [capsule, setCapsule] = useState(null); // { id, title }
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [integrity, setIntegrity] = useState(null);
  const [verifying, setVerifying] = useState(false);

  const fetchPage = useCallback(
    async (before) => {
      const params = {};
      if (before) params.before = before;
      if (group) params.group = group;
      if (capsule) params.capsuleId = capsule.id;
      return listAuditRequest(params);
    },
    [group, capsule]
  );

  const reload = useCallback(async () => {
    try {
      const page = await fetchPage();
      setEntries(page.entries);
      setCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error?.message || "Couldn't load the audit log.");
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      reload();
    }, [reload])
  );

  if (user?.role !== "ADMIN") {
    return (
      <View style={styles.center}>
        <EmptyState icon="lock-closed" title="Admins only" text="The audit log can only be viewed by administrators." />
      </View>
    );
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(cursor);
      setEntries((prev) => [...prev, ...page.entries]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err.response?.data?.error?.message || "Couldn't load more.");
    } finally {
      setLoadingMore(false);
    }
  };

  const onVerify = async () => {
    if (verifying) return;
    setVerifying(true);
    try {
      setIntegrity(await verifyAuditRequest());
    } catch (err) {
      setIntegrity({ error: err.response?.data?.error?.message || "Verification failed." });
    } finally {
      setVerifying(false);
    }
  };

  const integrityBad = integrity && (integrity.error || !integrity.valid);

  const header = (
    <View>
      <Hero
        icon="document-text"
        eyebrow="Tamper-evident"
        title="Audit log"
        subtitle="Every sensitive action is chained by hash. Verifying re-computes the chain to prove nothing was changed or removed."
      >
        <Button title="Verify integrity" icon="shield-checkmark" variant="light" onPress={onVerify} loading={verifying} style={styles.verify} />
      </Hero>

      {integrity && (
        <Banner tone={integrityBad ? "danger" : "success"} title={integrityBad ? "Integrity problem" : "Chain intact"}>
          {integrity.error
            ? integrity.error
            : integrity.valid
            ? `${integrity.checked} entries verified.${integrity.legacyUnchained ? ` ${integrity.legacyUnchained} older entries have no hash and weren't checked.` : ""}`
            : `Chain BROKEN at entry #${integrity.brokenAt.seq}. ${integrity.brokenAt.reason}`}
        </Banner>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipsScroll}>
        {FILTERS.map((f) => {
          const active = group === f.key;
          return (
            <Pressable key={f.label} style={[styles.chip, active && styles.chipActive]} onPress={() => setGroup(f.key)}>
              <Ionicons name={f.icon} size={14} color={active ? "#fff" : colors.muted} />
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {capsule && (
        <Pressable style={styles.capsuleFilter} onPress={() => setCapsule(null)}>
          <Ionicons name="funnel" size={14} color={colors.indigoInk} />
          <Text style={styles.capsuleFilterText} numberOfLines={1}>
            Capsule: {capsule.title || capsule.id}
          </Text>
          <Ionicons name="close-circle" size={18} color={colors.indigoInk} />
        </Pressable>
      )}
      {error && <Banner tone="danger">{error}</Banner>}
    </View>
  );

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.container}
      data={entries}
      keyExtractor={(e) => String(e.seq)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={header}
      onEndReached={loadMore}
      onEndReachedThreshold={0.4}
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator color={colors.ink} style={{ marginTop: 40 }} />
        ) : error ? null : (
          <EmptyState icon="search" title="No entries" text="No entries match this filter." />
        )
      }
      ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.ink} style={{ marginVertical: 16 }} /> : <View style={{ height: 24 }} />}
      renderItem={({ item, index }) => {
        const [label, icon, toneName] = describe(item.action);
        const tone = TONES[toneName] || TONES.info;
        const meta = metadataLine(item.metadata);
        const isLast = index === entries.length - 1;
        return (
          <View style={styles.timelineRow}>
            {/* Left rail: icon dot + connecting line */}
            <View style={styles.rail}>
              <View style={[styles.railDot, { backgroundColor: tone.bg, borderColor: `${tone.fg}33` }]}>
                <Ionicons name={icon} size={16} color={tone.fg} />
              </View>
              {!isLast && <View style={styles.railLine} />}
            </View>

            <View style={styles.card}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>{label}</Text>
                <Text style={styles.seq}>#{item.seq}</Text>
              </View>
              <View style={styles.whoRow}>
                <Ionicons name="person-circle-outline" size={14} color={colors.faint} />
                <Text style={styles.who} numberOfLines={1}>
                  {item.userEmail || (item.userId ? `Deleted user (${item.userId.slice(0, 8)})` : "System")}
                </Text>
              </View>
              {item.capsuleId && (
                <Pressable onPress={() => setCapsule({ id: item.capsuleId, title: item.capsuleTitle })} style={styles.capsuleLink}>
                  <Ionicons name="archive-outline" size={12} color={colors.indigo} />
                  <Text style={styles.capsuleLinkText} numberOfLines={1}>
                    {item.capsuleTitle || `${item.capsuleId.slice(0, 8)} (deleted)`}
                  </Text>
                </Pressable>
              )}
              {meta && <Text style={styles.meta}>{meta}</Text>}
              <View style={styles.footerRow}>
                <Text style={styles.time}>{new Date(item.createdAt).toLocaleString()}</Text>
                {!item.chained && (
                  <View style={styles.legacy}>
                    <Text style={styles.legacyText}>no hash (older)</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  container: { padding: 20, paddingTop: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: colors.canvas },
  verify: { marginTop: 18 },

  chipsScroll: { marginHorizontal: -20, marginBottom: 6 },
  chips: { gap: 8, paddingHorizontal: 20, paddingBottom: 10 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 13,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 13, color: colors.body, fontWeight: "700" },
  chipTextActive: { color: "#fff" },
  capsuleFilter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.indigoSoft,
    borderWidth: 1,
    borderColor: colors.indigoLine,
    borderRadius: radius.md,
    padding: 10,
    marginBottom: 12,
  },
  capsuleFilterText: { flex: 1, color: colors.indigoInk, fontSize: 13, fontWeight: "700" },

  timelineRow: { flexDirection: "row" },
  rail: { width: 38, alignItems: "center" },
  railDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  railLine: { flex: 1, width: 2, backgroundColor: colors.line, marginTop: 4, marginBottom: -8 },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 14,
    marginLeft: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...shadow.card,
  },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { flex: 1, fontSize: 14.5, fontWeight: "800", color: colors.ink },
  seq: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: "700",
    backgroundColor: colors.hairline,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginLeft: 8,
    overflow: "hidden",
  },
  whoRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  who: { fontSize: 12.5, color: colors.body, flexShrink: 1 },
  capsuleLink: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4, alignSelf: "flex-start" },
  capsuleLinkText: { fontSize: 12.5, color: colors.indigo, fontWeight: "700" },
  meta: {
    fontSize: 11.5,
    color: colors.muted,
    marginTop: 8,
    backgroundColor: colors.canvas,
    borderRadius: radius.sm,
    padding: 8,
    fontFamily: "monospace",
  },
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  time: { fontSize: 11, color: colors.faint, fontWeight: "600" },
  legacy: { backgroundColor: colors.hairline, borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: 8 },
  legacyText: { fontSize: 10, color: colors.muted, fontWeight: "700" },
});
