import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { getSetting, getStreamKeyDb, Target } from '../lib/db';
import { VIDEOS_DIR } from '../lib/config';
import { probeStream, ProbeResult } from './probe';
import { startSource, killSource, SourceType, startBaseInputStream, killBaseInputStream } from './source';
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

async function getMasterSettings(): Promise<any> {
    const res = await getSetting('fallback_resolution') || '1920x1080';
    const fps = await getSetting('fallback_fps') || '60';
    const bitrate = await getSetting('fallback_bitrate') || '6000';

    return {
        resolution: res,
        fps: parseInt(fps),
        bitrate: parseInt(bitrate)
    };
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
    console.log('[Manager] Starting Master (always sends video to Twitch)');

    const mSettings = await getMasterSettings();
    const [width, height] = mSettings.resolution.split('x').map(Number);
    
    // Start base input stream (black frames to rtmp://localhost:1935/live/input)
    // This ensures Master always has input to read
    startBaseInputStream(width, height, mSettings.fps);
    
    // Start master stream
    startMaster(currentTargets, mSettings);
    
    // Start source immediately if OBS is connected
    if (isObsConnected) {
        setTimeout(() => startSource('obs', activeVideo, streamKey, mSettings), 500);
    }
}

export function stopBroadcast(): void {
    broadcastActive = false;
    killSource();
    killBaseInputStream();
    stopMaster();
}

export async function updateTargets(targets: Target[]): Promise<void> {
    if (!broadcastActive) return;

    if (JSON.stringify(currentTargets) !== JSON.stringify(targets)) {
        console.log('[Manager] Targets changed — updating master distribution...');
        currentTargets = targets ?? [];
        const mSettings = await getMasterSettings();
        // startMaster handles stopping the old one internally
        startMaster(currentTargets, mSettings);
    }
}

export async function handleObsConnect(): Promise<void> {
    currentSource = 'obs';
    const streamKey = await getStreamKeyDb() || 'preview';

    console.log('[Manager] 🔴 OBS CONNECTED → Switching to Live OBS Feed');
    // Metadata capture is less critical now as master handles output format
    captureObsMetadata(streamKey);

    if (!broadcastActive) return;

    // Brief delay to let Node-Media-Server finish the RTMP handshake
    const mSettings = await getMasterSettings();
    setTimeout(() => startSource('obs', activeVideo, streamKey, mSettings), 1000);
}

export async function handleObsDisconnect(): Promise<void> {
    if (!broadcastActive || currentSource === 'fallback') return;
    console.log('[Manager] ⚫ OBS DISCONNECTED → Switching to Base Input Stream');
    currentSource = 'fallback';
    
    // Kill any active source and restart base input stream
    killSource();
    const mSettings = await getMasterSettings();
    const [width, height] = mSettings.resolution.split('x').map(Number);
    startBaseInputStream(width, height, mSettings.fps);
}

export function getState(): { broadcastActive: boolean; currentSource: SourceType } {
    return { broadcastActive, currentSource };
}

// ─── Manual Fallback Control (for testing) ───────────────────────────────────
let manualFallbackActive = false;

export async function startManualFallback(): Promise<void> {
    if (!broadcastActive) {
        console.log('[Manager] Cannot start manual fallback - broadcast not active');
        return;
    }
    if (manualFallbackActive) {
        console.log('[Manager] Manual fallback already active');
        return;
    }

    manualFallbackActive = true;
    currentSource = 'fallback';
    const streamKey = await getStreamKeyDb() || 'preview';
    const mSettings = await getMasterSettings();
    
    console.log('[Manager] 🔧 MANUAL FALLBACK ENABLED (for testing)');
    startSource('fallback', activeVideo, streamKey, mSettings);
    events.emit('fallback-status', { manualFallbackActive });
}

export async function stopManualFallback(): Promise<void> {
    if (!manualFallbackActive) {
        console.log('[Manager] Manual fallback not active');
        return;
    }

    manualFallbackActive = false;
    killSource();
    
    // Restart base input stream (black frames)
    const mSettings = await getMasterSettings();
    const [width, height] = mSettings.resolution.split('x').map(Number);
    startBaseInputStream(width, height, mSettings.fps);
    
    console.log('[Manager] 🔧 MANUAL FALLBACK DISABLED (showing base input stream)');
    events.emit('fallback-status', { manualFallbackActive });
}

export function getManualFallbackStatus(): boolean {
    return manualFallbackActive;
}
