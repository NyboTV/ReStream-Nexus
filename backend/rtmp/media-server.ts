import { RTMP_PORT, NMS_HTTP_PORT } from '../lib/config';

// node-media-server exports a constructor function (no TS types, use require)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const NodeMediaServer = require('node-media-server');

const config = {
    bind: '0.0.0.0',
    rtmp: {
        host: '0.0.0.0',
        port: RTMP_PORT,
        chunk_size: 60000,
        gop_cache: true,
        ping: 2,
        ping_timeout: 4,
    },
    http: {
        host: '0.0.0.0',
        port: NMS_HTTP_PORT,
        allow_origin: '*',
        api: true,
    },
};

type StreamCallback = (streamPath: string) => void;

export function startMediaServer(onPublish: StreamCallback, onDone: StreamCallback): void {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const nms = new NodeMediaServer(config);

    // NMS v4 passes the session object as first arg; streamPath may be 2nd arg or on the session
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    nms.on('prePublish', (id: any, streamPath: string) => {
        const sp: string = streamPath ?? id?.streamPath;
        console.log('[RTMP] Publishing:', sp);
        if (sp) onPublish(sp);
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    nms.on('donePublish', (id: any, streamPath: string) => {
        const sp: string = streamPath ?? id?.streamPath;
        console.log('[RTMP] Done:', sp);
        if (sp) onDone(sp);
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    nms.run();
}
