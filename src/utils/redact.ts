// cmh-lite redaction rules port (claude-memory-daily/src/redaction).
// Used by perception_cache picker so passwords/keys never land in spontaneous recall.
// Workers have no process.env secret dump; env-value redaction is opt-in via argument.

const SECRET_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9\-]{20,}/g,
  /sk-ant-[a-zA-Z0-9\-]{20,}/g,
  /ghp_[a-zA-Z0-9]{36}/g,
  /gho_[a-zA-Z0-9]{36}/g,
  /glpat-[a-zA-Z0-9\-]{20}/g,
  /xox[baprs]-[a-zA-Z0-9\-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END/g,
  /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
  /Bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi,
  /password\s*[:=]\s*["'][^"']+["']/gi,
  /api[_-]?key\s*[:=]\s*["'][^"']+["']/gi,
  /secret\s*[:=]\s*["'][^"']+["']/gi,
  /token\s*[:=]\s*["'][a-zA-Z0-9\-._~+/]{8,}["']/gi
];

const ENV_VALUE_MIN_LENGTH = 8;

export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

export function redactEnvValues(
  text: string,
  env: Record<string, string | undefined>
): string {
  let result = text;
  for (const [key, value] of Object.entries(env)) {
    if (value && value.length >= ENV_VALUE_MIN_LENGTH) {
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(escaped, "g"), `$${key}`);
    }
  }
  return result;
}

export function redactText(
  text: string,
  env: Record<string, string | undefined> = {}
): string {
  return redactEnvValues(redactSecrets(text), env);
}

export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}
