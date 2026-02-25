# ReStream Nexus

> **Single-service RTMP re-streaming proxy** — One `npm run dev` boots everything.

---

## Architecture

```
OBS Studio
    │  RTMP (port 1935)
    ▼
Node-Media-Server ──► Stream Manager
                           │
                  ┌────────┴────────┐
                  ▼                 ▼
           Source FFmpeg       Master FFmpeg
         (OBS copy / MP4    (re-encodes UDP → 
          loop → UDP)        Twitch, YouTube, …)
                  └────────┬────────┘
                           ▼
                  Express + Next.js (port 3000)
                  WebSocket real-time state
```

### Seamless Source Switching
The Master FFmpeg reads from a UDP canvas (`udp://127.0.0.1:10000`). The Source FFmpeg feeds that canvas from either the live OBS RTMP stream or a looping MP4 fallback. Switching sources means only killing and restarting the Source process — the Master never drops, so Twitch/YouTube never see a disconnect.

---

## Project Structure

```
restream-service/
├── backend/
│   ├── lib/
│   │   ├── config.ts         # Central constants: STREAM_KEY, ports, URLs, paths
│   │   ├── db.ts             # SQLite data-access layer (targets + settings)
│   │   └── ip.ts             # Public IP fetcher
│   ├── stream/
│   │   ├── probe.ts          # ffprobe: detect resolution + fps
│   │   ├── source.ts         # Source FFmpeg (OBS or fallback → UDP canvas)
│   │   ├── master.ts         # Master FFmpeg (UDP canvas → encode → targets)
│   │   └── manager.ts        # Stateful coordinator: start/stop/switch/hot-swap
│   ├── rtmp/
│   │   └── media-server.ts   # Node-Media-Server RTMP ingest (port 1935)
│   ├── api/
│   │   ├── targets.ts        # Express router: CRUD stream targets
│   │   └── videos.ts         # Express router: video list, upload, set active, delete
│   └── ws/
│       └── handler.ts        # WebSocket server: auth, state push, broadcast control
├── src/app/                  # Next.js frontend
│   ├── page.tsx              # Main dashboard (React, WebSocket, i18n DE/EN)
│   ├── login/page.tsx        # Login page (stream-key auth → cookie)
│   ├── layout.tsx            # Root layout (Outfit font)
│   └── globals.css           # Full design system (glassmorphism, dark theme)
├── server.ts                 # ← Single entry point
├── tsconfig.json
└── package.json
```

---

## Requirements

- **Node.js** ≥ 18
- **FFmpeg** — bundled via `ffmpeg-static` (no system install needed)
- **OBS Studio** — configured to stream RTMP to this server

---

## Configuration

Create a `.env` file in the project root:

```env
STREAM_KEY=YourSecretPassword
```

The stream key serves as both the OBS RTMP stream key and the dashboard login password.

---

## Starting the Service

```bash
npm install
npm run dev
```

| Service | Address |
|---|---|
| Web Dashboard | `http://localhost:3000` |
| RTMP Ingest (OBS) | `rtmp://<server-ip>:1935/live/<STREAM_KEY>` |
| NMS Stats API | `http://localhost:8000/api/streams` |

---

## Dashboard Features

- **DE / EN language switcher** (persisted in localStorage)
- **Live OBS signal status** with public IP displayed for OBS configuration
- **Broadcast control** — Start, Stop, Reconnect buttons via WebSocket
- **Seamless fallback switching** — upload an MP4 and set it as the fallback loop
- **Target management** — add/remove/toggle Twitch, YouTube, Kick, or custom RTMP targets
- **Analytics** — OBS bitrate, resolution, fps, and per-target status

---

## Key Implementation Notes

- `strict: false` in tsconfig to accommodate untyped packages (`node-media-server`, `ffmpeg-static`)
- `node-media-server`, `ffmpeg-static`, `ffprobe-static` are all loaded via `require()` — they have no proper ESM exports
- The `ts-node` section in `tsconfig.json` forces CommonJS mode (`"module": "CommonJS"`) to prevent ESM resolution errors
- `dotenv` is loaded via `require('dotenv').config()` in `backend/lib/config.ts` (not via ESM `import 'dotenv/config'`)
- Video files are stored in `./videos/` at the project root; the active video is persisted in SQLite
