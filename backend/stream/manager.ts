```javascript
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { getSetting, getStreamKeyDb, Target } from '../lib/db';
import { VIDEOS_DIR, CANVAS_RTMP_URL } from '../lib/config';
import { probeStream, ProbeResult } from './probe';
import { startSource, killSource, SourceType } from './source';
import { startMaster, stopMaster, masterEvents } from './master';

// ─── State ────────────────────────────────────────────────────────────────────
let broadcastActive = false;
let currentSource: SourceType = 'fallback';
let currentTargets: Target[] = [];
let activeVideo = path.join(VIDEOS_DIR, 'fallback.mp4');
let lastObsMetadata: ProbeResult | null = null;

export const events = new EventEmitter();

// Proxy master events to our public event bus
masterEvents.on('started', () => events.emit('started'));
masterEvents.on('stopped', () => events.emit('stopped'));

// ─── Boot: load persisted active video ───────────────────────────────────────
getSetting('active_video')
    .then((filename) => {
        if (filename) {
            const fp = path.join(VIDEOS_DIR, filename);
            if (fs.existsSync(fp)) {
                activeVideo = fp;
                console.log('[Manager] Loaded persisted fallback video:', filename);
            }
        }
    })
    .catch((err) => console.error('[Manager] Error loading active_video setting:', err));

async function captureObsMetadata(streamKey: string) {
    console.log('[Manager] Probing OBS stream for settings mirroring...');
    const obsUrl = `rtmp://localhost:1935/live/${streamKey}`;
const meta = await probeStream(obsUrl);
if (meta) {
    console.log('[Manager] Captured OBS metadata:', meta);
    lastObsMetadata = meta;
}
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function setActiveVideo(filepath: string): Promise<void> {
    if (fs.existsSync(filepath)) {
        activeVideo = filepath;
        console.log('[Manager] Active fallback video set to:', activeVideo);
        // Hot-swap the source if we're currently in fallback mode
        if (broadcastActive && currentSource === 'fallback') {
            const streamKey = await getStreamKeyDb() || 'preview';
            startSource('fallback', activeVideo, streamKey);
        }
    }
}

export async function startBroadcast(targets: Target[], isObsConnected: boolean): Promise<void> {
    if (broadcastActive) return;

    broadcastActive = true;
    currentTargets = targets ?? [];
    currentSource = isObsConnected ? 'obs' : 'fallback';

    const streamKey = await getStreamKeyDb() || 'preview';
    console.log('[Manager] Using streamKey:', streamKey);

    // Ensure we have a valid video if in fallback mode
    if (currentSource === 'fallback' && (!activeVideo || !fs.existsSync(activeVideo))) {
        const files = fs.readdirSync(VIDEOS_DIR).filter(f => f.endsWith('.mp4'));
        if (files.length > 0) {
            activeVideo = path.join(VIDEOS_DIR, files[0]);
            console.log('[Manager] Using backup fallback video:', files[0]);
        }
    }

    startMaster(currentTargets);
    startSource(currentSource, activeVideo, streamKey, lastObsMetadata);
}

export function stopBroadcast(): void {
    broadcastActive = false;
    killSource();
    killMaster();
}

export function updateTargets(targets: Target[]): void {
    if (!broadcastActive) return;

    if (JSON.stringify(currentTargets) !== JSON.stringify(targets)) {
        console.log('[Manager] Targets changed — hot-restarting master...');
        currentTargets = targets ?? [];
        stopBroadcast();
        setTimeout(() => startBroadcast(currentTargets, currentSource === 'obs'), 2000);
    }
}

export async function handleObsConnect(): Promise<void> {
    currentSource = 'obs';
    const streamKey = await getStreamKeyDb() || 'preview';

    // Capture metadata immediately regardless of broadcast state
    captureObsMetadata(streamKey);

    if (!broadcastActive) return;

    // Brief delay to let Node-Media-Server finish the RTMP handshake
    setTimeout(() => startSource('obs', activeVideo, streamKey), 1000);
}

export async function handleObsDisconnect(): Promise<void> {
    if (!broadcastActive || currentSource === 'fallback') return;
    console.log('[Manager] OBS disconnected — seamlessly switching to fallback...');
    currentSource = 'fallback';
    const streamKey = await getStreamKeyDb() || 'preview';

    // Load manual settings or use captured metadata
    const res = await getSetting('fallback_resolution') || (lastObsMetadata?.width + 'x' + lastObsMetadata?.height) || '1920x1080';
    const fps = await getSetting('fallback_fps') || String(lastObsMetadata?.fps || 60);
    const bitrate = await getSetting('fallback_bitrate') || '6000';

    const [w, h] = res.split('x').map(Number);
    const manualMeta: ProbeResult = {
        width: w || 1920,
        height: h || 1080,
        fps: parseInt(fps) || 60,
        bitrate: parseInt(bitrate) || 6000,
        sampleRate: lastObsMetadata?.sampleRate || 48000,
        channels: lastObsMetadata?.channels || 2
    };

    startSource('fallback', activeVideo, streamKey, manualMeta);
}

export function getState(): { broadcastActive: boolean; currentSource: SourceType } {
    return { broadcastActive, currentSource };
}
