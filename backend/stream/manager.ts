import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { Transform, TransformCallback } from 'stream';
import { getSetting, getStreamKeyDb, Target, setSetting, getEnabledTargets } from '../lib/db';
import { VIDEOS_DIR } from '../lib/config';
import { startSource, killSource, SourceType, getSourceStdout } from './source';
import { startMaster, stopMaster, masterEvents, getMasterStdin } from './master';

// ─── Delay Buffer Stream ──────────────────────────────────────────────────────
class DelayStream extends Transform {
    private buffer: Buffer[] = [];
    private delayMs: number;
    private totalBufferedLength = 0;
    private timers: Set<NodeJS.Timeout> = new Set();

    constructor(delaySeconds: number) {
        super();
        this.delayMs = delaySeconds * 1000;
    }

    _transform(chunk: Buffer, encoding: string, callback: TransformCallback) {
        if (this.destroyed || this.writableEnded) return callback();

        this.buffer.push(chunk);
        this.totalBufferedLength += chunk.length;

        const timer = setTimeout(() => {
            this.timers.delete(timer);

            if (this.destroyed || this.writableEnded) {
                this.buffer = [];
                return;
            }

            const next = this.buffer.shift();
            if (next && !this.destroyed) {
                this.totalBufferedLength -= next.length;
                try {
                    // Final safety check before pushing
                    const isPipeValid = this.readableFlowing || this.readableLength > 0 || (this as any)._readableState?.pipesCount > 0;
                    if (isPipeValid && !this.writableEnded) {
                        this.push(next);
                    }
                } catch (e: any) {
                    if (e.code === 'EPIPE' || e.code === 'EOF' || e.code === 'ERR_STREAM_PUSH_AFTER_EOF') {
                        console.warn('[Manager] Relay pipeline broken. Stopping push.');
                        this.destroy();
                    }
                }
            }
        }, this.delayMs);

        this.timers.add(timer);
        callback();
    }

    _destroy(error: Error | null, callback: (error: Error | null) => void) {
        for (const timer of this.timers) {
            clearTimeout(timer);
        }
        this.timers.clear();
        this.buffer = [];
        callback(error);
    }
}

// ─── State ────────────────────────────────────────────────────────────────────
export const managerEvents = new EventEmitter();
let broadcastActive = false;
let currentSource: SourceType = 'fallback';
let activeVideo = '';
let delayStream: DelayStream | null = null;
let currentTargets: Target[] = [];
let manualFallbackActive = false; // New state for manual fallback

// Proxy master events
masterEvents.on('started', () => managerEvents.emit('started'));
masterEvents.on('stopped', () => managerEvents.emit('stopped'));

// Boot: load persisted active video
getSetting('active_video').then((filename) => {
    if (filename) {
        const fp = path.join(VIDEOS_DIR, filename);
        if (fs.existsSync(fp)) activeVideo = fp;
    } else {
        activeVideo = path.join(VIDEOS_DIR, 'fallback.mp4'); // Default fallback if no setting
    }
}).catch(err => console.error('[Manager] Error loading active_video:', err));

// Track the current source stdout to avoid double-piping
let activeSourceStdout: any = null;

function pipeSourceToBuffer() {
    const sourceStdout = getSourceStdout();
    const masterStdin = getMasterStdin();

    if (sourceStdout && delayStream && masterStdin) {
        // If we have a new stdout, unpipe the old one first
        if (activeSourceStdout && activeSourceStdout !== sourceStdout) {
            try {
                activeSourceStdout.unpipe(delayStream);
            } catch (e) {
                console.error('[Manager] Error unpiping old source:', e);
            }
        }

        activeSourceStdout = sourceStdout;
        console.log('[Manager] Wiring Source -> Buffer -> Master');

        // Note: We use { end: false } to keep the DelayStream and Master alive 
        // when a source process (like Fallback) is killed to switch to OBS.
        sourceStdout.pipe(delayStream, { end: false });

        // Ensure DelayStream is piped to Master (idempotent but safe)
        delayStream.unpipe(masterStdin);
        delayStream.pipe(masterStdin, { end: false });
    }
}

async function getMasterSettings() {
    return {
        resolution: (await getSetting('fallback_resolution')) || '1920x1080',
        fps: parseInt((await getSetting('fallback_fps')) || '60'),
        bitrate: parseInt((await getSetting('fallback_bitrate')) || '6000')
    };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function startBroadcast(targets: Target[], isObsConnected = false): Promise<void> {
    if (broadcastActive) return;
    console.log('[Manager] 🚀 Starting Buffered Broadcast...');

    broadcastActive = true;
    currentTargets = targets ?? [];
    currentSource = isObsConnected ? 'obs' : 'fallback';

    const bufferSec = parseFloat((await getSetting('buffer_duration')) || '1.5');
    delayStream = new DelayStream(bufferSec);

    const streamKey = await getStreamKeyDb() || 'preview';
    const mSettings = await getMasterSettings();

    // 1. Start Master (Relay/Tee)
    startMaster(currentTargets, mSettings);

    // 2. Start Source
    startSource(currentSource, activeVideo, streamKey, mSettings);

    // 3. Pipe
    pipeSourceToBuffer();

    managerEvents.emit('stateChange');
}

export function stopBroadcast(): void {
    if (!broadcastActive) return;
    console.log('[Manager] 🛑 Stopping Broadcast...');

    broadcastActive = false;
    killSource();
    stopMaster();

    if (delayStream) {
        delayStream.unpipe();
        delayStream = null;
    }
    manualFallbackActive = false; // Reset manual fallback state

    managerEvents.emit('stateChange');
}

export async function handleObsConnect(streamKey: string): Promise<void> {
    console.log('[Manager] 🔴 OBS CONNECTED');

    if (!broadcastActive) {
        console.log('[Manager] Auto-starting Broadcast because OBS connected');
        const targets = await getEnabledTargets();
        await startBroadcast(targets, true);
    } else {
        // Switch source to OBS immediately
        console.log('[Manager] Switching source to OBS (buffered)');
        currentSource = 'obs';
        manualFallbackActive = false; // Turn off manual fallback if OBS connects
        const mSettings = await getMasterSettings();
        startSource('obs', activeVideo, streamKey, mSettings);
        pipeSourceToBuffer();
    }
}

export async function handleObsDisconnect(): Promise<void> {
    console.log('[Manager] ⚫ OBS DISCONNECTED');

    const autoFallback = (await getSetting('auto_fallback')) === '1';
    if (!broadcastActive || !autoFallback) {
        currentSource = 'fallback'; // Just update state
        if (broadcastActive && !autoFallback) {
            console.log('[Manager] Auto-Fallback is disabled. Stream will remain black/frozen once buffer clears.');
            killSource();
        }
        return;
    }

    console.log('[Manager] Switching to Fallback (gap filled by buffer)');
    currentSource = 'fallback';
    manualFallbackActive = false; // Turn off manual fallback if OBS disconnects

    const streamKey = (await getStreamKeyDb()) || 'preview';
    const mSettings = await getMasterSettings();
    startSource('fallback', activeVideo, streamKey, mSettings);
    pipeSourceToBuffer();
}

export async function updateTargets(targets: Target[]): Promise<void> {
    if (!broadcastActive) return;
    if (JSON.stringify(currentTargets) !== JSON.stringify(targets)) {
        console.log('[Manager] Targets changed — restarting master...');
        currentTargets = targets ?? [];
        const mSettings = await getMasterSettings();
        startMaster(currentTargets, mSettings);
        pipeSourceToBuffer();
    }
}

export function getState() {
    return { broadcastActive, currentSource, manualFallbackActive };
}

export async function setBufferDuration(seconds: number) {
    await setSetting('buffer_duration', seconds.toString());
    console.log('[Manager] Buffer duration updated to:', seconds);
    if (broadcastActive) {
        console.log('[Manager] Restarting pipeline to apply new buffer duration...');
        const targets = currentTargets;
        const wasObs = currentSource === 'obs';
        stopBroadcast();
        setTimeout(() => startBroadcast(targets, wasObs), 1000);
    }
}

export async function setAutoFallback(enabled: boolean) {
    await setSetting('auto_fallback', enabled ? '1' : '0');
    console.log('[Manager] Auto-Fallback setting updated:', enabled);
}

export function setActiveVideo(filepath: string) {
    activeVideo = filepath;
}
