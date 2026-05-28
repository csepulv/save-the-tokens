const REDACTION_PATTERNS = [
  // Environment variable assignments: TOKEN=value, SECRET=value, etc.
  {
    pattern: /\b(TOKEN|SECRET|PASSWORD|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET)=\S+/gi,
    replacement: '$1=[REDACTED]',
  },
  // AWS access keys
  {
    pattern: /\b(AKIA[A-Z0-9]{16})\b/g,
    replacement: '[REDACTED]',
  },
  // Bearer tokens
  {
    pattern: /(Bearer\s+)[^\s"']+/gi,
    replacement: '$1[REDACTED]',
  },
  // JWTs — three base64url-encoded segments separated by dots, both
  // header and payload start with `eyJ` (base64 of `{"`). Catches
  // standalone JWTs in JSON values, URL params, HTML script blocks,
  // and any free-form text. Two-segment strings (incomplete JWTs)
  // and short eyJ-prefixed strings without the full structure don't
  // match.
  {
    pattern: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replacement: '[REDACTED JWT]',
  },
  // GitHub tokens
  {
    pattern: /\b(ghp_|gho_|ghs_|github_pat_)[A-Za-z0-9_]+/g,
    replacement: '[REDACTED]',
  },
  // Basic auth in URLs: https://user:pass@host
  {
    pattern: /:\/\/([^:]+):([^@]+)@/g,
    replacement: '://[REDACTED]@',
  },
  // Private key blocks
  {
    pattern: /-----BEGIN\s+[\w\s]+PRIVATE KEY-----[\s\S]*?-----END\s+[\w\s]+PRIVATE KEY-----/g,
    replacement: '[REDACTED KEY BLOCK]',
  },
  // Database connection strings with passwords: postgres://user:pass@host
  {
    pattern: /((?:postgres|mysql|mongodb|redis):\/\/[^:]*):([^@]+)@/gi,
    replacement: '$1:[REDACTED]@',
  },
];

export function redactCredentials(text) {
  let result = text;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
