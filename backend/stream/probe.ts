import { spawn, ChildProcess } from 'child_process';
import path from 'path';

// ffprobe-static exports { path: string } as default
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffprobeStaticPkg = require('ffprobe-static') as { path: string };
const ffprobePath: string = ffprobeStaticPkg.path;

export interface ProbeResult {
    width: number;
    height: number;
    fps: number;
    sampleRate: number;
    channels: number;
}

/**
 * Uses ffprobe to inspect a stream or file and extract video resolution + framerate.
 * Returns null on failure.
 */
export function probeStream(url: string): Promise<ProbeResult | null> {
    return new Promise((resolve) => {
        const proc: ChildProcess = spawn(ffprobePath, [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height,r_frame_rate',
            '-select_streams', 'a:0',
            '-show_entries', 'stream=sample_rate,channels',
            '-of', 'json',
            url,
        ]);

        let output = '';
        proc.stdout?.on('data', (d: Buffer) => (output += d.toString()));

        proc.on('close', (code) => {
            if (code !== 0) return resolve(null);
            try {
                const data = JSON.parse(output) as {
                    streams?: Array<{
                        width?: number;
                        height?: number;
                        r_frame_rate?: string;
                        sample_rate?: string;
                        channels?: number;
                    }>;
                };

                const videoStream = data.streams?.find(s => s.width !== undefined);
                const audioStream = data.streams?.find(s => s.sample_rate !== undefined);

                if (!videoStream) return resolve(null);

                let fps = 30;
                if (videoStream.r_frame_rate) {
                    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
                    if (den > 0) fps = Math.round(num / den);
                }

                resolve({
                    width: videoStream.width || 1920,
                    height: videoStream.height || 1080,
                    fps,
                    sampleRate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate) : 48000,
                    channels: audioStream?.channels || 2,
                });
            } catch {
                resolve(null);
            }
        });
    });
}
