import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, onDark, radius, shadow, STATE_LABELS, STATE_COLORS, LIFECYCLE } from "../theme";

// Building blocks shared by every screen, so the whole app speaks one visual language.

// ---------------------------------------------------------------- surfaces

export function Card({ style, children, tone }) {
  return <View style={[styles.card, tone && toneCard[tone], style]}>{children}</View>;
}

export function SectionLabel({ children, style, right }) {
  return (
    <View style={[styles.sectionRow, style]}>
      <Text style={styles.sectionLabel}>{children}</Text>
      {right}
    </View>
  );
}

export function PageHeader({ title, subtitle, right }) {
  return (
    <View style={styles.pageHeader}>
      <View style={{ flex: 1 }}>
        <Text style={styles.pageTitle}>{title}</Text>
        {subtitle && <Text style={styles.pageSubtitle}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
}

// Dark navy feature card with soft decorative glows. Pressable when onPress is given.
export function Hero({ icon, eyebrow, title, subtitle, right, children, onPress, style }) {
  const body = (
    <>
      <View pointerEvents="none" style={styles.glowA} />
      <View pointerEvents="none" style={styles.glowB} />
      <View style={styles.heroTop}>
        {icon && (
          <View style={styles.heroIcon}>
            <Ionicons name={icon} size={23} color="#fff" />
          </View>
        )}
        <View style={styles.heroHeading}>
          {eyebrow && <Text style={styles.heroEyebrow}>{eyebrow}</Text>}
          <Text style={styles.heroTitle}>{title}</Text>
        </View>
        {right}
      </View>
      {subtitle && <Text style={styles.heroSubtitle}>{subtitle}</Text>}
      {children}
    </>
  );
  if (!onPress) return <View style={[styles.hero, style]}>{body}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.hero, pressed && styles.pressed, style]}>
      {body}
    </Pressable>
  );
}

export function HeroStats({ items }) {
  return (
    <View style={styles.heroStats}>
      {items.map((item, i) => (
        <React.Fragment key={item.label}>
          {i > 0 && <View style={styles.heroStatDivider} />}
          <View style={styles.heroStat}>
            <Text style={styles.heroStatValue}>{item.value}</Text>
            <Text style={styles.heroStatLabel} numberOfLines={1}>
              {item.label}
            </Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

export function HeroPills({ children }) {
  return <View style={styles.heroPills}>{children}</View>;
}

export function HeroPill({ label, dot, icon }) {
  return (
    <View style={styles.heroPill}>
      {dot && <View style={[styles.pillDot, { backgroundColor: dot }]} />}
      {icon && <Ionicons name={icon} size={11} color={onDark.body} />}
      <Text style={styles.heroPillText}>{label}</Text>
    </View>
  );
}

// Sticky footer for a screen's main action.
export function ActionBar({ children }) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>{children}</View>;
}

// ---------------------------------------------------------------- small pieces

export function IconBadge({ name, color = colors.ink, size = 40, iconSize = 20, soft = false, style }) {
  return (
    <View
      style={[
        styles.iconBadge,
        { width: size, height: size, borderRadius: size * 0.32, backgroundColor: soft ? `${color}1A` : color },
        style,
      ]}
    >
      <Ionicons name={name} size={iconSize} color={soft ? color : "#fff"} />
    </View>
  );
}

export function Avatar({ label, size = 36, dark = false }) {
  const initials =
    (label || "?")
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join("") || "?";
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
        dark ? { backgroundColor: colors.ink } : { backgroundColor: colors.indigoSoft },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.36, color: dark ? "#fff" : colors.indigoInk }]}>{initials}</Text>
    </View>
  );
}

export function CountBadge({ count, style }) {
  if (!count) return null;
  return (
    <View style={[styles.countBadge, style]}>
      <Text style={styles.countBadgeText}>{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

export function ProgressBar({ value, color = colors.indigo, track = colors.hairline, height = 6, style }) {
  return (
    <View style={[{ height, borderRadius: height / 2, backgroundColor: track, overflow: "hidden" }, style]}>
      <View style={{ height, borderRadius: height / 2, backgroundColor: color, width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </View>
  );
}

export function Divider({ label, style }) {
  return (
    <View style={[styles.divider, style]}>
      <View style={styles.dividerLine} />
      {label && <Text style={styles.dividerText}>{label}</Text>}
      {label && <View style={styles.dividerLine} />}
    </View>
  );
}

// A tappable row card: icon, title, subtitle, optional badge, chevron.
export function ListItem({ icon, color = colors.ink, soft = false, title, subtitle, onPress, badge, right, tone, style }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.card, styles.listItem, tone && toneCard[tone], pressed && styles.pressed, style]}
    >
      {icon && <IconBadge name={icon} color={color} soft={soft} />}
      <View style={styles.listBody}>
        <Text style={styles.listTitle} numberOfLines={1}>
          {title}
        </Text>
        {typeof subtitle === "string" ? (
          <Text style={styles.listSubtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : (
          subtitle
        )}
      </View>
      <CountBadge count={badge} style={{ marginRight: 8 }} />
      {right}
      {onPress && <Ionicons name="chevron-forward" size={18} color={colors.ghost} />}
    </Pressable>
  );
}

// Pill-shaped tab switcher.
export function Segmented({ options, value, onChange, style }) {
  return (
    <View style={[styles.seg, style]}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} style={[styles.segItem, active && styles.segItemActive]}>
            <Text style={[styles.segText, active && styles.segTextActive]} numberOfLines={1}>
              {o.label}
            </Text>
            {o.count != null && (
              <View style={[styles.segCount, active && styles.segCountActive, o.alert && styles.segCountAlert]}>
                <Text style={[styles.segCountText, (active || o.alert) && styles.segCountTextActive]}>{o.count}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// Horizontal stepper showing where a capsule is in its life.
export function Lifecycle({ state, style }) {
  if (state === "REVOKED") return null;
  const archived = state === "ARCHIVED";
  const current = archived ? LIFECYCLE.length - 1 : LIFECYCLE.findIndex(([s]) => s === state);
  return (
    <View style={[styles.life, style]}>
      {LIFECYCLE.map(([s, label], i) => {
        const done = i < current || archived;
        const active = i === current && !archived;
        const tint = STATE_COLORS[s];
        return (
          <View key={s} style={styles.lifeStep}>
            <View style={styles.lifeTrack}>
              <View style={[styles.lifeLine, i === 0 && styles.invisible, (done || active) && styles.lifeLineOn]} />
              <View
                style={[
                  styles.lifeDot,
                  done && styles.lifeDotDone,
                  active && { borderColor: tint, backgroundColor: `${tint}1A` },
                ]}
              >
                {done ? (
                  <Ionicons name="checkmark" size={12} color="#fff" />
                ) : active ? (
                  <View style={[styles.lifeDotInner, { backgroundColor: tint }]} />
                ) : null}
              </View>
              <View style={[styles.lifeLine, i === LIFECYCLE.length - 1 && styles.invisible, done && styles.lifeLineOn]} />
            </View>
            <Text style={[styles.lifeLabel, done && styles.lifeLabelDone, active && { color: tint }]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- inputs

// variant: primary | secondary | danger | dangerSolid | ghost | light
export function Button({ title, onPress, disabled, loading, icon, variant = "primary", style, compact }) {
  const v = buttonVariants[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        v.box,
        (disabled || loading) && styles.dim,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.text.color} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={compact ? 16 : 18} color={v.text.color} />}
          <Text style={[styles.buttonText, compact && styles.buttonTextCompact, v.text]} numberOfLines={1}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function Field({ label, hint, icon, style, inputStyle, secureTextEntry, editable = true, ...props }) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(!!secureTextEntry);
  return (
    <View style={[styles.fieldWrap, style]}>
      {label && <Text style={styles.fieldLabel}>{label}</Text>}
      <View style={[styles.field, focused && styles.fieldFocused, !editable && styles.fieldDisabled]}>
        {icon && <Ionicons name={icon} size={18} color={focused ? colors.indigo : colors.faint} style={styles.fieldIcon} />}
        <TextInput
          style={[styles.fieldInput, inputStyle]}
          placeholderTextColor={colors.faint}
          secureTextEntry={hidden}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...props}
        />
        {secureTextEntry && (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={10} style={styles.fieldEye}>
            <Ionicons name={hidden ? "eye-outline" : "eye-off-outline"} size={18} color={colors.faint} />
          </Pressable>
        )}
      </View>
      {hint && <Text style={styles.fieldHint}>{hint}</Text>}
    </View>
  );
}

// Six separate digit boxes backed by one invisible input (paste + SMS/OTP autofill still work).
export function CodeField({ value, onChangeText, autoFocus, ...props }) {
  const [focused, setFocused] = useState(false);
  const ref = useRef(null);
  const activeIndex = Math.min(value.length, 5);
  return (
    <View style={styles.codeRow}>
      {Array.from({ length: 6 }).map((_, i) => (
        <View
          key={i}
          style={[styles.codeBox, value[i] && styles.codeBoxFilled, focused && i === activeIndex && styles.codeBoxActive]}
        >
          <Text style={styles.codeDigit}>{value[i] || ""}</Text>
        </View>
      ))}
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(v) => onChangeText(v.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        caretHidden
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={styles.codeHidden}
        {...props}
      />
    </View>
  );
}

// ---------------------------------------------------------------- feedback

// tone: info | warning | danger | success | action
export function Banner({ tone = "info", icon, title, children, style, onPress }) {
  const t = bannerTones[tone];
  const Wrap = onPress ? Pressable : View;
  return (
    <Wrap onPress={onPress} style={[styles.banner, { backgroundColor: t.bg, borderColor: t.line }, style]}>
      <View style={[styles.bannerIcon, { backgroundColor: t.iconBg }]}>
        <Ionicons name={icon || t.icon} size={16} color={t.fg} />
      </View>
      <View style={{ flex: 1 }}>
        {title && <Text style={[styles.bannerTitle, { color: t.fg }]}>{title}</Text>}
        {typeof children === "string" ? <Text style={[styles.bannerText, { color: t.ink }]}>{children}</Text> : children}
      </View>
      {onPress && <Ionicons name="chevron-forward" size={16} color={t.fg} style={{ alignSelf: "center" }} />}
    </Wrap>
  );
}

export function Pill({ label, color = colors.muted, soft = true, icon }) {
  return (
    <View style={[styles.pill, { backgroundColor: soft ? `${color}1A` : color }]}>
      {icon && <Ionicons name={icon} size={11} color={soft ? color : "#fff"} />}
      <Text style={[styles.pillText, { color: soft ? color : "#fff" }]}>{label}</Text>
    </View>
  );
}

export function StatePill({ state }) {
  const color = STATE_COLORS[state] || colors.muted;
  return (
    <View style={[styles.pill, { backgroundColor: `${color}1A` }]}>
      <View style={[styles.pillDot, { backgroundColor: color }]} />
      <Text style={[styles.pillText, { color }]}>{STATE_LABELS[state] || state}</Text>
    </View>
  );
}

export function EmptyState({ icon, title, text, style, action }) {
  return (
    <View style={[styles.empty, style]}>
      <View style={styles.emptyIconOuter}>
        <View style={styles.emptyIcon}>
          <Ionicons name={icon} size={26} color={colors.indigo} />
        </View>
      </View>
      {title && <Text style={styles.emptyTitle}>{title}</Text>}
      {text && <Text style={styles.emptyText}>{text}</Text>}
      {action}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.ink} />
    </View>
  );
}

// ---------------------------------------------------------------- signed-out layout

// Dark brand panel on top, white sheet with the form underneath.
export function AuthLayout({ icon = "lock-closed", title, subtitle, children, footer, onBack }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={styles.authRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled" bounces={false}>
        <View style={[styles.authTop, { paddingTop: insets.top + 24 }]}>
          <View pointerEvents="none" style={styles.authGlowA} />
          <View pointerEvents="none" style={styles.authGlowB} />
          {onBack && (
            <Pressable onPress={onBack} hitSlop={12} style={[styles.authBack, { top: insets.top + 12 }]}>
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </Pressable>
          )}
          <View style={styles.authMark}>
            <Ionicons name={icon} size={28} color="#fff" />
          </View>
          <Text style={styles.authBrand}>Digital Legacy Vault</Text>
          <Text style={styles.authTitle}>{title}</Text>
          {subtitle && <Text style={styles.authSubtitle}>{subtitle}</Text>}
        </View>
        <View style={[styles.authSheet, { paddingBottom: insets.bottom + 28 }]}>
          {children}
          {footer}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function LinkText({ children, onPress, prefix, style }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={[styles.linkRow, style]}>
      <Text style={styles.linkPrefix}>
        {prefix ? `${prefix} ` : ""}
        <Text style={styles.link}>{children}</Text>
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------- styles

const buttonVariants = {
  primary: { box: { backgroundColor: colors.ink, ...shadow.card }, text: { color: "#fff" } },
  secondary: { box: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }, text: { color: colors.ink } },
  danger: { box: { backgroundColor: colors.redSoft, borderWidth: 1, borderColor: colors.redLine }, text: { color: colors.redInk } },
  dangerSolid: { box: { backgroundColor: colors.red }, text: { color: "#fff" } },
  ghost: { box: { backgroundColor: "transparent" }, text: { color: colors.muted } },
  light: { box: { backgroundColor: "#fff" }, text: { color: colors.ink } },
};

const bannerTones = {
  info: { bg: colors.surface, line: colors.line, fg: colors.body, ink: colors.body, iconBg: colors.hairline, icon: "information-circle" },
  action: { bg: colors.indigoSoft, line: colors.indigoLine, fg: colors.indigoInk, ink: colors.indigoInk, iconBg: "#e0e7ff", icon: "alert-circle" },
  warning: { bg: colors.amberSoft, line: "#fde68a", fg: "#b45309", ink: colors.amberInk, iconBg: "#fef3c7", icon: "warning" },
  danger: { bg: colors.redSoft, line: colors.redLine, fg: colors.redInk, ink: colors.redInk, iconBg: "#fee2e2", icon: "alert-circle" },
  success: { bg: colors.greenSoft, line: "#bbf7d0", fg: colors.greenInk, ink: colors.greenInk, iconBg: "#dcfce7", icon: "checkmark-circle" },
};

const toneCard = StyleSheet.create({
  action: { borderColor: colors.indigoLine, backgroundColor: "#fbfbff" },
  admin: { borderColor: colors.violetSoft, backgroundColor: "#fdfaff" },
  danger: { borderColor: colors.redLine, backgroundColor: "#fffafa" },
});

const styles = StyleSheet.create({
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  dim: { opacity: 0.45 },
  invisible: { opacity: 0 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...shadow.card,
  },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18, marginBottom: 10 },
  sectionLabel: { fontSize: 12, fontWeight: "800", color: colors.faint, textTransform: "uppercase", letterSpacing: 0.8 },

  pageHeader: { flexDirection: "row", alignItems: "flex-end", marginBottom: 18 },
  pageTitle: { fontSize: 30, fontWeight: "800", color: colors.ink, letterSpacing: -0.6 },
  pageSubtitle: { fontSize: 14, color: colors.muted, marginTop: 4, lineHeight: 20 },

  hero: { backgroundColor: colors.ink, borderRadius: radius.xl, padding: 20, marginBottom: 16, overflow: "hidden" },
  glowA: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
    top: -110,
    right: -70,
    backgroundColor: "rgba(99,102,241,0.38)",
  },
  glowB: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    bottom: -100,
    left: -50,
    backgroundColor: "rgba(14,165,233,0.16)",
  },
  heroTop: { flexDirection: "row", alignItems: "center" },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: onDark.glassStrong,
    borderWidth: 1,
    borderColor: onDark.glassLine,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  heroHeading: { flex: 1 },
  heroEyebrow: { fontSize: 11, fontWeight: "800", color: onDark.accent, textTransform: "uppercase", letterSpacing: 1.1, marginBottom: 3 },
  heroTitle: { fontSize: 21, fontWeight: "800", color: onDark.title, letterSpacing: -0.3 },
  heroSubtitle: { fontSize: 13.5, color: onDark.body, lineHeight: 20, marginTop: 14 },
  heroStats: {
    flexDirection: "row",
    backgroundColor: onDark.glass,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: radius.lg,
    paddingVertical: 12,
    marginTop: 18,
  },
  heroStat: { flex: 1, alignItems: "center", paddingHorizontal: 4 },
  heroStatValue: { fontSize: 21, fontWeight: "800", color: "#fff", fontVariant: ["tabular-nums"] },
  heroStatLabel: { fontSize: 11, color: onDark.muted, marginTop: 2, fontWeight: "600" },
  heroStatDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.1)" },
  heroPills: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 16 },
  heroPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: onDark.glassStrong,
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  heroPillText: { fontSize: 11.5, fontWeight: "700", color: "#e2e8f0" },

  actionBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingHorizontal: 20,
    paddingTop: 12,
    flexDirection: "row",
    gap: 10,
  },

  iconBadge: { alignItems: "center", justifyContent: "center" },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "800" },
  countBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
  },
  countBadgeText: { color: "#fff", fontSize: 11.5, fontWeight: "800" },

  divider: { flexDirection: "row", alignItems: "center", marginVertical: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.hairline },
  dividerText: { fontSize: 12, color: colors.faint, marginHorizontal: 12, fontWeight: "600" },

  listItem: { flexDirection: "row", alignItems: "center", padding: 14, marginBottom: 10 },
  listBody: { flex: 1, marginLeft: 14, marginRight: 8 },
  listTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  listSubtitle: { fontSize: 12.5, color: colors.muted, marginTop: 2, lineHeight: 17 },

  seg: { flexDirection: "row", backgroundColor: "#eef2f7", borderRadius: radius.lg, padding: 4, marginBottom: 16 },
  segItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 12,
  },
  segItemActive: { backgroundColor: colors.surface, ...shadow.card },
  segText: { fontSize: 13, fontWeight: "700", color: colors.muted },
  segTextActive: { color: colors.ink },
  segCount: { minWidth: 20, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: "#e2e8f0", alignItems: "center", justifyContent: "center" },
  segCountActive: { backgroundColor: colors.ink },
  segCountAlert: { backgroundColor: colors.indigo },
  segCountText: { fontSize: 10.5, fontWeight: "800", color: colors.muted },
  segCountTextActive: { color: "#fff" },

  life: { flexDirection: "row" },
  lifeStep: { flex: 1, alignItems: "center" },
  lifeTrack: { flexDirection: "row", alignItems: "center", alignSelf: "stretch" },
  lifeLine: { flex: 1, height: 2, backgroundColor: colors.line },
  lifeLineOn: { backgroundColor: colors.ink },
  lifeDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  lifeDotDone: { backgroundColor: colors.ink, borderColor: colors.ink },
  lifeDotInner: { width: 8, height: 8, borderRadius: 4 },
  lifeLabel: { fontSize: 10.5, fontWeight: "700", color: colors.faint, marginTop: 6 },
  lifeLabelDone: { color: colors.ink },

  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.md + 2,
    paddingVertical: 15,
    paddingHorizontal: 18,
    minHeight: 52,
  },
  buttonCompact: { paddingVertical: 10, paddingHorizontal: 14, minHeight: 42, borderRadius: radius.md },
  buttonText: { fontSize: 15.5, fontWeight: "700", letterSpacing: 0.1 },
  buttonTextCompact: { fontSize: 14 },

  fieldWrap: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: "700", color: colors.text, marginBottom: 7 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.canvas,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md + 2,
    paddingHorizontal: 14,
  },
  fieldFocused: { borderColor: colors.indigo, backgroundColor: colors.surface },
  fieldDisabled: { backgroundColor: colors.hairline, borderColor: colors.hairline },
  fieldIcon: { marginRight: 10 },
  fieldInput: { flex: 1, fontSize: 15.5, color: colors.ink, paddingVertical: 13 },
  fieldEye: { paddingLeft: 8 },
  fieldHint: { fontSize: 12, color: colors.faint, marginTop: 6, lineHeight: 17 },

  codeRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginBottom: 20 },
  codeBox: {
    flex: 1,
    aspectRatio: 0.82,
    maxHeight: 64,
    borderRadius: radius.md + 2,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  codeBoxFilled: { borderColor: colors.ink, backgroundColor: colors.surface },
  codeBoxActive: { borderColor: colors.indigo, backgroundColor: colors.surface, borderWidth: 2 },
  codeDigit: { fontSize: 24, fontWeight: "800", color: colors.ink },
  codeHidden: { ...StyleSheet.absoluteFillObject, opacity: 0.01, color: "transparent" },

  banner: { flexDirection: "row", borderRadius: radius.lg, borderWidth: 1, padding: 12, marginBottom: 14, gap: 12 },
  bannerIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  bannerTitle: { fontSize: 14, fontWeight: "800", marginBottom: 2 },
  bannerText: { fontSize: 13, lineHeight: 19 },

  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 11.5, fontWeight: "700" },

  empty: { alignItems: "center", paddingVertical: 32, paddingHorizontal: 28 },
  emptyIconOuter: { padding: 8, borderRadius: 28, backgroundColor: "#f5f7ff" },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: colors.indigoSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: colors.ink, marginTop: 16 },
  emptyText: { fontSize: 13.5, color: colors.muted, textAlign: "center", marginTop: 6, lineHeight: 20 },

  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },

  authRoot: { flex: 1, backgroundColor: colors.ink },
  authScroll: { flexGrow: 1 },
  authTop: { alignItems: "center", paddingHorizontal: 28, paddingBottom: 56, overflow: "hidden" },
  authGlowA: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 160,
    top: -140,
    right: -120,
    backgroundColor: "rgba(99,102,241,0.35)",
  },
  authGlowB: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
    bottom: -120,
    left: -90,
    backgroundColor: "rgba(14,165,233,0.18)",
  },
  authBack: {
    position: "absolute",
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: onDark.glassStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  authMark: {
    width: 64,
    height: 64,
    borderRadius: 21,
    backgroundColor: onDark.glassStrong,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
  },
  authBrand: { fontSize: 11, fontWeight: "800", color: onDark.accent, textTransform: "uppercase", letterSpacing: 1.6, marginTop: 18 },
  authTitle: { fontSize: 27, fontWeight: "800", color: "#fff", textAlign: "center", letterSpacing: -0.5, marginTop: 8 },
  authSubtitle: { fontSize: 14.5, color: onDark.body, textAlign: "center", marginTop: 8, lineHeight: 21 },
  authSheet: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    marginTop: -28,
    paddingHorizontal: 24,
    paddingTop: 30,
  },

  linkRow: { alignSelf: "center", marginTop: 22, padding: 4 },
  linkPrefix: { fontSize: 14, color: colors.muted, textAlign: "center" },
  link: { color: colors.indigo, fontWeight: "800" },
});
