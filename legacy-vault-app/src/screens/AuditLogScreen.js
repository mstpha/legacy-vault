import React, { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { listAuditRequest, verifyAuditRequest } from "../api/audit.api";

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
  { key: null, label: "All" },
  { key: "accounts", label: "Accounts" },
  { key: "capsules", label: "Capsules" },
  { key: "lifecycle", label: "Alerts & unlock" },
  { key: "access", label: "Access" },
  { key: "security", label: "Security" },
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
        <Ionicons name="lock-closed" size={36} color="#cbd5e1" />
        <Text style={styles.emptyTitle}>Admins only</Text>
        <Text style={styles.emptyText}>The audit log can only be viewed by administrators.</Text>
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

  const header = (
    <View>
      <View style={styles.verifyRow}>
        <Pressable style={[styles.verifyButton, verifying && styles.dim]} onPress={onVerify} disabled={verifying}>
          {verifying ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="shield-checkmark" size={16} color="#fff" />}
          <Text style={styles.verifyText}>Verify integrity</Text>
        </Pressable>
        <Text style={styles.verifyHint}>Re-computes the hash chain to prove no entry was changed or removed.</Text>
      </View>

      {integrity && (
        <View style={[styles.banner, integrity.error || !integrity.valid ? styles.bannerBad : styles.bannerGood]}>
          <Ionicons
            name={integrity.error || !integrity.valid ? "alert-circle" : "checkmark-circle"}
            size={20}
            color={integrity.error || !integrity.valid ? "#b91c1c" : "#15803d"}
          />
          <Text style={[styles.bannerText, { color: integrity.error || !integrity.valid ? "#b91c1c" : "#15803d" }]}>
            {integrity.error
              ? integrity.error
              : integrity.valid
              ? `Chain intact: ${integrity.checked} entries verified.${integrity.legacyUnchained ? ` ${integrity.legacyUnchained} older entries have no hash and weren't checked.` : ""}`
              : `Chain BROKEN at entry #${integrity.brokenAt.seq}. ${integrity.brokenAt.reason}`}
          </Text>
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {FILTERS.map((f) => (
          <Pressable key={f.label} style={[styles.chip, group === f.key && styles.chipActive]} onPress={() => setGroup(f.key)}>
            <Text style={[styles.chipText, group === f.key && styles.chipTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {capsule && (
        <Pressable style={styles.capsuleFilter} onPress={() => setCapsule(null)}>
          <Text style={styles.capsuleFilterText} numberOfLines={1}>
            Capsule: {capsule.title || capsule.id}
          </Text>
          <Ionicons name="close-circle" size={16} color="#4338ca" />
        </Pressable>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
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
          <ActivityIndicator style={{ marginTop: 40 }} />
        ) : (
          <Text style={styles.emptyText}>{error ? "" : "No entries match this filter."}</Text>
        )
      }
      ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} /> : <View style={{ height: 24 }} />}
      renderItem={({ item }) => {
        const [label, icon, toneName] = describe(item.action);
        const tone = TONES[toneName] || TONES.info;
        const meta = metadataLine(item.metadata);
        return (
          <View style={styles.card}>
            <View style={[styles.iconBadge, { backgroundColor: tone.bg }]}>
              <Ionicons name={icon} size={18} color={tone.fg} />
            </View>
            <View style={styles.cardBody}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>{label}</Text>
                <Text style={styles.seq}>#{item.seq}</Text>
              </View>
              <Text style={styles.who}>
                {item.userEmail || (item.userId ? `Deleted user (${item.userId.slice(0, 8)})` : "System")}
              </Text>
              {item.capsuleId && (
                <Pressable onPress={() => setCapsule({ id: item.capsuleId, title: item.capsuleTitle })}>
                  <Text style={styles.capsuleLink} numberOfLines={1}>
                    {item.capsuleTitle ? `Capsule: ${item.capsuleTitle}` : `Capsule ${item.capsuleId.slice(0, 8)} (deleted)`}
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
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  container: { padding: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: "#0f172a", marginTop: 12 },
  emptyText: { fontSize: 13, color: "#94a3b8", textAlign: "center", marginTop: 8, lineHeight: 19 },
  error: { color: "#b91c1c", fontSize: 13, marginBottom: 8 },
  dim: { opacity: 0.6 },
  verifyRow: { marginBottom: 12 },
  verifyButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#0f172a", borderRadius: 10, paddingVertical: 12 },
  verifyText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  verifyHint: { fontSize: 11.5, color: "#94a3b8", marginTop: 6, textAlign: "center" },
  banner: { flexDirection: "row", gap: 8, alignItems: "flex-start", borderRadius: 10, padding: 12, marginBottom: 12 },
  bannerGood: { backgroundColor: "#f0fdf4" },
  bannerBad: { backgroundColor: "#fef2f2" },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: "600" },
  chips: { gap: 8, paddingBottom: 12 },
  chip: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14, backgroundColor: "#fff" },
  chipActive: { backgroundColor: "#0f172a", borderColor: "#0f172a" },
  chipText: { fontSize: 13, color: "#374151" },
  chipTextActive: { color: "#fff" },
  capsuleFilter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#eef2ff", borderRadius: 10, padding: 10, marginBottom: 12 },
  capsuleFilterText: { flex: 1, color: "#4338ca", fontSize: 13, fontWeight: "600", marginRight: 8 },
  card: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#f1f5f9" },
  iconBadge: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardBody: { flex: 1, marginLeft: 10 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { flex: 1, fontSize: 14, fontWeight: "700", color: "#0f172a" },
  seq: { fontSize: 11, color: "#cbd5e1", marginLeft: 8 },
  who: { fontSize: 12.5, color: "#475569", marginTop: 2 },
  capsuleLink: { fontSize: 12.5, color: "#6366f1", marginTop: 2 },
  meta: { fontSize: 11.5, color: "#94a3b8", marginTop: 3 },
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  time: { fontSize: 11, color: "#94a3b8" },
  legacy: { backgroundColor: "#f1f5f9", borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 },
  legacyText: { fontSize: 10, color: "#64748b", fontWeight: "600" },
});
