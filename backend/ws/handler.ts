import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import { getStreamKeyDb } from '../lib/db';
import { getEnabledTargets } from '../lib/db';
import { startBroadcast, stopBroadcast, getState } from '../stream/manager';
import { getPublicIp } from '../lib/ip';

function parseCookies(raw: string | undefined): Record<string, string> {
    if (!raw) return {};
    return Object.fromEntries(
        raw.split(';').map((c) => {
            const [k, ...v] = c.trim().split('=');
            return [k, v.join('=')];
        })
    );
}

function broadcastToAll(wss: WebSocketServer, payload: object): void {
    const msg = JSON.stringify(payload);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
}

export function attachWebSocketServer(httpServer: Server, obsConnectedRef: { value: boolean }): WebSocketServer {
    const wss = new WebSocketServer({ noServer: true });

    const broadcastState = () =>
        broadcastToAll(wss, {
            type: 'STATE',
            payload: {
                obsConnected: obsConnectedRef.value,
                publicIp: getPublicIp(),
                ...getState(),
            },
        });

    // Attach WebSocket upgrade to the HTTP server (intercepts /ws paths)
    httpServer.on('upgrade', async (req: IncomingMessage, socket: any, head: Buffer) => {
        // Skip Next.js HMR upgrade requests
        if (req.url?.startsWith('/_next/')) return;

        const url = new URL(req.url ?? '', `http://${req.headers.host}`);
        const cookies = parseCookies(req.headers.cookie);
        const streamKey = await getStreamKeyDb();

        console.log('[WS-Upgrade] Checking authentication...');
        console.log('[WS-Upgrade] Cookie Key:', cookies.streamKey);
        console.log('[WS-Upgrade] Query Key:', url.searchParams.get('key'));
        console.log('[WS-Upgrade] Stored Key:', streamKey);

        const authenticated =
            cookies.streamKey === streamKey ||
            url.searchParams.get('key') === streamKey;

        if (!authenticated) {
            console.warn('[WS-Upgrade] Authentication failed!');
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        console.log('[WS-Upgrade] Authentication successful.');
        wss.handleUpgrade(req, socket, head, (ws) => {
            // Note: we don't use req here anymore, connection event handles it
            wss.emit('connection', ws, req);
        });
    });

    // Cleanup interval for stale connections
    const interval = setInterval(() => {
        wss.clients.forEach((ws: any) => {
            if (ws.isAlive === false) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    wss.on('close', () => clearInterval(interval));

    // Handle incoming messages
    wss.on('connection', (ws: any) => {
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });

        // Send current state immediately on connect
        ws.send(
            JSON.stringify({
                type: 'STATE',
                payload: {
                    obsConnected: obsConnectedRef.value,
                    publicIp: getPublicIp(),
                    ...getState(),
                },
            })
        );

        ws.on('message', async (raw) => {
            try {
                const data = JSON.parse(raw.toString()) as { type: string };
                console.log('[WS] Received message:', data.type);

                if (data.type === 'START_BROADCAST') {
                    const targets = await getEnabledTargets();
                    await startBroadcast(targets, obsConnectedRef.value);
                    broadcastState();
                } else if (data.type === 'STOP_BROADCAST') {
                    stopBroadcast();
                    broadcastState();
                } else if (data.type === 'RECONNECT_BROADCAST') {
                    stopBroadcast();
                    broadcastState();
                    console.log('[WS] Reconnect requested — restarting in 5s...');
                    setTimeout(async () => {
                        const targets = await getEnabledTargets();
                        await startBroadcast(targets, obsConnectedRef.value);
                        broadcastState();
                    }, 5000);
                }
            } catch (err) {
                console.error('[WS] Error handling message:', err);
            }
        });
    });

    return wss;
}
