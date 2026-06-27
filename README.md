# Ask The Professor — Shuffle Player

A zero-install web player for the [Ask The Professor](https://sites.udmercy.edu/atp/)
radio archive (University of Detroit Mercy). It plays every archived episode in a
**random order, back to back** — you press play once and it keeps going on its own,
reshuffling forever when it reaches the end.

- 🔀 Fisher–Yates shuffle of the whole archive
- ▶️ Auto-advances to the next episode with no interaction
- ⏯️ Prev / Play-Pause / Next / Re-shuffle, seek bar, volume
- 💾 Remembers your shuffle order and position (resumes where you left off)
- 🔒 Lock-screen / hardware media-key controls (Media Session API)
- 🩹 Skips any episode that fails to load instead of stopping

## Quick start

1. **Get the episode list.** On a machine with internet access (Node 18+):

   ```bash
   node generate-episodes.mjs
   ```

   This reads the show's podcast feed, walks every page of the archive, and writes
   `episodes.json` (a list of episode audio URLs). Commit that file.

2. **Open the player.** Open `index.html` in a browser — locally, or host the folder
   anywhere static (e.g. GitHub Pages). Press **Start listening**. Done.

> Audio playback works cross-origin, so once `episodes.json` exists the player plays
> the archive from anywhere with no server.

## Why the generator script?

A browser page served from another origin usually **cannot fetch the podcast feed
directly** (the site doesn't send CORS headers), even though it *can* play the MP3s.
`generate-episodes.mjs` does the one-time list fetch outside the browser and bakes the
result into `episodes.json`, which the player loads same-origin. This is the reliable path.

The player also tries, in order:
1. `episodes.json` (recommended)
2. a previously cached list (localStorage)
3. fetching the feed live (direct, then via a public CORS proxy)
4. a manual paste box (paste feed XML or one audio URL per line)

So if your browser *can* reach the feed, it may work with no script at all — but
generating `episodes.json` is what guarantees the full archive loads everywhere.

## Updating with new episodes

Re-run `node generate-episodes.mjs` and commit the refreshed `episodes.json`.
The player also notices a larger manifest on load and picks up new episodes
automatically.

## `episodes.json` format

An array of episodes. Each item is either a plain audio URL string or an object:

```json
[
  { "title": "Episode 2146", "url": "https://.../episode-2146.mp3",
    "page": "https://sites.udmercy.edu/atp/2021/07/23/episode-2146/",
    "date": "Fri, 23 Jul 2021 00:00:00 +0000" }
]
```

Only `url` is required.

## Generator options

```bash
node generate-episodes.mjs --feed https://sites.udmercy.edu/atp/feed/ \
                           --max-pages 100 --out episodes.json
```

## Files

| File                    | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `index.html`            | The self-contained player (no dependencies).         |
| `generate-episodes.mjs` | Builds `episodes.json` from the podcast feed.        |
| `episodes.json`         | The episode list the player reads.                   |
