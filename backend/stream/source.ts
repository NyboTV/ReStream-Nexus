import { spawn, ChildProcess } from 'child_process';
import { CANVAS_RTMP_URL } from '../lib/config';
import { ProbeResult } from './probe';

// ffmpeg-static exports a string path as default
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static') as string;

export type SourceType = 'obs' | 'fallback';

let sourceProcess: ChildProcess | null = null;
let oldSourceProcess: ChildProcess | null = null; // For graceful handoff

export function startSource(
    type: SourceType,
    fallbackVideoPath: string,
    streamKey: string,
    settings?: { resolution: string; fps: number }
): void {
    // Keep old process alive while starting new one (graceful handoff)
    if (sourceProcess) {
        oldSourceProcess = sourceProcess;
    }

    const args: string[] = [];

    if (type === 'obs') {
        // Low-latency copy from local RTMP → UDP canvas
        // We use -fflags nobuffer and -tune zerolatency even here to keep internal hops fast
        const obsUrl = `rtmp://localhost:1935/live/${streamKey}`;
        args.push(
            '-fflags', 'nobuffer',
            '-flags', 'low_delay',
            '-i', obsUrl,
            '-map', '0:v:0',
            '-map', '0:a:0?',
            '-c:v', 'copy',
            '-c:a', 'copy',
            '-f', 'flv',
            CANVAS_RTMP_URL
        );
    } else {
        // Fallback mode: Simplified high-quality mezzanine output
        // The 'master' process now handles the final scaling/bitrate
        args.push(
            '-stream_loop', '-1',
            '-re',
            '-fflags', 'nobuffer',
            '-i', fallbackVideoPath,
            '-map', '0:v:0',
            '-map', '0:a:0?',
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-tune', 'zerolatency',
            '-crf', '18', // High quality, low overhead
            '-crf', '18',
            '-g', (settings?.fps ? settings.fps * 2 : 60).toString(),
            '-c:a', 'aac',
            '-f', 'flv',
            CANVAS_RTMP_URL
        );
    }

    console.log(`[Source] Starting ${type === 'obs' ? '🔴 OBS' : '⚫ FALLBACK'} source → Canvas`);
    sourceProcess = spawn(ffmpegPath, args);
    sourceProcess.stderr?.on('data', (data) => console.log(`[Source FFmpeg] ${data.toString()}`));
    sourceProcess.on('error', (err) => console.error('[Source] FFmpeg error:', err));

    // Kill old process after 1000ms (give new one time to fully connect and stabilize)
    if (oldSourceProcess) {
        setTimeout(() => {
            console.log('[Source] Cleaning up old source process...');
            try { oldSourceProcess?.kill('SIGTERM'); } catch { /* ignore */ }
            oldSourceProcess = null;
        }, 1000);
    }
}

export function killSource(): void {
    if (sourceProcess) {
        console.log('[Source] Stopping source process (Soft Stop)...');
        try { sourceProcess.kill('SIGTERM'); } catch { /* ignore */ }
        sourceProcess = null;
    }
    if (oldSourceProcess) {
        try { oldSourceProcess.kill('SIGTERM'); } catch { /* ignore */ }
        oldSourceProcess = null;
    }
}
