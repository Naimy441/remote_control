// Fetches site icons for the tab strip. The agent (not the phone) makes the request, straight to
// the site the tab already has open, and caches the result as a small data URL per hostname.
const cache = new Map();
const failedAt = new Map();
const RETRY_MS = 5 * 60 * 1000;
const HEADERS = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15", accept: "image/*,*/*;q=0.8" };
const pending = new Map();
const MAX_BYTES = 40000;

function publicHost(host) {
  if (!/^[a-z0-9.-]+$/i.test(host) || !host.includes(".")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  return !/(^|\.)(local|localhost|internal|lan)$/i.test(host);
}

// Servers often mislabel icons (a PNG served as image/x-icon), which iOS refuses to draw.
function sniff(bytes, declared) {
  if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "image/png";
  if (bytes.subarray(0, 3).toString() === "GIF") return "image/gif";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return "image/x-icon";
  if (declared === "image/svg+xml") return declared;
  return "";
}

async function grab(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(3500), redirect: "follow", headers: HEADERS });
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return null;
  const type = sniff(bytes, (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase());
  if (!type) return null;
  return `data:${type};base64,${bytes.toString("base64")}`;
}

async function pageIcon(host) {
  const response = await fetch(`https://${host}/`, { signal: AbortSignal.timeout(3500), redirect: "follow", headers: { ...HEADERS, accept: "text/html" } });
  if (!response.ok) return null;
  const html = (await response.text()).slice(0, 200000);
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel=["'][^"']*\bicon\b/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      const icon = await grab(new URL(href, response.url).toString());
      if (icon) return icon;
    } catch {
      // Try the next icon link.
    }
  }
  return null;
}

async function fetchIcon(host) {
  try {
    const direct = await grab(`https://${host}/favicon.ico`);
    if (direct) return direct;
  } catch {
    // Fall back to the page's own icon link.
  }
  try {
    const linked = await pageIcon(host);
    if (linked) return linked;
  } catch {
    // Fall through to the icon service.
  }
  return null;
}

/**
 * The site's own icon, or "" when there is none worth showing. An icon that several different hosts return
 * (for example one generic logo for every subdomain of a company) says nothing about the page, so it is dropped.
 */
export function cachedFavicon(host) {
  const icon = cache.get(host) || "";
  if (!icon) return "";
  let owners = 0;
  for (const value of cache.values()) if (value === icon) owners++;
  return owners > 1 ? "" : icon;
}

/** Resolve icons for these hosts; resolves true when something new was cached. */
export async function loadFavicons(hosts) {
  let changed = false;
  await Promise.all(
    [...new Set(hosts)].filter(publicHost).map(async (host) => {
      if (cache.get(host)) return;
      if (Date.now() - (failedAt.get(host) ?? 0) < RETRY_MS) return;
      if (!pending.has(host)) pending.set(host, fetchIcon(host));
      const icon = await pending.get(host);
      pending.delete(host);
      if (icon) {
        cache.set(host, icon);
        changed = true;
      } else {
        failedAt.set(host, Date.now());
      }
    }),
  );
  return changed;
}
