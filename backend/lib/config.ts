import path from 'path';

// Load .env at module initialization
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

// ─── Ports ───────────────────────────────────────────────────────────────────
export const WEB_PORT = 3000;
export const RTMP_PORT = 1935;
export const NMS_HTTP_PORT = 8000; // Node-Media-Server stats API

// ─── Internal Stream URLs ─────────────────────────────────────────────────────
export const CANVAS_RTMP_URL = 'rtmp://127.0.0.1:1935/live/canvas';

// ─── File Paths ───────────────────────────────────────────────────────────────
// __dirname = <root>/backend/lib  →  resolve two levels up to get project root
const ROOT = path.resolve(__dirname, '..', '..');
export const VIDEOS_DIR = path.join(ROOT, 'videos');
export const DB_PATH = path.join(ROOT, 'targets.db');
