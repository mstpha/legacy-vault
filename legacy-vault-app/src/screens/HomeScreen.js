import React, { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../context/AuthContext";
import { listCapsulesRequest } from "../api/capsule.api";
import { getSecuritySummary } from "../utils/deviceKeys";
import NotificationBell from "../components/NotificationBell";
import { Avatar, Banner, Card, CountBadge, Hero, HeroStats, IconBadge, ListItem, Pill, ProgressBar, SectionLabel } from "../components/ui";
import { colors, radius, shadow } from "../theme";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function HomeScreen({ navigation }) {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const isAdmin = user?.role === "ADMIN";
  const mfaEnabled = !!user?.mfaEnabled;

  // Counts for the vault summary and the portal badges.
  const [waiting, setWaiting] = useState({ mine: null, alerts: 0, guarantor: 0, beneficiary: 0 });
  // App lock + device key status for the security checklist.
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
            mine: data.asTestator.length,
            alerts: data.asTestator.filter((c) => c.state === "INACTIVITY_ALERT").length,
            guarantor: data.asGuarantor.filter((c) => c.state === "PENDING_VALIDATION").length,
            beneficiary: data.asBeneficiary.filter((c) => c.state === "UNLOCKED").length,
          });
        })
        .catch(() => {}); // counts are a nicety: never bother the user if this fails
      return () => {
        active = false;
      };
    }, [])
  );

  const checks = [
    {
      done: mfaEnabled,
      icon: "shield-checkmark",
      title: "Two-factor authentication",
      subtitle: mfaEnabled ? "Enabled" : "Not enabled, tap to set up",
      onPress: () => navigation.navigate(mfaEnabled ? "MfaDisable" : "MfaSetup"),
    },
    {
      done: !!security?.lockEnabled,
      icon: "finger-print",
      title: "App lock",
      subtitle: security?.lockEnabled ? "Fingerprint / face / PIN on" : "Off",
      onPress: () => navigation.navigate("SecuritySettings"),
    },
    {
      done: !!security?.keyActive,
      icon: "key",
      title: "Device key",
      subtitle: security?.keyActive ? "Active on this phone" : "Not set up",
      onPress: () => navigation.navigate("SecuritySettings"),
    },
  ];
  const score = checks.filter((c) => c.done).length;
  const firstName = user?.fullName?.trim().split(" ")[0];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.container, { paddingTop: insets.top + 14 }]}>
      {/* --- Top bar --- */}
      <View style={styles.topBar}>
        <Avatar label={user?.fullName || user?.email} size={48} dark />
        <View style={styles.topText}>
          <Text style={styles.greeting}>{getGreeting()}</Text>
          <Text style={styles.name} numberOfLines={1}>
            {firstName || user?.email}
          </Text>
        </View>
        {isAdmin && (
          <View style={styles.adminPill}>
            <Pill label="Admin" icon="shield-checkmark" color={colors.violetInk} />
          </View>
        )}
        <NotificationBell navigation={navigation} />
      </View>

      {waiting.alerts > 0 && (
        <Banner tone="warning" icon="time" title="Are you still there?" onPress={() => navigation.navigate("CapsuleList")}>
          {`${waiting.alerts} capsule${waiting.alerts > 1 ? "s are" : " is"} waiting for you to confirm you're active.`}
        </Banner>
      )}

      {/* --- Vault: the primary destination --- */}
      <Hero
        icon="archive"
        eyebrow="Your vault"
        title="My Capsules"
        subtitle="Create, manage, and monitor what you're leaving behind."
        right={
          <View style={styles.heroArrow}>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </View>
        }
        onPress={() => navigation.navigate("CapsuleList")}
      >
        <HeroStats
          items={[
            { value: waiting.mine ?? "–", label: "Capsules" },
            { value: waiting.guarantor, label: "To validate" },
            { value: waiting.beneficiary, label: "Ready to open" },
          ]}
        />
      </Hero>

      {/* --- Portals: capsules where someone else named you --- */}
      <SectionLabel>Portals</SectionLabel>
      <View style={styles.grid}>
        <PortalTile
          icon="shield-checkmark"
          color={colors.indigo}
          title="Guarantor"
          subtitle="Capsules you help protect"
          count={waiting.guarantor}
          onPress={() => navigation.navigate("GuarantorPortal")}
        />
        <PortalTile
          icon="gift"
          color={colors.sky}
          title="Beneficiary"
          subtitle="Capsules left to you"
          count={waiting.beneficiary}
          onPress={() => navigation.navigate("BeneficiaryPortal")}
        />
      </View>

      {/* --- Security checklist --- */}
      <SectionLabel right={<Text style={styles.scoreText}>{score}/3 on</Text>}>Security</SectionLabel>
      <Card style={styles.securityCard}>
        <View style={styles.scoreRow}>
          <IconBadge
            name={score === 3 ? "shield-checkmark" : "shield-half"}
            color={score === 3 ? colors.green : colors.amber}
            soft
            size={44}
            iconSize={22}
          />
          <View style={styles.scoreBody}>
            <Text style={styles.scoreTitle}>{score === 3 ? "Fully protected" : "Strengthen your account"}</Text>
            <Text style={styles.scoreSubtitle}>
              {score === 3 ? "Every protection is switched on." : `${3 - score} protection${3 - score > 1 ? "s" : ""} left to turn on.`}
            </Text>
          </View>
        </View>
        <ProgressBar value={score / 3} color={score === 3 ? colors.green : colors.amber} style={styles.scoreBar} />
        {checks.map((c, i) => (
          <Pressable
            key={c.title}
            onPress={c.onPress}
            style={({ pressed }) => [styles.checkRow, i === checks.length - 1 && styles.checkRowLast, pressed && styles.pressed]}
          >
            <View style={[styles.checkDot, c.done ? styles.checkDotDone : styles.checkDotTodo]}>
              <Ionicons name={c.done ? "checkmark" : c.icon} size={c.done ? 14 : 13} color={c.done ? "#fff" : colors.amber} />
            </View>
            <View style={styles.checkBody}>
              <Text style={styles.checkTitle}>{c.title}</Text>
              <Text style={[styles.checkSubtitle, !c.done && styles.checkSubtitleTodo]}>{c.subtitle}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.ghost} />
          </Pressable>
        ))}
      </Card>

      {/* --- Admin: only rendered at all for admins, distinct purple treatment --- */}
      {isAdmin && (
        <>
          <SectionLabel>Administration</SectionLabel>
          <ListItem
            icon="key"
            color={colors.violet}
            tone="admin"
            title="Roles & Permissions"
            subtitle="Control what testators, guarantors & beneficiaries can do"
            onPress={() => navigation.navigate("Permissions")}
          />
          <ListItem
            icon="document-text"
            color={colors.violet}
            tone="admin"
            title="Audit log"
            subtitle="Tamper-evident history of every sensitive action"
            onPress={() => navigation.navigate("AuditLog")}
          />
        </>
      )}

      {/* --- Sign out: deliberately understated --- */}
      <Pressable style={({ pressed }) => [styles.logoutRow, pressed && styles.pressed]} onPress={logout}>
        <Ionicons name="log-out-outline" size={18} color={colors.red} />
        <Text style={styles.logoutText}>Log out</Text>
      </Pressable>

      <View style={styles.footer}>
        <Ionicons name="lock-closed" size={11} color={colors.ghost} />
        <Text style={styles.footnote}>Digital Legacy Vault · end-to-end encrypted</Text>
      </View>
    </ScrollView>
  );
}

function PortalTile({ icon, color, title, subtitle, count, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
      <View style={styles.tileTop}>
        <IconBadge name={icon} color={color} size={42} iconSize={21} />
        <CountBadge count={count} />
      </View>
      <Text style={styles.tileTitle}>{title}</Text>
      <Text style={styles.tileSubtitle}>{subtitle}</Text>
      <View style={styles.tileLink}>
        <Text style={[styles.tileLinkText, { color }]}>Open</Text>
        <Ionicons name="arrow-forward" size={13} color={color} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  container: { padding: 20, paddingBottom: 40 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.985 }] },

  topBar: { flexDirection: "row", alignItems: "center", marginBottom: 22 },
  topText: { flex: 1, marginLeft: 12, marginRight: 8 },
  greeting: { fontSize: 13, color: colors.muted, fontWeight: "600" },
  name: { fontSize: 21, fontWeight: "800", color: colors.ink, letterSpacing: -0.3, marginTop: 1 },
  adminPill: { marginRight: 10 },

  heroArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },

  grid: { flexDirection: "row", gap: 12 },
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...shadow.card,
  },
  tileTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  tileTitle: { fontSize: 15.5, fontWeight: "800", color: colors.ink, marginTop: 14 },
  tileSubtitle: { fontSize: 12.5, color: colors.muted, marginTop: 3, lineHeight: 17, minHeight: 34 },
  tileLink: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 10 },
  tileLinkText: { fontSize: 13, fontWeight: "800" },

  scoreText: { fontSize: 12, fontWeight: "800", color: colors.faint },
  securityCard: { paddingBottom: 6 },
  scoreRow: { flexDirection: "row", alignItems: "center" },
  scoreBody: { flex: 1, marginLeft: 14 },
  scoreTitle: { fontSize: 16, fontWeight: "800", color: colors.ink },
  scoreSubtitle: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  scoreBar: { marginTop: 14, marginBottom: 6 },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  checkRowLast: { borderBottomWidth: 0 },
  checkDot: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  checkDotDone: { backgroundColor: colors.green },
  checkDotTodo: { backgroundColor: colors.amberSoft, borderWidth: 1, borderColor: "#fde68a" },
  checkBody: { flex: 1, marginLeft: 12 },
  checkTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  checkSubtitle: { fontSize: 12, color: colors.muted, marginTop: 1 },
  checkSubtitleTodo: { color: "#b45309" },

  logoutRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  logoutText: { color: colors.red, fontSize: 14.5, fontWeight: "700" },

  footer: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 20 },
  footnote: { fontSize: 11, color: colors.ghost, fontWeight: "600" },
});
