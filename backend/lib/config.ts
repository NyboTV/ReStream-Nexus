import path from 'path';

// Load .env at module initialization
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

// ─── Auth ────────────────────────────────────────────────────────────────────
export const STREAM_KEY: string =
    process.env.STREAM_KEY ?? 'SerienSkylan_StreamKey';

// ─── Ports ───────────────────────────────────────────────────────────────────
export const WEB_PORT = 3000;
export const RTMP_PORT = 1935;
export const NMS_HTTP_PORT = 8000; // Node-Media-Server stats API

// ─── Internal Stream URLs ─────────────────────────────────────────────────────
export const OBS_STREAM_URL = `rtmp://localhost:${RTMP_PORT}/live/${STREAM_KEY}`;
export const CANVAS_UDP_URL = 'udp://127.0.0.1:10000';

// ─── File Paths ───────────────────────────────────────────────────────────────
// __dirname = <root>/backend/lib  →  resolve two levels up to get project root
const ROOT = path.resolve(__dirname, '..', '..');
export const VIDEOS_DIR = path.join(ROOT, 'videos');
export const DB_PATH = path.join(ROOT, 'targets.db');
