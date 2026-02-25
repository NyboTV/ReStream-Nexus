import { Router } from 'express';
import { getSetting, setSetting } from '../lib/db';

const router = Router();

router.get('/fallback', async (req, res) => {
    try {
        const resolution = await getSetting('fallback_resolution') || '1920x1080';
        const fps = await getSetting('fallback_fps') || '60';
        const bitrate = await getSetting('fallback_bitrate') || '6000';

        res.json({ resolution, fps: parseInt(fps), bitrate: parseInt(bitrate) });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

router.post('/fallback', async (req, res) => {
    try {
        const { resolution, fps, bitrate } = req.body;
        if (resolution) await setSetting('fallback_resolution', resolution);
        if (fps) await setSetting('fallback_fps', String(fps));
        if (bitrate) await setSetting('fallback_bitrate', String(bitrate));

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

export default router;
