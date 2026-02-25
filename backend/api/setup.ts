import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import {
    isSetupComplete, setPasswordHash, setStreamKeyDb,
    getStreamKeyDb, getPasswordHash, getSetupStep, setSetupStep
} from '../lib/db';

const router = Router();

// GET /api/setup/status — returns setupComplete flag + currentStep for resume logic
router.get('/status', async (_req: Request, res: Response) => {
    try {
        const complete = await isSetupComplete();
        const currentStep = complete ? 5 : await getSetupStep();
        res.json({ setupComplete: complete, currentStep });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/setup/password — hash & save password, advance to step 2
router.post('/password', async (req: Request, res: Response) => {
    try {
        const { password } = req.body as { password: string };
        if (!password || password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' }) as any;
        }
        const hash = await bcrypt.hash(password, 12);
        await setPasswordHash(hash);
        await setSetupStep(2);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/setup/stream-key — generate + save random stream key, stay on step 2 (OBS test pending)
router.post('/stream-key', async (_req: Request, res: Response) => {
    try {
        // Reuse existing key if already generated (idempotent)
        let key = await getStreamKeyDb();
        if (!key) {
            key = `nxs_${randomBytes(16).toString('hex')}`;
            await setStreamKeyDb(key);
        }
        res.json({ success: true, streamKey: key });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/setup/obs-verified — called when OBS connection test passes, advance to step 3
router.post('/obs-verified', async (_req: Request, res: Response) => {
    try {
        await setSetupStep(3);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/setup/stream-key — read current stream key (for display/resume)
router.get('/stream-key', async (_req: Request, res: Response) => {
    try {
        const key = await getStreamKeyDb();
        res.json({ streamKey: key });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/setup/verify-password — verify a password against the stored hash
router.post('/verify-password', async (req: Request, res: Response) => {
    try {
        const { password } = req.body as { password: string };
        const hash = await getPasswordHash();
        if (!hash) return res.status(400).json({ error: 'No password set' }) as any;
        const valid = await bcrypt.compare(password, hash);
        if (!valid) return res.status(401).json({ error: 'Invalid password' }) as any;
        const streamKey = await getStreamKeyDb();
        res.json({ success: true, streamKey });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/setup/complete — finalize setup
router.post('/complete', async (_req: Request, res: Response) => {
    try {
        const complete = await isSetupComplete();
        if (!complete) {
            return res.status(400).json({ error: 'Setup not complete (missing password or stream key)' }) as any;
        }
        await setSetupStep(5);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
