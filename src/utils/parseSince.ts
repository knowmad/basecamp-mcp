/**
 * Parse a "since" value into a Date object, used by the activity feed and
 * campfire browsing tools to filter results to a recent time window.
 *
 * Supports:
 * - Relative durations: "24h", "7d", "2w"
 * - Keywords: "today", "yesterday"
 * - ISO 8601 dates: "2024-01-15", "2024-01-15T10:00:00Z"
 */
export function parseSince(value: string): Date {
  const now = new Date();
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();

  // Relative durations: Nh, Nd, Nw
  const hourMatch = lower.match(/^(\d+)h$/);
  if (hourMatch) {
    return new Date(
      now.getTime() - Number.parseInt(hourMatch[1], 10) * 3600000,
    );
  }

  const dayMatch = lower.match(/^(\d+)d$/);
  if (dayMatch) {
    return new Date(
      now.getTime() - Number.parseInt(dayMatch[1], 10) * 86400000,
    );
  }

  const weekMatch = lower.match(/^(\d+)w$/);
  if (weekMatch) {
    return new Date(
      now.getTime() - Number.parseInt(weekMatch[1], 10) * 7 * 86400000,
    );
  }

  // Keywords
  if (lower === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (lower === "yesterday") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // ISO 8601 / date string
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid since value: "${value}". ` +
        'Use ISO 8601 (e.g., "2024-01-15"), relative duration (e.g., "24h", "7d", "2w"), ' +
        'or keyword ("today", "yesterday").',
    );
  }
  return parsed;
}
