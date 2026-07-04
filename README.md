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

## Run it on a NAS / server with Docker (recommended for always-on)

A NAS is the best home for this: it's always on, it can reach the ATP feed
itself (so it builds the full episode list with no other computer involved),
and you can open the player from any device on your network.

The container serves the player **and** refreshes `episodes.json` — on startup
and on a schedule — so it stays current on its own.

### QNAP (Container Station)

The included `docker-compose.yml` needs **no image build**: it runs the stock
public `node:20-alpine` image and bind-mounts this repo into it. That's what lets
it work when you paste it into Container Station — the paste box has no Dockerfile,
so anything that tried to *build* or pull a custom image would fail with
`failed to read dockerfile` / `pull access denied`.

1. **Put this repo on the NAS at `/share/Container/atp-shuffle`** — via File
   Station, or `git clone` over SSH. This step is required: the container mounts
   that folder to get `index.html`, `server.mjs`, etc. (If your Container share
   is elsewhere, edit the host path under `volumes:` in the compose file.)
2. **Container Station → Applications → Create**, give it a name, and paste the
   contents of `docker-compose.yml`. No build context needed.
3. Start it. Open **`http://<your-nas-ip>:1234`** on any device and press
   **Start listening**. (The compose file maps host port `1234` to the
   container's internal port `8080` — edit the left side of `ports:` in
   `docker-compose.yml` to use a different host port.)

Prefer the command line? SSH into the NAS, `cd` into that folder, and run:

```bash
docker compose up -d              # older systems: docker-compose up -d
```

<details>
<summary>Alternative: build a self-contained image (SSH/CLI only)</summary>

The repo also includes a `Dockerfile` if you'd rather bake the files into an
image instead of bind-mounting. This can't be done from the Container Station
paste box (it has no source files) — use SSH from the repo folder:

```bash
docker build -t atp-shuffle .
docker run -d --name atp-shuffle --restart unless-stopped -p 1234:8080 atp-shuffle
```
</details>

### Settings (environment variables)

| Variable               | Default | Meaning                                             |
| ---------------------- | ------- | --------------------------------------------------- |
| `PORT`                 | `8080`  | Port the player is served on                        |
| `REGEN_ON_START`       | `true`  | Rebuild the episode list when the container starts  |
| `REGEN_INTERVAL_HOURS` | `168`   | Rebuild again every N hours (7 days); `0` disables  |

The list only gets overwritten on a **successful** fetch, so a temporary
network blip never wipes your working list. You can also trigger a refresh
on demand: `curl -X POST http://<your-nas-ip>:1234/refresh`.

## Updating with new episodes

**In Docker:** nothing to do — the container refreshes on its schedule (or hit
`/refresh`). **Standalone:** re-run `node generate-episodes.mjs` and commit the
refreshed `episodes.json`. Either way, the player picks up a larger list on its
next load automatically.

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
| `server.mjs`            | Tiny static server + scheduled list refresh.         |
| `Dockerfile`            | Container image (Node 20 Alpine, no deps).           |
| `docker-compose.yml`    | One-command deploy for QNAP / Docker.                |
