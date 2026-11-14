// Best-effort in-memory login throttle: 5 failed attempts per IP per 15 minutes.
// On Vercel each function instance keeps its own map, so this slows brute force
// rather than stopping it outright. A strong password is the real defence.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const failures = new Map<string, { count: number; resetAt: number }>();

export function isLocked(ip: string): number {
  const entry = failures.get(ip);
  if (!entry) return 0;
  if (Date.now() > entry.resetAt) {
    failures.delete(ip);
    return 0;
  }
  return entry.count >= MAX_FAILURES ? Math.ceil((entry.resetAt - Date.now()) / 1000) : 0;
}

export function recordFailure(ip: string) {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry || now > entry.resetAt) {
    failures.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export function clearFailures(ip: string) {
  failures.delete(ip);
}
