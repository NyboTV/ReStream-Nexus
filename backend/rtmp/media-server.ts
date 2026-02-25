import { RTMP_PORT, NMS_HTTP_PORT } from '../lib/config';

// node-media-server exports a constructor function (no TS types, use require)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const NodeMediaServer = require('node-media-server');

const config = {
    rtmp: {
        port: RTMP_PORT,
        chunk_size: 60000,
        gop_cache: true,
        ping: 2,
        ping_timeout: 4,
    },
    http: {
        port: NMS_HTTP_PORT,
        allow_origin: '*',
        api: true,
        api_addons: {},
    },
};

// Expose nms instance for direct stats access
let nmsInstance: any = null;
export function getNmsInstance(): any { return nmsInstance; }

// Self-maintained set of currently publishing stream paths (reliable vs NMS internals)
const activeStreams = new Set<string>();
export function getActiveStreams(): Set<string> { return activeStreams; }

type StreamCallback = (streamPath: string) => void;

export function startMediaServer(onPublish: StreamCallback, onDone: StreamCallback): void {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const nms = new NodeMediaServer(config);
    nmsInstance = nms;

    // NMS v4 passes the session object as first arg; streamPath may be 2nd arg or on the session
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    nms.on('prePublish', (id: any, streamPath: string) => {
        const sp: string = streamPath ?? id?.streamPath;
        console.log('[RTMP] Publishing:', sp);
        if (sp) { activeStreams.add(sp); onPublish(sp); }
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    nms.on('donePublish', (id: any, streamPath: string) => {
        const sp: string = streamPath ?? id?.streamPath;
        console.log('[RTMP] Done:', sp);
        if (sp) { activeStreams.delete(sp); onDone(sp); }
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    nms.run();
}
