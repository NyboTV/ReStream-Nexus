import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { getSetting } from '../lib/db';
import { VIDEOS_DIR, OBS_STREAM_URL } from '../lib/config';
import { probeStream } from './probe';
import { startSource, killSource, SourceType } from './source';
import { startMaster, killMaster, masterEvents } from './master';
import { Target } from '../lib/db';

// ─── State ────────────────────────────────────────────────────────────────────
let broadcastActive = false;
let currentSource: SourceType = 'fallback';
let currentTargets: Target[] = [];
let masterResolution = '1920x1080';
let masterFps = 30;
let activeVideo = path.join(VIDEOS_DIR, 'fallback.mp4');

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

// ─── Public API ───────────────────────────────────────────────────────────────

export function setActiveVideo(filepath: string): void {
    if (fs.existsSync(filepath)) {
        activeVideo = filepath;
        console.log('[Manager] Active fallback video set to:', activeVideo);
        // Hot-swap the source if we're currently in fallback mode
        if (broadcastActive && currentSource === 'fallback') {
            startSource('fallback', activeVideo);
        }
    }
}

export async function startBroadcast(targets: Target[], isObsConnected: boolean): Promise<void> {
    if (broadcastActive) return;

    broadcastActive = true;
    currentTargets = targets ?? [];
    currentSource = isObsConnected ? 'obs' : 'fallback';

    console.log('[Manager] Probing source resolution...');
    const probeUrl = isObsConnected ? OBS_STREAM_URL : activeVideo;
    const probeResult = await probeStream(probeUrl);

    if (probeResult) {
        masterResolution = `${probeResult.width}x${probeResult.height}`;
        masterFps = probeResult.fps;
        console.log(`[Manager] Resolution: ${masterResolution} @ ${masterFps}fps`);
    } else {
        console.log(`[Manager] Probe failed — using defaults: ${masterResolution} @ ${masterFps}fps`);
    }

    startMaster(currentTargets, masterResolution, masterFps);
    startSource(currentSource, activeVideo);
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

export function handleObsConnect(): void {
    if (!broadcastActive || currentSource === 'obs') return;
    console.log('[Manager] OBS connected — seamlessly switching to OBS source...');
    currentSource = 'obs';
    // Brief delay to let Node-Media-Server finish the RTMP handshake
    setTimeout(() => startSource('obs', activeVideo), 500);
}

export function handleObsDisconnect(): void {
    if (!broadcastActive || currentSource === 'fallback') return;
    console.log('[Manager] OBS disconnected — seamlessly switching to fallback...');
    currentSource = 'fallback';
    startSource('fallback', activeVideo);
}

export function getState(): { broadcastActive: boolean; currentSource: SourceType } {
    return { broadcastActive, currentSource };
}
