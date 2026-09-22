#!/usr/bin/env node
// Generate episodes.json for the Ask The Professor shuffle player.
//
// Runs on YOUR machine (which can reach sites.udmercy.edu) and writes a static
// list of episode audio URLs. The player then just shuffles and plays that list,
// so it works even when a browser can't fetch the feed directly (CORS).
//
//   node generate-episodes.mjs
//   node generate-episodes.mjs --feed https://sites.udmercy.edu/atp/feed/ --max-pages 80
//
// Requires Node 18+ (built-in fetch + DOM-free XML parsing via regex).

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const FEED_CANDIDATES = [
  opt("feed", null),
  "https://sites.udmercy.edu/atp/feed/",
  "https://sites.udmercy.edu/atp/feed/podcast/",
  "https://sites.udmercy.edu/atp/category/news/feed/",
].filter(Boolean);

const MAX_PAGES = parseInt(opt("max-pages", "100"), 10);
const OUT = opt("out", "episodes.json");
const PAGE_DELAY_MS = parseInt(opt("page-delay-ms", "400"), 10);
const UA = "Mozilla/5.0 (atp-shuffle generator)";

const AUDIO_RE = /\.(mp3|m4a|aac|ogg|wav)(\?|$)/i;

function decodeEntities(s) {
  return (s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&").trim();
}

function stripHtml(s) {
  return (s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;|&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function tag(block, name) {
  const m = new RegExp("<" + name + "[^>]*>([\\s\\S]*?)<\\/" + name + ">", "i").exec(block);
  return m ? decodeEntities(m[1]) : "";
}

function titleFromUrl(u) {
  const m = /episode[-_]?(\d+)/i.exec(u);
  if (m) return "Episode " + m[1];
  try {
    const p = new URL(u).pathname.split("/").filter(Boolean).pop() || u;
    return decodeURIComponent(p).replace(/\.[a-z0-9]+$/i, "");
  } catch { return u; }
}

// Parse one RSS document's <item> blocks into episode objects.
function parseItems(xml) {
  const out = [];
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const block of items) {
    let url = "";
    // <enclosure url="..." type="audio/...">
    for (const enc of block.match(/<enclosure\b[^>]*>/gi) || []) {
      const u = (/\burl\s*=\s*"([^"]+)"/i.exec(enc) || [])[1] || "";
      const type = (/\btype\s*=\s*"([^"]+)"/i.exec(enc) || [])[1] || "";
      if (u && (/^audio/i.test(type) || AUDIO_RE.test(u))) { url = u; break; }
    }
    // Fallback: any audio URL anywhere in the item (content, media:content, links).
    if (!url) {
      const m = /https?:\/\/[^\s"'<>]+\.(?:mp3|m4a|aac|ogg|wav)(?:\?[^\s"'<>]*)?/i.exec(block);
      if (m) url = m[0];
    }
    if (!url) continue;
    out.push({
      title: tag(block, "title") || titleFromUrl(url),
      url,
      page: tag(block, "link"),
      date: tag(block, "pubDate"),
      description: stripHtml(tag(block, "description")),
    });
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry transient failures (dropped connections, 5xx, rate limiting). Without this a
// single blip mid-walk used to end the harvest early and silently truncate the archive.
async function fetchText(url, tries = 6) {
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml, */*" } });
      if (res.status === 404) throw Object.assign(new Error("HTTP 404 for " + url), { notFound: true });
      if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
      return res.text();
    } catch (e) {
      if (e.notFound) throw e; // a real end-of-archive, not worth retrying
      last = e;
      // Exponential backoff: the host throttles a fast walk with 403s, and those
      // clear after a few seconds.
      if (attempt < tries) await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw last;
}

// Walk a WordPress feed across paged=1..N until a page yields no new items.
async function harvest(baseFeed) {
  const all = new Map(); // url -> episode
  for (let page = 1; page <= MAX_PAGES; page++) {
    const sep = baseFeed.includes("?") ? "&" : "?";
    const url = page === 1 ? baseFeed : baseFeed + sep + "paged=" + page;
    let xml;
    try { xml = await fetchText(url); }
    catch (e) {
      if (page === 1) throw e;
      // After retries this page is a dead end. A 404 means we walked past the last
      // page; anything else is reported so a truncated list is never mistaken for
      // a complete one.
      if (!e.notFound) process.stdout.write(`  page ${page}: giving up (${e.message})\n`);
      break;
    }
    const items = parseItems(xml);
    if (!items.length) break;
    let added = 0;
    for (const ep of items) if (!all.has(ep.url)) { all.set(ep.url, ep); added++; }
    process.stdout.write(`  page ${page}: ${items.length} items (${added} new), total ${all.size}\n`);
    if (added === 0) break; // no new episodes -> we've looped past the end
    await sleep(PAGE_DELAY_MS); // be polite; the host 403s an unthrottled walk
  }
  return [...all.values()];
}

async function main() {
  let episodes = [];
  let used = "";
  for (const feed of FEED_CANDIDATES) {
    try {
      process.stdout.write(`Fetching feed: ${feed}\n`);
      const eps = await harvest(feed);
      if (eps.length) { episodes = eps; used = feed; break; }
      process.stdout.write(`  (no audio enclosures found)\n`);
    } catch (e) {
      process.stdout.write(`  failed: ${e.message}\n`);
    }
  }

  if (!episodes.length) {
    console.error("\nNo episodes found. Try a specific feed with --feed <url>, e.g.:\n" +
      "  node generate-episodes.mjs --feed https://sites.udmercy.edu/atp/feed/?paged=1\n");
    process.exit(1);
  }

  // Newest first is a nice default for the manifest; the player shuffles anyway.
  episodes.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));

  const fs = await import("node:fs/promises");
  await fs.writeFile(OUT, JSON.stringify(episodes, null, 2) + "\n");
  console.log(`\nWrote ${episodes.length} episodes to ${OUT} (from ${used}).`);
  console.log("Commit episodes.json, then open index.html to listen on shuffle.");
}

main().catch((e) => { console.error(e); process.exit(1); });
