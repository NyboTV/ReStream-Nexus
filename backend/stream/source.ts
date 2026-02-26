import { spawn, ChildProcess } from 'child_process';

// ffmpeg-static exports a string path as default
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static') as string;

export type SourceType = 'obs' | 'fallback';

let sourceProcess: ChildProcess | null = null;
let oldSourceProcess: ChildProcess | null = null; // For graceful handoff (1000ms)
let baseInputProcess: ChildProcess | null = null; // Fallback black frames to input stream

/**
 * Start base input stream (black frames)
 * This ensures Master always has input to read from rtmp://localhost:1935/live/input
 * Gets replaced when real OBS/Fallback source starts
 */
export function startBaseInputStream(width: number, height: number, fps: number): void {
    if (baseInputProcess) return;

    console.log(`[Input] Starting base input stream (black @ ${width}x${height} ${fps}fps)`);

    const args = [
        '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}`,
        '-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=44100`,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-f', 'flv',
        'rtmp://localhost:1935/live/input'
    ];

    baseInputProcess = spawn(ffmpegPath, args);
    baseInputProcess.stderr?.on('data', (data) => {
        const msg = data.toString();
        if (msg.toLowerCase().includes('error')) {
            console.log(`[Input FFmpeg] ${msg.trim()}`);
        }
    });
    baseInputProcess.on('error', (err) => console.error('[Input] FFmpeg error:', err));
}

export function killBaseInputStream(): void {
    if (baseInputProcess) {
        console.log('[Input] Stopping base input stream...');
        try { baseInputProcess.kill('SIGTERM'); } catch { /* ignore */ }
        baseInputProcess = null;
    }
}

/**
 * Start OBS or Fallback source
 * Output MUST be 1920x1080 so Master can do direct copy
 */
export function startSource(
    type: SourceType,
    fallbackVideoPath: string,
    streamKey: string,
    settings?: { resolution: string; fps: number }
): void {
    // Keep old process alive while starting new one (graceful 1000ms handoff)
    if (sourceProcess) {
        oldSourceProcess = sourceProcess;
    }

    const args: string[] = [];
    const inputStream = 'rtmp://localhost:1935/live/input';
    const [width, height] = (settings?.resolution || '1920x1080').split('x').map(Number);
    const fps = settings?.fps || 60;

    if (type === 'obs') {
        // OBS source: Relay from OBS RTMP to input endpoint
        // Assume OBS is already outputting in correct format
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
            inputStream
        );
    } else {
        // Fallback source: Scale to 1920x1080 then stream to input
        args.push(
            '-stream_loop', '-1',
            '-re',
            '-fflags', 'nobuffer',
            '-i', fallbackVideoPath,
            '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
            '-map', '0:a:0?',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-crf', '28',
            '-c:a', 'aac',
            '-f', 'flv',
            inputStream
        );
    }

    console.log(`[Source] Starting ${type === 'obs' ? '🔴 OBS' : '⚫ FALLBACK'} → rtmp://localhost:1935/live/input`);
    sourceProcess = spawn(ffmpegPath, args);
    sourceProcess.stderr?.on('data', (data) => console.log(`[Source FFmpeg] ${data.toString()}`));
    sourceProcess.on('error', (err) => console.error('[Source] FFmpeg error:', err));

    // Kill base input stream after 500ms delay (gives source time to connect)
    setTimeout(() => {
        if (baseInputProcess) {
            console.log('[Source] Base input stopping (real source connected)...');
            killBaseInputStream();
        }
    }, 500);

    // Kill old process after 1000ms (give new one time to stabilize)
    if (oldSourceProcess) {
        setTimeout(() => {
            console.log('[Source] Killing old source process (graceful handoff complete)...');
            try { oldSourceProcess?.kill('SIGTERM'); } catch { /* ignore */ }
            oldSourceProcess = null;
        }, 1000);
    }
}

export function killSource(): void {
    if (sourceProcess) {
        console.log('[Source] Stopping source...');
        try { sourceProcess.kill('SIGTERM'); } catch { /* ignore */ }
        sourceProcess = null;
    }
    if (oldSourceProcess) {
        try { oldSourceProcess.kill('SIGTERM'); } catch { /* ignore */ }
        oldSourceProcess = null;
    }
}

