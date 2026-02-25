import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { CANVAS_RTMP_URL } from '../lib/config';
import { Target } from '../lib/db';

// ffmpeg-static exports a string path as its default/module.exports
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static') as string;

export const masterEvents = new EventEmitter();

let masterProcess: ChildProcess | null = null;
let _broadcastActive = false;
export interface MasterSettings {
    resolution: string;
    fps: number;
    bitrate: number;
}

export function startMaster(targets: Target[], settings?: MasterSettings): void {
    if (masterProcess) return;

    // Save for potential auto-restart
    _targets = targets;
    if (settings) {
        _resolution = settings.resolution;
        _fps = settings.fps;
    }

    const [width, height] = _resolution.split('x').map(Number);
    const bitrate = settings?.bitrate || 6000;

    const args: string[] = [
        // Input: HTTP-FLV canvas (more resilient than RTMP for source swaps)
        '-reconnect', '1',
        '-reconnect_at_eof', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '2',
        '-fflags', 'nobuffer',
        '-flags', 'low_delay',
        '-f', 'flv',
        '-i', 'http://localhost:8000/live/canvas.flv',

        // Global Encoding Settings (Transcoding to MAIN Stream)
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-vf', `scale=${width}:${height},fps=${_fps}`,
        '-b:v', `${bitrate}k`,
        '-maxrate', `${bitrate}k`,
        '-bufsize', `${bitrate}k`,
        '-g', (_fps * 2).toString(), // 2s GOP
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-ac', '2',

        // Output to local preview
        '-flvflags', 'no_duration_filesize',
        '-f', 'flv', 'rtmp://localhost:1935/live/preview',
    ];

    // Fan out to all enabled external targets (using the already encoded stream)
    for (const t of targets) {
        const slash = t.url.endsWith('/') ? '' : '/';
        const fullUrl = `${t.url}${slash}${t.stream_key}`;
        args.push(
            // We use copy here because we already encoded it once above for the whole 'session'
            '-map', '0:v:0',
            '-map', '0:a:0?',
            '-c:v', 'copy',
            '-c:a', 'copy',
            '-f', 'flv',
            fullUrl
        );
    }

    console.log('[Master] Spawning FFmpeg (Transcoding Mode)...');
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
            setTimeout(() => startMaster(_targets, settings), 2000);
        } else {
            masterEvents.emit('stopped');
        }
    });
}

export function killMaster(): void {
    if (masterProcess) {
        console.log('[Master] Stopping master process (Soft Stop)...');
        _broadcastActive = false;
        try { masterProcess.kill('SIGTERM'); } catch { /* ignore */ }
        masterProcess = null;
    } else {
        masterEvents.emit('stopped');
    }
}
