/** The instant a user typed, for going back in the history. */

const UNIT_SECONDS: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
/** Below this, a plain number is not an epoch time anyone means. */
const EARLIEST_EPOCH = 1e9;
const DAY_MS = 86_400_000;

function timeOfDay(match: RegExpExecArray, now: number): number | undefined {
  const [hours, minutes, seconds] = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
  if (hours > 23 || minutes > 59 || seconds > 59) return undefined;
  const when = new Date(now * 1000);
  when.setHours(hours, minutes, seconds, 0);
  // The last time it was that: later today means yesterday.
  const time = when.getTime() > now * 1000 ? when.getTime() - DAY_MS : when.getTime();
  return time / 1000;
}

/**
 * Epoch seconds of `30m`, `2h` (that long ago), `14:02` (the last time it was
 * that), an ISO time or epoch seconds; `undefined` when it is none of them.
 * Turned into an instant here, so the views stay put while they are shown.
 */
export function parseInstant(text: string, now = Date.now() / 1000): number | undefined {
  const value = text.trim();
  const ago = /^(\d+(?:\.\d+)?)([smhdw])$/.exec(value);
  if (ago) return now - Number(ago[1]) * (UNIT_SECONDS[ago[2]] ?? 1);
  if (/^\d+(\.\d+)?$/.test(value)) {
    const epoch = Number(value);
    return epoch >= EARLIEST_EPOCH ? epoch : undefined;
  }
  const ofDay = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (ofDay) return timeOfDay(ofDay, now);
  if (!value.includes("-")) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed / 1000;
}
