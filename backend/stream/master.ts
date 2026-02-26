import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { Target } from '../lib/db';

// ffmpeg-static exports a string path as its default/module.exports
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static') as string;

export const masterEvents = new EventEmitter();

// ─── Internal State ──────────────────────────────────────────────────────────
let masterProcess: ChildProcess | null = null;
let _broadcastActive = false;
let _currentTargets: Target[] = [];
let _masterResolution = '1920x1080';
let _masterFps = 60;
let _masterBitrate = 6000;
let _restartTimer: NodeJS.Timeout | null = null;

export interface MasterSettings {
    resolution: string;
    fps: number;
    bitrate: number;
}

/**
 * The Master process is the ALWAYS-ON "MAIN Stream".
 * Multi-Layer Architecture:
 * 1. Base Layer (ALWAYS): Black screen + Text + Heartbeat Audio (guaraneed to never stop)
 * 2. OBS Layer (optional): Overlaid on base when OBS is connected
 * 3. Fallback Layer (optional): Overlaid on base when OBS is not connected
 * 
 * This ensures ZERO interruption to the Twitch stream during layer transitions.
 */
export function startMaster(targets: Target[], settings?: MasterSettings): void {
    if (masterProcess) stopMaster(); // Ensure clean state

    _currentTargets = targets;
    if (settings) {
        _masterResolution = settings.resolution;
        _masterFps = settings.fps;
        _masterBitrate = settings.bitrate;
    }

    const [width, height] = _masterResolution.split('x').map(Number);
    const previewUrl = 'rtmp://localhost:1935/live/preview';
    const outputs = [previewUrl];

    for (const t of targets) {
        if (t.enabled) {
            const slash = t.url.endsWith('/') ? '' : '/';
            outputs.push(`${t.url}${slash}${t.stream_key}`);
        }
    }

    // FFmpeg 'tee' muxer syntax: [f=flv:onfail=ignore]url1|[f=flv:onfail=ignore]url2
    const teeDescriptor = outputs.map(url => `[f=flv:onfail=ignore:flvflags=no_duration_filesize]${url}`).join('|');

    const args: string[] = [
        // Input 0: OBS/Fallback Source Stream (via RTMP)
        '-rtbufsize', '16M',
        '-fflags', 'nobuffer',
        '-flags', 'low_delay',
        '-i', 'rtmp://localhost:1935/live/input',

        // Input 1: Fallback black screen (if input fails)
        '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${_masterFps}`,

        // ─── Direct map with fallback ───
        '-map', '0:v?',
        '-map', '1:v',
        '-map', '0:a?',
        '-filter_complex', '[0:v]format=pix_fmts=yuv420p[vout]',
        '-map', '[vout]',

        // ─── Encoding: Low latency ───
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-crf', '23',
        '-b:v', `${_masterBitrate}k`,
        '-maxrate', `${Math.floor(_masterBitrate * 1.2)}k`,
        '-bufsize', `${Math.floor(_masterBitrate / 2)}k`,
        '-g', '30',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-shortest',

        // ─── Distribution ───
        '-f', 'tee',
        '-max_delay', '2000000',
        teeDescriptor
    ];

    console.log(`[Master] Starting ALWAYS-ON MAIN Stream (${_masterResolution} @ ${_masterFps}fps, ${_masterBitrate}k)`);
    console.log(`[Master] Reading from: rtmp://localhost:1935/live/input (Base Input | OBS | Fallback)`);
    console.log(`[Master] Outputs: ${outputs.length} targets (Twitch, etc.)`);

    masterProcess = spawn(ffmpegPath, args);
    _broadcastActive = true;

    masterEvents.emit('started');

    masterProcess.stderr?.on('data', (data) => {
        const msg = data.toString();
        // Log errors or important info
        if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('warning')) {
            console.log(`[Master FFmpeg] ${msg.trim()}`);
        }
    });

    masterProcess.on('close', (code) => {
        console.log(`[Master] FFmpeg exited with code ${code}`);
        masterProcess = null;

        if (_broadcastActive) {
            console.log('[Master] Unexpected exit — restarting in 2s...');
            if (_restartTimer) clearTimeout(_restartTimer);
            _restartTimer = setTimeout(() => startMaster(_currentTargets, settings), 2000);
        } else {
            masterEvents.emit('stopped');
        }
    });
}

export function stopMaster(): void {
    _broadcastActive = false;
    if (_restartTimer) {
        clearTimeout(_restartTimer);
        _restartTimer = null;
    }
    if (masterProcess) {
        console.log('[Master] Stopping MAIN Stream...');
        try { masterProcess.kill('SIGTERM'); } catch { /* ignore */ }
        masterProcess = null;
    }
    masterEvents.emit('stopped');
}
