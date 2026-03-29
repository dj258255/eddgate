/**
 * eddgate Liquid Glass Theme
 *
 * Terminal adaptation of Apple's Liquid Glass design language:
 * - Layered depth with subtle fg/bg contrast
 * - Soft unicode borders (rounded corners where possible)
 * - Cool blue-cyan-white gradient palette
 * - Muted backgrounds for depth, bright accents for focus
 * - Consistent spacing and alignment
 */

// ─── Color Palette ─────────────────────────────────────────
// Inspired by Liquid Glass: translucent blues, frosted whites, depth grays

export const palette = {
  // Primary surface colors (layered depth)
  bg: {
    deep: "#0a0e14",       // Deepest background (screen)
    surface: "#111820",    // Card/panel surface
    elevated: "#1a2332",   // Elevated panels (hover, focus)
    overlay: "#222d3d",    // Overlay/modal background
  },

  // Border colors (frosted glass edge effect)
  border: {
    subtle: "#2a3a4a",     // Default border (barely visible)
    soft: "#3d5066",       // Soft active border
    focus: "#5b8fb9",      // Focus ring (cyan-blue)
    accent: "#7ec8e3",     // Accent border (highlight)
    glow: "#a8e0f7",       // Glow effect border
  },

  // Text colors
  text: {
    primary: "#e8edf3",    // Primary text (bright white-blue)
    secondary: "#8b9bb4",  // Secondary text (muted)
    muted: "#546478",      // Tertiary/hint text
    inverse: "#0a0e14",    // Text on bright backgrounds
  },

  // Semantic colors
  status: {
    success: "#4ade80",    // Green (pass, ok)
    error: "#f87171",      // Red (fail, error)
    warning: "#fbbf24",    // Yellow (flag, warn)
    info: "#60a5fa",       // Blue (info)
    running: "#22d3ee",    // Cyan (in-progress)
  },

  // Accent gradient (Liquid Glass shimmer)
  accent: {
    primary: "#7ec8e3",    // Primary accent (sky blue)
    secondary: "#5b8fb9",  // Secondary accent (steel blue)
    tertiary: "#a78bfa",   // Tertiary accent (lavender)
    highlight: "#e0f2fe",  // Highlight (ice white-blue)
  },
} as const;

// ─── Unicode Characters ─────────────────────────────────────

export const glyphs = {
  // Status indicators
  pass: "\u2713",          // check mark
  fail: "\u2717",          // ballot x
  warn: "\u26A0",          // warning sign
  running: "\u25B6",       // play triangle
  pending: "\u25CB",       // circle
  bullet: "\u2022",        // bullet
  arrow: "\u2192",         // right arrow
  arrowDown: "\u2193",     // down arrow

  // Bars and gauges
  barFull: "\u2588",       // full block
  barHigh: "\u2593",       // dark shade
  barMid: "\u2592",        // medium shade
  barLow: "\u2591",        // light shade
  barEmpty: " ",

  // Box drawing (for tables)
  hLine: "\u2500",         // horizontal line
  vLine: "\u2502",         // vertical line
  topLeft: "\u256D",       // rounded corner
  topRight: "\u256E",
  bottomLeft: "\u2570",
  bottomRight: "\u256F",
  teeRight: "\u251C",      // right tee
  teeLeft: "\u2524",       // left tee
  cross: "\u253C",         // cross
  teeDown: "\u252C",       // down tee
  teeUp: "\u2534",         // up tee

  // Decorative
  diamond: "\u25C6",
  dot: "\u00B7",           // middle dot
  ellipsis: "\u2026",      // horizontal ellipsis
  separator: "\u2500\u2500\u2500",
} as const;

// ─── Blessed Style Presets ──────────────────────────────────

export const styles = {
  // Screen
  screen: {
    smartCSR: true,
    fullUnicode: true,
    title: "eddgate",
    cursor: { artificial: true, shape: "line", blink: true, color: palette.accent.primary },
  },

  // Main panel (frosted glass card)
  panel: {
    border: { type: "line" as const },
    style: {
      border: { fg: palette.border.soft },
      bg: palette.bg.surface,
      fg: palette.text.primary,
    },
    padding: { left: 1, right: 1 },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      style: { bg: palette.border.subtle },
    },
  },

  // Elevated panel (focused, higher z-layer)
  panelFocused: {
    border: { type: "line" as const },
    style: {
      border: { fg: palette.border.focus },
      bg: palette.bg.elevated,
      fg: palette.text.primary,
      focus: { border: { fg: palette.border.accent } },
    },
    padding: { left: 1, right: 1 },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      style: { bg: palette.border.focus },
    },
  },

  // Header bar (solid accent background)
  header: {
    style: {
      bg: palette.bg.deep,
      fg: palette.accent.primary,
      bold: true,
    },
    height: 1,
  },

  // Status bar (bottom)
  statusBar: {
    style: {
      bg: palette.bg.deep,
      fg: palette.text.muted,
    },
    height: 1,
  },

  // Menu list
  menu: {
    border: { type: "line" as const },
    style: {
      border: { fg: palette.border.subtle },
      bg: palette.bg.surface,
      fg: palette.text.secondary,
      selected: {
        fg: palette.accent.highlight,
        bg: palette.bg.elevated,
        bold: true,
      },
      focus: {
        border: { fg: palette.border.focus },
      },
    },
    padding: { left: 1, right: 1 },
  },

  // Log box (command output capture)
  logBox: {
    border: { type: "line" as const },
    style: {
      border: { fg: palette.border.soft },
      bg: palette.bg.surface,
      fg: palette.text.primary,
    },
    padding: { left: 1, right: 1 },
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: true,
    vi: true,
    scrollbar: {
      style: { bg: palette.border.subtle },
    },
  },

  // Table row styles
  table: {
    headerFg: palette.accent.primary,
    rowFg: palette.text.primary,
    altRowBg: palette.bg.elevated,
    borderFg: palette.border.subtle,
  },
} as const;

// ─── Formatting Helpers ─────────────────────────────────────

/**
 * Blessed tag wrapper -- wraps text in blessed markup tags.
 */
export function fg(color: string, text: string): string {
  return `{${color}-fg}${text}{/${color}-fg}`;
}

export function bold(text: string): string {
  return `{bold}${text}{/bold}`;
}

/**
 * Status badge with icon and color.
 */
export function statusBadge(status: string): string {
  switch (status) {
    case "success":
    case "ok":
    case "pass":
      return `{green-fg}${glyphs.pass} ${status.toUpperCase()}{/green-fg}`;
    case "failed":
    case "fail":
    case "error":
      return `{red-fg}${glyphs.fail} ${status.toUpperCase()}{/red-fg}`;
    case "flagged":
    case "warning":
    case "warn":
      return `{yellow-fg}${glyphs.warn} ${status.toUpperCase()}{/yellow-fg}`;
    case "running":
    case "in_progress":
      return `{cyan-fg}${glyphs.running} ${status.toUpperCase()}{/cyan-fg}`;
    case "skipped":
    case "pending":
      return `{gray-fg}${glyphs.pending} ${status.toUpperCase()}{/gray-fg}`;
    default:
      return `{white-fg}${status}{/white-fg}`;
  }
}

/**
 * Score bar (0-1 range) with color gradient.
 */
export function scoreBar(score: number, width = 20): string {
  const filled = Math.round(score * width);
  const empty = width - filled;

  let color = "red";
  if (score >= 0.7) color = "green";
  else if (score >= 0.4) color = "yellow";

  const bar = glyphs.barFull.repeat(filled) + glyphs.barLow.repeat(empty);
  return `{${color}-fg}${bar}{/${color}-fg} ${(score * 100).toFixed(0)}%`;
}

/**
 * Percentage gauge (horizontal bar).
 */
export function gauge(value: number, max: number, width = 20): string {
  const ratio = max > 0 ? value / max : 0;
  const filled = Math.round(ratio * width);
  const empty = width - filled;

  let color = "cyan";
  if (ratio >= 0.8) color = "green";
  else if (ratio >= 0.5) color = "yellow";
  else if (ratio < 0.3) color = "red";

  return `{${color}-fg}${glyphs.barFull.repeat(filled)}{/${color}-fg}${glyphs.barLow.repeat(empty)}`;
}

/**
 * Format a key-value pair for display.
 */
export function kvPair(key: string, value: string, keyWidth = 16): string {
  const paddedKey = key.padEnd(keyWidth);
  return `{gray-fg}${paddedKey}{/gray-fg} ${value}`;
}

/**
 * Section header with decorative line.
 */
export function sectionHeader(title: string, width = 50): string {
  const lineLen = Math.max(0, width - title.length - 4);
  const line = glyphs.hLine.repeat(lineLen);
  return `{bold}{cyan-fg}${glyphs.diamond} ${title} ${line}{/cyan-fg}{/bold}`;
}

/**
 * Format table row with padding.
 */
export function tableRow(cols: string[], widths: number[]): string {
  return cols.map((col, i) => col.padEnd(widths[i] ?? 12)).join("  ");
}

/**
 * Format milliseconds to human-readable.
 */
export function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}

/**
 * Format token count.
 */
export function fmtTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1000000).toFixed(2)}M`;
}

/**
 * Format cost.
 */
export function fmtCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}
