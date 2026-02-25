import next from 'next';
import http from 'http';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

// Load config first — also pulls in dotenv
import { WEB_PORT, NMS_HTTP_PORT } from './backend/lib/config';
import { fetchPublicIp } from './backend/lib/ip';
import { startMediaServer, getNmsInstance, getActiveStreams } from './backend/rtmp/media-server';
import { handleObsConnect, handleObsDisconnect, getState, events as managerEvents } from './backend/stream/manager';
import { attachWebSocketServer } from './backend/ws/handler';
import { getStreamKeyDb } from './backend/lib/db';
import targetsRouter from './backend/api/targets';
import videosRouter from './backend/api/videos';
import setupRouter from './backend/api/setup';
import settingsRouter from './backend/api/settings';

// ─── Next.js Setup ────────────────────────────────────────────────────────────
const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev });
const nextHandler = nextApp.getRequestHandler();

// ─── OBS State (passed by ref to WebSocket handler) ──────────────────────────
const obsState = { value: false };
const nextReady = { value: false };

// ─── Boot Sequence ────────────────────────────────────────────────────────────
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json());

// Setup router (no auth required)
app.use('/api/setup', setupRouter);

// API Authentication Middleware (reads stream key dynamically from DB)
app.use('/api', async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = (req.headers['x-stream-key'] as string) || (req.cookies as Record<string, string>)?.streamKey;
    const storedKey = await getStreamKeyDb();
    if (storedKey && key === storedKey) return next();
    res.status(401).json({ error: 'Unauthorized' });
});

// API Routers
app.use('/api/targets', targetsRouter);
app.use('/api/videos', videosRouter);
app.use('/api/settings', settingsRouter);

// NMS Stats — reads from the self-maintained activeStreams Set (reliable in all NMS versions)
{
    const nmsRouter = express.Router();
    nmsRouter.get('/streams', (req: express.Request, res: express.Response) => {
        const streams = getActiveStreams();
        const live: Record<string, { publisher: any; subscribers: any[] }> = {};
        streams.forEach((sp) => {
            const key = sp.replace(/^\/live\//, '');
            live[key] = { publisher: { video: {}, audio: {} }, subscribers: [] };
        });
        res.json({ live });
    });
    app.use('/api/nms', nmsRouter);
}

// All other requests → Next.js (with warmup check)
app.use((req, res) => {
    if (!nextReady.value && !req.url.startsWith('/api/') && !req.url.startsWith('/_next/')) {
        return res.send(`
            <div style="font-family: sans-serif; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #0a0a0a; color: #fff;">
                <div style="width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.1); border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                <h2 style="margin-top: 20px;">ReStream Nexus is starting up...</h2>
                <p style="color: #666;">Services are online. UI is warming up.</p>
                <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
                <script>setTimeout(() => window.location.reload(), 2000);</script>
            </div>
        `);
    }
    return nextHandler(req, res);
});

const httpServer = http.createServer(app);

// WebSocket Server (auth + state push)
const wss = attachWebSocketServer(httpServer, obsState);

// Helper to broadcast state after OBS connect/disconnect or manager state change
function broadcastFullState(): void {
    const { getPublicIp } = require('./backend/lib/ip');
    const payload = JSON.stringify({
        type: 'STATE',
        payload: {
            obsConnected: obsState.value,
            publicIp: getPublicIp(),
            ...getState(),
        }
    });
    wss.clients.forEach((client: any) => {
        if (client.readyState === 1 /* OPEN */) client.send(payload);
    });
}

// Listen to manager events to sync UI
managerEvents.on('started', broadcastFullState);
managerEvents.on('stopped', broadcastFullState);

// RTMP Server — bridges OBS publish/done events to the stream manager
startMediaServer(
    async (streamPath) => {
        const key = await getStreamKeyDb();
        if (streamPath === `/live/${key}`) {
            obsState.value = true;
            await handleObsConnect();
            broadcastFullState();
        }
    },
    async (streamPath) => {
        const key = await getStreamKeyDb();
        if (streamPath === `/live/${key}`) {
            obsState.value = false;
            await handleObsDisconnect();
            broadcastFullState();
        }
    }
);

// Start listening immediately
httpServer.listen(WEB_PORT, () => {
    fetchPublicIp();

    console.log('\n======================================================');
    console.log('                 ReStream Nexus Online                ');
    console.log('======================================================\n');
    console.log(`🌐 Web-Panel    : http://localhost:${WEB_PORT}`);
    console.log('\n------------------------------------------------------');
    console.log('💡 Services (RTMP, API, WS) are now active.');
    console.log('⌛ Next.js Dashboard is warming up in the background...');
    console.log('======================================================\n');

    // Warm up Next.js in the background
    nextApp.prepare()
        .then(() => {
            nextReady.value = true;
            console.log('✅ Next.js Dashboard is ready.');
        })
        .catch((err) => {
            console.error('❌ Next.js failed to start:', err);
        });
});
