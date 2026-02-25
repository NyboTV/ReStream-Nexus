import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getSetting, setSetting } from '../lib/db';
import { setActiveVideo } from '../stream/manager';
import { VIDEOS_DIR } from '../lib/config';

// Ensure the videos directory exists
if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, VIDEOS_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
    try {
        const files = fs.readdirSync(VIDEOS_DIR).filter((f) => f.endsWith('.mp4'));
        const activeVideo = await getSetting('active_video');
        res.json({ files, activeVideo });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/upload', upload.single('video'), (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'No video file provided' }) as any;
    res.json({ success: true, filename: req.file.filename });
});

router.post('/active', async (req: Request, res: Response) => {
    const { filename } = req.body as { filename: string };
    const filepath = path.join(VIDEOS_DIR, filename);
    if (!filename || !fs.existsSync(filepath)) {
        return res.status(400).json({ error: 'Invalid or missing file' }) as any;
    }
    setActiveVideo(filepath);
    await setSetting('active_video', filename);
    res.json({ success: true, activeVideo: filename });
});

router.delete('/:filename', (req: Request, res: Response) => {
    try {
        const filepath = path.join(VIDEOS_DIR, req.params['filename'] as string);
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
