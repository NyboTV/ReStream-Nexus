import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { CANVAS_UDP_URL } from '../lib/config';
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

export function startMaster(targets: Target[], resolution: string, fps: number): void {
    if (masterProcess) return;

    // Save for potential auto-restart
    _targets = targets;
    _resolution = resolution;
    _fps = fps;

    const args: string[] = [
        // Input: UDP canvas with generous FIFO to survive source switches
        '-f', 'mpegts',
        '-i', `${CANVAS_UDP_URL}?fifo_size=500000&overrun_nonfatal=1`,

        // Encode for perfectly uniform SPS/PPS headers (critical for 24/7 Twitch stability)
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-s', resolution,
        '-r', fps.toString(),
        '-b:v', '4000k',
        '-maxrate', '4000k',
        '-bufsize', '8000k',
        '-g', (fps * 2).toString(), // 2-second GOP
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',

        // Always push to the local preview stream first
        '-flvflags', 'no_duration_filesize',
        '-f', 'flv', 'rtmp://localhost:1935/live/preview',
    ];

    // Fan out to all enabled external targets
    for (const t of targets) {
        const slash = t.url.endsWith('/') ? '' : '/';
        const fullUrl = `${t.url}${slash}${t.stream_key}`;
        args.push('-c:v', 'copy', '-c:a', 'copy', '-f', 'flv', fullUrl);
    }

    console.log('[Master] Spawning FFmpeg...');
    masterProcess = spawn(ffmpegPath, args);
    _broadcastActive = true;

    masterEvents.emit('started');

    masterProcess.stderr?.on('data', () => { /* suppress verbose FFmpeg output */ });

    masterProcess.on('close', (code) => {
        console.log(`[Master] FFmpeg exited with code ${code}`);
        masterProcess = null;

        if (_broadcastActive) {
            console.log('[Master] Unexpected exit — restarting in 2s...');
            setTimeout(() => startMaster(_targets, _resolution, _fps), 2000);
        } else {
            masterEvents.emit('stopped');
        }
    });
}

export function killMaster(): void {
    _broadcastActive = false;
    if (masterProcess) {
        console.log('[Master] Killing master process...');
        try { masterProcess.stdin?.write('q\n'); } catch {
            try { masterProcess.kill('SIGINT'); } catch { /* ignore */ }
        }
        masterProcess = null;
    } else {
        masterEvents.emit('stopped');
    }
}
