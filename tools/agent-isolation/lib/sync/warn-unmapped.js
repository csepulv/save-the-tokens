// sync/warn-unmapped.js — Phase E: detect host paths Phase C didn't cover.
//
// Any remaining ${HOME}/... string in a synced config file means Phase C
// had no mount-driven mapping for it; the container will see a broken
// reference. Diagnostic, not a hard error. (.claude.json is deliberately
// NOT swept — it accumulates cosmetic host cwds that don't need mounting.)

const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Mirrors `grep -oE "${HOME}[^\"]*" | head -1`: the first home-rooted path,
// stopping at a double-quote. Returns null when none remain.
export function firstUnmappedHomePath(text, home) {
  const match = text.match(new RegExp(`${escapeRegExp(home)}[^"]*`));
  return match ? match[0] : null;
}
