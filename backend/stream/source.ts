import { spawn, ChildProcess } from 'child_process';
import { CANVAS_RTMP_URL } from '../lib/config';
import { ProbeResult } from './probe';

// ffmpeg-static exports a string path as default
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static') as string;

export type SourceType = 'obs' | 'fallback';

let sourceProcess: ChildProcess | null = null;

export function startSource(
    type: SourceType,
    fallbackVideoPath: string,
    streamKey: string,
    metadata?: ProbeResult | null
): void {
    killSource();

    const args: string[] = [];

    if (type === 'obs') {
        // Low-latency copy from local RTMP → UDP canvas
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
        // Fallback mode: Dynamic Transcoding to match OBS or simple copy
        args.push('-stream_loop', '-1', '-re', '-i', fallbackVideoPath);

        if (metadata) {
            console.log(`[Source] Fallback active: Mirroring OBS settings (${metadata.width}x${metadata.height} @ ${metadata.fps}fps)`);
            // Mirror OBS settings for a seamless transition
            args.push(
                '-vf', `scale=${metadata.width}:${metadata.height},fps=${metadata.fps}`,
                '-c:v', 'libx264',
                '-preset', 'veryfast',
                '-tune', 'zerolatency',
                '-b:v', (metadata as any).bitrate ? `${(metadata as any).bitrate}k` : '4000k',
                '-maxrate', (metadata as any).bitrate ? `${(metadata as any).bitrate}k` : '4000k',
                '-bufsize', (metadata as any).bitrate ? `${(metadata as any).bitrate * 2}k` : '8000k',
                '-pix_fmt', 'yuv420p',
                '-c:a', 'aac',
                '-ar', metadata.sampleRate.toString(),
                '-ac', metadata.channels.toString(),
                '-b:a', '128k'
            );
        } else {
            // No metadata (initial start) — use copy but ensure mapping
            args.push(
                '-map', '0:v:0',
                '-map', '0:a:0?',
                '-c:v', 'copy',
                '-c:a', 'copy'
            );
        }

        args.push('-f', 'flv', CANVAS_RTMP_URL);
    }

    console.log(`[Source] Spawning FFmpeg (${type}) → Canvas`);
    sourceProcess = spawn(ffmpegPath, args);
    sourceProcess.stderr?.on('data', (data) => console.log(`[Source FFmpeg] ${data.toString()}`));
    sourceProcess.on('error', (err) => console.error('[Source] FFmpeg error:', err));
}

export function killSource(): void {
    if (sourceProcess) {
        console.log('[Source] Stopping source process (Soft Stop)...');
        try { sourceProcess.kill('SIGTERM'); } catch { /* ignore */ }
        sourceProcess = null;
    }
}
