import React, { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { listCapsulesRequest } from "../api/capsule.api";
import { getSecuritySummary } from "../utils/deviceKeys";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function getInitials(name, email) {
  const source = name?.trim() || email || "?";
  const parts = source.split(" ").filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export default function HomeScreen({ navigation }) {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const mfaEnabled = !!user?.mfaEnabled;

  // How many capsules are waiting on this user as guarantor / beneficiary (shown as badges).
  const [waiting, setWaiting] = useState({ guarantor: 0, beneficiary: 0 });
  // App lock + device key status for the "Device security" card.
  const [security, setSecurity] = useState(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (user?.id) {
        getSecuritySummary(user.id)
          .then((summary) => active && setSecurity(summary))
          .catch(() => {});
      }
      return () => {
        active = false;
      };
    }, [user?.id])
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      listCapsulesRequest()
        .then((data) => {
          if (!active) return;
          setWaiting({
            guarantor: data.asGuarantor.filter((c) => c.state === "PENDING_VALIDATION").length,
            beneficiary: data.asBeneficiary.filter((c) => c.state === "UNLOCKED").length,
          });
        })
        .catch(() => {}); // badges are a nicety: never bother the user if this fails
      return () => {
        active = false;
      };
    }, [])
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {/* --- Profile header --- */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{getInitials(user?.fullName, user?.email)}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.greeting}>
            {getGreeting()}
            {user?.fullName ? `, ${user.fullName.split(" ")[0]}` : ""}
          </Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>
        {isAdmin && (
          <View style={styles.adminPill}>
            <Ionicons name="shield-checkmark" size={12} color="#9333ea" />
            <Text style={styles.adminPillText}>Admin</Text>
          </View>
        )}
      </View>

      {/* --- Capsules: the primary action, gets the biggest/boldest card --- */}
      <Pressable
        style={({ pressed }) => [styles.heroCard, pressed && styles.cardPressed]}
        onPress={() => navigation.navigate("CapsuleList")}
      >
        <View style={[styles.iconBadge, styles.iconBadgeIndigo]}>
          <Ionicons name="archive" size={22} color="#fff" />
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.heroTitle}>My Capsules</Text>
          <Text style={styles.heroSubtitle}>Create, manage, and monitor what you're leaving behind</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#c7d2fe" />
      </Pressable>

      {/* --- Portals: capsules where someone else named you --- */}
      <Text style={styles.sectionLabel}>Portals</Text>
      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => navigation.navigate("GuarantorPortal")}
      >
        <View style={[styles.iconBadge, styles.iconBadgeViolet]}>
          <Ionicons name="shield-checkmark" size={20} color="#fff" />
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>Guarantor portal</Text>
          <Text style={styles.cardSubtitle}>Capsules where you're a guarantor, and their status</Text>
        </View>
        {waiting.guarantor > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{waiting.guarantor}</Text>
          </View>
        )}
        <Ionicons name="chevron-forward" size={18} color="#d1d5db" />
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => navigation.navigate("BeneficiaryPortal")}
      >
        <View style={[styles.iconBadge, styles.iconBadgeSky]}>
          <Ionicons name="gift" size={20} color="#fff" />
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>Beneficiary portal</Text>
          <Text style={styles.cardSubtitle}>Capsules left to you, readable once unlocked</Text>
        </View>
        {waiting.beneficiary > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{waiting.beneficiary}</Text>
          </View>
        )}
        <Ionicons name="chevron-forward" size={18} color="#d1d5db" />
      </Pressable>

      {/* --- Security / MFA: status-aware card, color reflects state --- */}
      <Text style={styles.sectionLabel}>Account</Text>
      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => navigation.navigate(mfaEnabled ? "MfaDisable" : "MfaSetup")}
      >
        <View style={[styles.iconBadge, mfaEnabled ? styles.iconBadgeGreen : styles.iconBadgeAmber]}>
          <Ionicons name={mfaEnabled ? "shield-checkmark" : "shield-outline"} size={20} color="#fff" />
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>Two-Factor Authentication</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, mfaEnabled ? styles.statusDotGreen : styles.statusDotAmber]} />
            <Text style={styles.cardSubtitle}>{mfaEnabled ? "Enabled" : "Not enabled — tap to set up"}</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#d1d5db" />
      </Pressable>

      {/* --- Device security: phone biometric lock + device key --- */}
      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => navigation.navigate("SecuritySettings")}
      >
        <View style={[styles.iconBadge, security?.lockEnabled && security?.keyActive ? styles.iconBadgeGreen : styles.iconBadgeTeal]}>
          <Ionicons name="finger-print" size={22} color="#fff" />
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>Device security</Text>
          <Text style={styles.cardSubtitle}>
            {security
              ? `App lock ${security.lockEnabled ? "on" : "off"} · Device key ${security.keyActive ? "active" : "not set up"}`
              : "Fingerprint / face lock and device key"}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#d1d5db" />
      </Pressable>

      {/* --- Admin: only rendered at all for admins, distinct purple treatment --- */}
      {isAdmin && (
        <>
          <Text style={styles.sectionLabel}>Administration</Text>
          <Pressable
            style={({ pressed }) => [styles.card, styles.adminCard, pressed && styles.cardPressed]}
            onPress={() => navigation.navigate("Permissions")}
          >
            <View style={[styles.iconBadge, styles.iconBadgePurple]}>
              <Ionicons name="key" size={20} color="#fff" />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>Roles & Permissions</Text>
              <Text style={styles.cardSubtitle}>Control what testators, guarantors & beneficiaries can do</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#d1d5db" />
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.card, styles.adminCard, pressed && styles.cardPressed]}
            onPress={() => navigation.navigate("AuditLog")}
          >
            <View style={[styles.iconBadge, styles.iconBadgePurple]}>
              <Ionicons name="document-text" size={20} color="#fff" />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>Audit log</Text>
              <Text style={styles.cardSubtitle}>Tamper-evident history of every sensitive action</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#d1d5db" />
          </Pressable>
        </>
      )}

      {/* --- Sign out: deliberately understated, not a card --- */}
      <Pressable style={styles.logoutRow} onPress={logout}>
        <Ionicons name="log-out-outline" size={18} color="#ef4444" />
        <Text style={styles.logoutText}>Log out</Text>
      </Pressable>

      <Text style={styles.footnote}>Digital Legacy Vault</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  container: { padding: 20, paddingBottom: 48 },

  header: { flexDirection: "row", alignItems: "center", marginBottom: 28, marginTop: 8 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center", marginRight: 14 },
  avatarText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  headerText: { flex: 1 },
  greeting: { fontSize: 19, fontWeight: "700", color: "#0f172a" },
  email: { fontSize: 13, color: "#64748b", marginTop: 2 },
  adminPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#f3e8ff", borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  adminPillText: { fontSize: 11, fontWeight: "700", color: "#9333ea" },

  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10, marginTop: 8 },

  heroCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0f172a",
    borderRadius: 18,
    padding: 18,
    marginBottom: 28,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 4,
  },
  heroTitle: { fontSize: 17, fontWeight: "700", color: "#fff" },
  heroSubtitle: { fontSize: 13, color: "#cbd5e1", marginTop: 3, lineHeight: 18 },

  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#f1f5f9",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  adminCard: { borderColor: "#f3e8ff", backgroundColor: "#fdfaff" },
  cardPressed: { opacity: 0.7 },
  cardBody: { flex: 1, marginLeft: 14, marginRight: 8 },
  cardTitle: { fontSize: 15, fontWeight: "600", color: "#0f172a" },
  cardSubtitle: { fontSize: 12.5, color: "#64748b", marginTop: 2 },

  iconBadge: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  iconBadgeIndigo: { backgroundColor: "rgba(255,255,255,0.12)" },
  iconBadgeGreen: { backgroundColor: "#22c55e" },
  iconBadgeAmber: { backgroundColor: "#f59e0b" },
  iconBadgePurple: { backgroundColor: "#a855f7" },
  iconBadgeViolet: { backgroundColor: "#6366f1" },
  iconBadgeSky: { backgroundColor: "#0ea5e9" },
  iconBadgeTeal: { backgroundColor: "#14b8a6" },

  countBadge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: "#ef4444", alignItems: "center", justifyContent: "center", marginRight: 8 },
  countBadgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 3 },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  statusDotGreen: { backgroundColor: "#22c55e" },
  statusDotAmber: { backgroundColor: "#f59e0b" },

  logoutRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 24, paddingVertical: 10 },
  logoutText: { color: "#ef4444", fontSize: 14, fontWeight: "600" },

  footnote: { textAlign: "center", fontSize: 11, color: "#cbd5e1", marginTop: 20 },
});
