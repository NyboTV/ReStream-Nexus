import next from 'next';
import http from 'http';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

// Load config first — also pulls in dotenv
import { WEB_PORT, STREAM_KEY } from './backend/lib/config';
import { fetchPublicIp } from './backend/lib/ip';
import { startMediaServer } from './backend/rtmp/media-server';
import { handleObsConnect, handleObsDisconnect } from './backend/stream/manager';
import { attachWebSocketServer } from './backend/ws/handler';
import targetsRouter from './backend/api/targets';
import videosRouter from './backend/api/videos';

// ─── Next.js Setup ────────────────────────────────────────────────────────────
const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev });
const nextHandler = nextApp.getRequestHandler();

// ─── OBS State (passed by ref to WebSocket handler) ──────────────────────────
const obsState = { value: false };

// ─── Boot Sequence ────────────────────────────────────────────────────────────
nextApp.prepare().then(() => {
    const app = express();

    app.use(cors({ origin: true, credentials: true }));
    app.use(cookieParser());
    app.use(express.json());

    // API Authentication Middleware
    app.use('/api', (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const key = (req.headers['x-stream-key'] as string) || (req.cookies as Record<string, string>)?.streamKey;
        if (key === STREAM_KEY) return next();
        res.status(401).json({ error: 'Unauthorized' });
    });

    // API Routers
    app.use('/api/targets', targetsRouter);
    app.use('/api/videos', videosRouter);

    // All other requests → Next.js
    app.all('*', (req, res) => nextHandler(req, res));

    const httpServer = http.createServer(app);

    // WebSocket Server (auth + state push)
    attachWebSocketServer(httpServer, obsState);

    // RTMP Server — bridges OBS publish/done events to the stream manager
    startMediaServer(
        (streamPath) => {
            if (streamPath === `/live/${STREAM_KEY}`) {
                obsState.value = true;
                handleObsConnect();
            }
        },
        (streamPath) => {
            if (streamPath === `/live/${STREAM_KEY}`) {
                obsState.value = false;
                handleObsDisconnect();
            }
        }
    );

    // Start listening
    httpServer.listen(WEB_PORT, () => {
        fetchPublicIp();

        console.log('\n======================================================');
        console.log('                 ReStream Nexus Online                ');
        console.log('======================================================\n');
        console.log(`🌐 Web-Panel    : http://localhost:${WEB_PORT}`);
        console.log(`🔑 Stream-Key   : ${STREAM_KEY}`);
        console.log('\n------------------------------------------------------');
        console.log('💡 Change the Stream Key in the .env file:');
        console.log('   STREAM_KEY=YourNewPassword');
        console.log('======================================================\n');
    });
});
