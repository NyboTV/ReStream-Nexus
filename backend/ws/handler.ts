import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import { STREAM_KEY } from '../lib/config';
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
    httpServer.on('upgrade', (req: IncomingMessage, socket: any, head: Buffer) => {
        // Skip Next.js HMR upgrade requests
        if (req.url?.startsWith('/_next/')) return;

        const url = new URL(req.url ?? '', `http://${req.headers.host}`);
        const cookies = parseCookies(req.headers.cookie);
        const authenticated =
            cookies.streamKey === STREAM_KEY ||
            url.searchParams.get('key') === STREAM_KEY;

        if (!authenticated) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });

    // Handle incoming messages
    wss.on('connection', (ws: WebSocket) => {
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
