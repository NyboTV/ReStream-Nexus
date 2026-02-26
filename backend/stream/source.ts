import { spawn, ChildProcess } from 'child_process';

// ffmpeg-static exports a string path as default
// eslint-disable-next-line @typescript-eslint/no-var-requires
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static') as string;

export type SourceType = 'obs' | 'fallback';

let sourceProcess: ChildProcess | null = null;
let baseInputProcess: ChildProcess | null = null;

/**
 * Start OBS or Fallback source
 * Output is piped to stdout (pipe:1) which the Manager will feed into the Buffer and then Master.
 */
export function startSource(
    type: SourceType,
    fallbackVideoPath: string,
    streamKey: string,
    settings: { resolution: string; fps: number; bitrate: number }
): void {
    // Kill existing source immediately to avoid stream corruption in the relay
    if (sourceProcess) {
        killSource();
    }

    const args: string[] = [];
    const [width, height] = settings.resolution.split('x').map(Number);
    const fps = settings.fps;
    const bitrate = settings.bitrate;

    if (type === 'obs') {
        const obsUrl = `rtmp://localhost:1935/live/${streamKey}`;
        args.push(
            '-loglevel', 'warning',
            '-probesize', '100000000',
            '-analyzeduration', '100000000',
            '-fflags', 'nobuffer+genpts+igndts',
            '-flags', 'low_delay',
            '-i', obsUrl,
            '-map', '0:v:0',
            '-map', '0:a?',
            '-c', 'copy',
            '-f', 'flv',
            '-flvflags', 'no_duration_filesize',
            'pipe:1'
        );
    } else {
        args.push(
            '-loglevel', 'warning',
            '-fflags', 'nobuffer',
            '-flags', 'low_delay',
            '-stream_loop', '-1',
            '-re',
            '-i', fallbackVideoPath,
            '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
            '-map', '0:v:0',
            '-map', '0:a:0?',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-b:v', `${bitrate}k`,
            '-maxrate', `${bitrate}k`,
            '-bufsize', `${bitrate / 4}k`, // Smaller bufsize for lower latency
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-f', 'flv',
            '-flvflags', 'no_duration_filesize',
            'pipe:1'
        );
    }

    console.log(`[Source] Starting ${type === 'obs' ? '🔴 OBS' : '⚫ FALLBACK'} relay to stdout`);
    sourceProcess = spawn(ffmpegPath, args);

    sourceProcess.stderr?.on('data', (data) => {
        const msg = data.toString();
        if (msg.toLowerCase().includes('error')) {
            console.log(`[Source FFmpeg Error] ${msg.trim()}`);
        }
    });

    sourceProcess.on('error', (err) => console.error('[Source] FFmpeg error:', err));
}

export function getSourceStdout() {
    return sourceProcess?.stdout || null;
}

export function killSource(): void {
    if (sourceProcess) {
        console.log('[Source] Stopping source...');
        try { sourceProcess.kill('SIGKILL'); } catch { /* ignore */ }
        sourceProcess = null;
    }
}

export function startBaseInputStream(width: number, height: number, fps: number): void {
    if (baseInputProcess) return;
    const args = [
        '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}`,
        '-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=44100`,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-f', 'flv', 'rtmp://localhost:1935/live/input'
    ];
    baseInputProcess = spawn(ffmpegPath, args);
}

export function killBaseInputStream(): void {
    if (baseInputProcess) {
        try { baseInputProcess.kill('SIGKILL'); } catch { /* ignore */ }
        baseInputProcess = null;
    }
}

