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

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml, */*" } });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return res.text();
}

// Walk a WordPress feed across paged=1..N until a page yields no new items.
async function harvest(baseFeed) {
  const all = new Map(); // url -> episode
  for (let page = 1; page <= MAX_PAGES; page++) {
    const sep = baseFeed.includes("?") ? "&" : "?";
    const url = page === 1 ? baseFeed : baseFeed + sep + "paged=" + page;
    let xml;
    try { xml = await fetchText(url); }
    catch (e) { if (page === 1) throw e; break; } // 404 past last page ends the walk
    const items = parseItems(xml);
    if (!items.length) break;
    let added = 0;
    for (const ep of items) if (!all.has(ep.url)) { all.set(ep.url, ep); added++; }
    process.stdout.write(`  page ${page}: ${items.length} items (${added} new), total ${all.size}\n`);
    if (added === 0) break; // no new episodes -> we've looped past the end
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
