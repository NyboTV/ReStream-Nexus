import { spawn, ChildProcess } from 'child_process';
import { OBS_STREAM_URL, CANVAS_UDP_URL } from '../lib/config';

// ffmpeg-static exports a string path as default
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static') as string;

export type SourceType = 'obs' | 'fallback';

let sourceProcess: ChildProcess | null = null;

export function startSource(type: SourceType, fallbackVideoPath: string): void {
    killSource();

    const args: string[] = [];

    if (type === 'obs') {
        // Low-latency copy from local RTMP → UDP canvas
        args.push(
            '-fflags', 'nobuffer',
            '-flags', 'low_delay',
            '-i', OBS_STREAM_URL,
            '-c:v', 'copy',
            '-c:a', 'copy',
            '-f', 'mpegts',
            CANVAS_UDP_URL
        );
    } else {
        // Infinite loop of the fallback MP4 → UDP canvas
        args.push(
            '-stream_loop', '-1',
            '-re',
            '-i', fallbackVideoPath,
            '-c:v', 'copy',
            '-c:a', 'copy',
            '-f', 'mpegts',
            CANVAS_UDP_URL
        );
    }

    console.log(`[Source] Spawning FFmpeg (${type}) → Canvas`);
    sourceProcess = spawn(ffmpegPath, args);
    sourceProcess.on('error', (err) => console.error('[Source] FFmpeg error:', err));
}

export function killSource(): void {
    if (sourceProcess) {
        console.log('[Source] Killing source process...');
        try { sourceProcess.kill('SIGKILL'); } catch { /* ignore */ }
        sourceProcess = null;
    }
}
