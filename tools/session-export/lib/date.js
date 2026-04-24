/**
 * Parse a date string into a local-time Date.
 *
 * Accepts:
 *   YYYY-MM-DD              — date only
 *   YYYY-MM-DDTHH:MM:SS     — date and time
 *
 * When endOfDay is true and no time component is given, the returned Date
 * is set to 23:59:59.999 of that day (useful for inclusive --before bounds).
 */
export function parseDateArg(str, { endOfDay = false } = {}) {
  const dateOnlyMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dateTimeMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);

  if (!dateOnlyMatch && !dateTimeMatch) {
    throw new Error(`Invalid date "${str}". Use YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS.`);
  }

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch.map(Number);
    return endOfDay
      ? new Date(year, month - 1, day, 23, 59, 59, 999)
      : new Date(year, month - 1, day, 0, 0, 0, 0);
  }

  const [, year, month, day, hours, minutes, seconds] = dateTimeMatch.map(Number);
  return new Date(year, month - 1, day, hours, minutes, seconds);
}
