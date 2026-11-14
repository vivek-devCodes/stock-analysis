import "server-only";

/**
 * A small, polite HTTP fetcher written from scratch for the news crawler.
 *
 * Not getting blocked comes from behaving well, not from disguising the crawler:
 *  - obeys robots.txt (cached 24 h) and never fetches a disallowed path
 *  - one request at a time per host, at least MIN_GAP_MS apart
 *  - conditional GET (ETag / Last-Modified) so unchanged feeds cost the site ~nothing
 *  - backs off on 429/503 and honours Retry-After; stops calling a host that keeps failing
 *  - identifies itself with an honest User-Agent and a timeout; caps response size
 * It deliberately does NOT rotate IPs, spoof browsers or solve CAPTCHAs.
 */

// Same convention as Googlebot/Bingbot: "Mozilla/5.0 (compatible; <name>/<version>; <info>)".
export const CRAWLER_UA = "Mozilla/5.0 (compatible; ApexDeskNewsReader/1.0; personal market-news reader; respects robots.txt)";
const ROBOTS_UA_TOKEN = "apexdesknewsreader";
const MIN_GAP_MS = 5_000;
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 3_000_000;
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;

type Rules = { allow: string[]; disallow: string[] };
const robotsCache = new Map<string, { at: number; rules: Rules }>();
const hostQueue = new Map<string, Promise<unknown>>();
const hostLastAt = new Map<string, number>();
const backoffUntil = new Map<string, number>();
const failures = new Map<string, number>();
const conditional = new Map<string, { etag?: string; lastModified?: string; body: string }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------- robots.txt ---------------------------- */

function parseRobots(text: string): Rules {
  // Collect the group for our UA if present, otherwise the "*" group.
  const groups: Array<{ agents: string[]; rules: Rules }> = [];
  let current: { agents: string[]; rules: Rules } | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [] } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "disallow" && value) current.rules.disallow.push(value);
    if (key === "allow" && value) current.rules.allow.push(value);
  }
  const mine = groups.find((g) => g.agents.includes(ROBOTS_UA_TOKEN));
  return (mine ?? groups.find((g) => g.agents.includes("*")))?.rules ?? { allow: [], disallow: [] };
}

function ruleMatches(rule: string, path: string) {
  const anchored = rule.endsWith("$");
  const pattern = (anchored ? rule.slice(0, -1) : rule)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(path);
}

/** Longest matching rule wins; Allow wins ties (Google's interpretation). */
function isAllowed(rules: Rules, path: string) {
  let verdict = true;
  let best = -1;
  for (const r of rules.disallow) if (ruleMatches(r, path) && r.length > best) [verdict, best] = [false, r.length];
  for (const r of rules.allow) if (ruleMatches(r, path) && r.length >= best) [verdict, best] = [true, r.length];
  return verdict;
}

async function robotsFor(origin: string): Promise<Rules> {
  const hit = robotsCache.get(origin);
  if (hit && Date.now() - hit.at < ROBOTS_TTL_MS) return hit.rules;
  let rules: Rules = { allow: [], disallow: [] };
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": CRAWLER_UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok) rules = parseRobots(await res.text());
    else if (res.status === 401 || res.status === 403) rules = { allow: [], disallow: ["/"] }; // treat as "keep out"
  } catch {
    // Unreachable robots.txt → allowed, per the robots standard (RFC 9309).
  }
  robotsCache.set(origin, { at: Date.now(), rules });
  return rules;
}

/* ------------------------------ fetching ----------------------------- */

export class CrawlError extends Error {}

async function doFetch(url: URL): Promise<string> {
  const host = url.host;
  const until = backoffUntil.get(host) ?? 0;
  if (Date.now() < until) throw new CrawlError(`${host} asked us to back off until ${new Date(until).toISOString()}`);

  const rules = await robotsFor(url.origin);
  if (!isAllowed(rules, url.pathname + url.search)) throw new CrawlError(`robots.txt disallows ${url.pathname}`);

  const wait = (hostLastAt.get(host) ?? 0) + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  hostLastAt.set(host, Date.now());

  const prior = conditional.get(url.href);
  const res = await fetch(url, {
    headers: {
      "User-Agent": CRAWLER_UA,
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
      "Accept-Language": "en-IN,en;q=0.8",
      ...(prior?.etag ? { "If-None-Match": prior.etag } : {}),
      ...(prior?.lastModified ? { "If-Modified-Since": prior.lastModified } : {}),
    },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });

  if (res.status === 304 && prior) {
    failures.delete(host);
    return prior.body;
  }
  if (res.status === 429 || res.status === 503) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const ms = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 15 * 60 * 1000;
    backoffUntil.set(host, Date.now() + ms);
    throw new CrawlError(`${host} rate-limited us (HTTP ${res.status}); pausing ${Math.round(ms / 60000)} min`);
  }
  if (!res.ok) {
    const n = (failures.get(host) ?? 0) + 1;
    failures.set(host, n);
    if (n >= 3) backoffUntil.set(host, Date.now() + Math.min(60, 5 * 2 ** n) * 60 * 1000);
    throw new CrawlError(`HTTP ${res.status} from ${host}`);
  }

  const length = Number(res.headers.get("content-length"));
  if (length > MAX_BYTES) throw new CrawlError(`${host} response too large (${length} bytes)`);
  const body = await res.text();
  if (body.length > MAX_BYTES) throw new CrawlError(`${host} response too large`);

  failures.delete(host);
  conditional.set(url.href, {
    etag: res.headers.get("etag") ?? undefined,
    lastModified: res.headers.get("last-modified") ?? undefined,
    body,
  });
  return body;
}

/** Fetch text politely. Requests to the same host are queued one after another. */
export function politeFetch(input: string): Promise<string> {
  const url = new URL(input);
  if (url.protocol !== "https:" && url.protocol !== "http:") return Promise.reject(new CrawlError("unsupported protocol"));
  const previous = hostQueue.get(url.host) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => doFetch(url));
  hostQueue.set(url.host, next);
  return next;
}
