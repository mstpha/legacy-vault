// Shared design tokens. The palette comes from the Home screen: slate navy as the brand colour,
// an off-white canvas, white cards with a faint border + soft shadow, and saturated icon badges.
export const colors = {
  ink: "#0f172a", // brand / primary buttons / titles
  text: "#334155",
  body: "#475569",
  muted: "#64748b",
  faint: "#94a3b8",
  ghost: "#cbd5e1",
  line: "#e2e8f0",
  hairline: "#f1f5f9",
  canvas: "#f8fafc",
  surface: "#ffffff",

  indigo: "#6366f1",
  indigoSoft: "#eef2ff",
  indigoInk: "#4338ca",
  indigoLine: "#c7d2fe",
  violet: "#a855f7",
  violetSoft: "#f3e8ff",
  violetInk: "#9333ea",
  sky: "#0ea5e9",
  teal: "#14b8a6",
  green: "#22c55e",
  greenInk: "#15803d",
  greenSoft: "#f0fdf4",
  amber: "#f59e0b",
  amberInk: "#92400e",
  amberSoft: "#fffbeb",
  red: "#ef4444",
  redInk: "#b91c1c",
  redSoft: "#fef2f2",
  redLine: "#fecaca",
};

export const radius = { sm: 10, md: 12, lg: 16, xl: 22, pill: 999 };

// Colours that only make sense on the dark navy hero surfaces.
export const onDark = {
  title: "#ffffff",
  body: "#cbd5e1",
  muted: "#94a3b8",
  accent: "#a5b4fc",
  glass: "rgba(255,255,255,0.08)",
  glassStrong: "rgba(255,255,255,0.12)",
  glassLine: "rgba(255,255,255,0.12)",
};

export const shadow = {
  card: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  hero: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 4,
  },
};

// Capsule lifecycle, shared by every screen that shows a capsule's state.
export const STATE_LABELS = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  INACTIVITY_ALERT: "Inactivity alert",
  PENDING_VALIDATION: "Pending validation",
  UNLOCKED: "Unlocked",
  ARCHIVED: "Opened",
  REVOKED: "Revoked",
};

export const STATE_COLORS = {
  DRAFT: "#64748b",
  ACTIVE: "#16a34a",
  INACTIVITY_ALERT: "#d97706",
  PENDING_VALIDATION: "#6366f1",
  UNLOCKED: "#0ea5e9",
  ARCHIVED: "#64748b",
  REVOKED: "#ef4444",
};

// The happy path a capsule moves through (REVOKED is off-path, ARCHIVED = unlocked and read).
export const LIFECYCLE = [
  ["DRAFT", "Draft"],
  ["ACTIVE", "Active"],
  ["INACTIVITY_ALERT", "Alert"],
  ["PENDING_VALIDATION", "Validation"],
  ["UNLOCKED", "Unlocked"],
];

export const TYPE_ICONS = {
  DOCUMENT: "document-text",
  CREDENTIAL: "key",
  MESSAGE: "chatbubble-ellipses",
  IMAGE: "image",
};
