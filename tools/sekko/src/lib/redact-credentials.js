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
