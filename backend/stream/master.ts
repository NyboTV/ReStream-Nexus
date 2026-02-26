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
 * The Master process is the ALWAYS-ON "RELAY Buffer".
 * It reads from stdin (piped from Manager's Delay Buffer) and distributes to targets.
 */
export function startMaster(targets: Target[], settings: MasterSettings): void {
    if (masterProcess) stopMaster();

    _currentTargets = targets;
    _masterResolution = settings.resolution;
    _masterFps = settings.fps;
    _masterBitrate = settings.bitrate;

    const previewUrl = 'rtmp://localhost:1935/live/preview';
    const outputs = [previewUrl];

    for (const t of targets) {
        if (t.enabled) {
            const slash = t.url.endsWith('/') ? '' : '/';
            outputs.push(`${t.url}${slash}${t.stream_key}`);
        }
    }

    const teeDescriptor = outputs.map(url => `[f=flv]${url}`).join('|');

    const args: string[] = [
        '-loglevel', 'warning',
        '-probesize', '100000000',
        '-analyzeduration', '100000000',
        '-fflags', 'nobuffer+genpts+igndts',
        '-flags', 'low_delay',
        '-f', 'flv',
        '-i', 'pipe:0'
    ];

    for (const url of outputs) {
        args.push(
            '-map', '0:v:0',
            '-map', '0:a?',
            '-c', 'copy',
            '-f', 'flv',
            '-flvflags', 'no_duration_filesize',
            url
        );
    }

    console.log(`[Master] Starting RELAY Stream for ${_currentTargets.length} targets`);

    masterProcess = spawn(ffmpegPath, args);
    _broadcastActive = true;

    masterEvents.emit('started');

    masterProcess.stderr?.on('data', (data) => {
        const msg = data.toString();
        if (msg.toLowerCase().includes('error')) {
            console.log(`[Master FFmpeg Error] ${msg.trim()}`);
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

// Helper to get the stdin of the master process
export function getMasterStdin() {
    return masterProcess?.stdin || null;
}

export function stopMaster(): void {
    _broadcastActive = false;
    if (_restartTimer) {
        clearTimeout(_restartTimer);
        _restartTimer = null;
    }
    if (masterProcess) {
        console.log('[Master] Stopping RELAY Stream...');
        try { masterProcess.kill('SIGKILL'); } catch { /* ignore */ }
        masterProcess = null;
    }
    masterEvents.emit('stopped');
}
