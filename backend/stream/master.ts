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
 * It creates a persistent black background and overlays any incoming canvas signal.
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
        // 0: Background Canvas (Black)
        '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${_masterFps}`,
        // 1: Background Audio (Silence)
        '-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=44100`,

        // 2: The actual source (Canvas.flv bridge via NMS)
        '-reconnect', '1',
        '-reconnect_at_eof', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '2',
        '-fflags', 'nobuffer+genpts',
        '-i', 'http://localhost:8000/live/canvas.flv',

        // ─── Filter Logic ───
        '-filter_complex',
        `[2:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2[vsource]; ` +
        `[0:v][vsource]overlay=eof_action=pass[outv]; ` +
        `[2:a]aresample=async=1[a_resampled]; ` +
        `[1:a][a_resampled]amix=inputs=2:duration=first:dropout_transition=0[outa]`,

        // ─── Encoding (Shared for all outputs) ───
        '-map', '[outv]',
        '-map', '[outa]',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-b:v', `${_masterBitrate}k`,
        '-maxrate', `${_masterBitrate}k`,
        '-bufsize', `${_masterBitrate}k`,
        '-g', (_masterFps * 2).toString(), // 2s GOP
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-ac', '2',

        // ─── Distribution (Tee Muxer) ───
        '-f', 'tee',
        '-use_fifo', '1', // Protects the main process from slow slaves
        teeDescriptor
    ];

    console.log(`[Master] Starting ALWAYS-ON MAIN Stream (${_masterResolution} @ ${_masterFps}fps, ${_masterBitrate}k)`);
    console.log(`[Master] Distribution: ${outputs.length} targets active.`);

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
