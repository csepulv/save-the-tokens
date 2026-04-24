// parseArgs doesn't support optional string values.
// Extracts a flag and its optional non-flag argument from argv.
// Returns { value, remaining } where value is:
//   undefined  → flag not present
//   true       → flag present with no argument
//   string     → flag present with argument
export function extractOptionalFlag(argv, flagName) {
  const idx = argv.indexOf(flagName);
  if (idx === -1) return { value: undefined, remaining: argv };

  const remaining = [...argv];
  remaining.splice(idx, 1);

  const next = argv[idx + 1];
  if (next && !next.startsWith('-')) {
    remaining.splice(idx, 1);
    return { value: next, remaining };
  }

  return { value: true, remaining };
}
