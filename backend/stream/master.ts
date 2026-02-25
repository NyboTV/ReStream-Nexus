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
// Keep a local reference to targets for restarts
let _targets: Target[] = [];
let _resolution = '1920x1080';
let _fps = 30;

export function startMaster(targets: Target[]): void {
    if (masterProcess) return;

    // Save for potential auto-restart
    _targets = targets;

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
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c:v', 'copy',
        '-c:a', 'copy',

        // Always push to the local preview stream first
        '-flvflags', 'no_duration_filesize',
        '-f', 'flv', 'rtmp://localhost:1935/live/preview',
    ];

    // Fan out to all enabled external targets
    for (const t of targets) {
        const slash = t.url.endsWith('/') ? '' : '/';
        const fullUrl = `${t.url}${slash}${t.stream_key}`;
        args.push(
            '-reconnect', '1',
            '-reconnect_at_eof', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '2000',
            '-flags', '+global_header',
            '-map', '0:v:0',
            '-map', '0:a:0?',
            '-c:v', 'copy',
            '-c:a', 'copy',
            '-f', 'flv',
            fullUrl
        );
    }

    console.log('[Master] Spawning FFmpeg...');
    masterProcess = spawn(ffmpegPath, args);
    _broadcastActive = true;

    masterEvents.emit('started');

    masterProcess.stderr?.on('data', (data) => {
        // Log interesting stuff or errors, suppress most verbose output if needed
        const msg = data.toString();
        if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('audio')) {
            console.log(`[Master FFmpeg] ${msg.trim()}`);
        }
    });

    masterProcess.on('close', (code) => {
        console.log(`[Master] FFmpeg exited with code ${code}`);
        masterProcess = null;

        if (_broadcastActive) {
            console.log('[Master] Unexpected exit — restarting in 2s...');
            setTimeout(() => startMaster(_targets), 2000);
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
