import { Router, Request, Response } from 'express';
import { getTargets, addTarget, removeTarget, updateTargetStatus, getEnabledTargets } from '../lib/db';
import { updateTargets } from '../stream/manager';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
    try {
        res.json(await getTargets());
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', async (req: Request, res: Response) => {
    try {
        const { name, url, stream_key } = req.body as { name: string; url: string; stream_key: string };
        const target = await addTarget(name, url, stream_key);
        updateTargets(await getEnabledTargets());
        res.json(target);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id/toggle', async (req: Request, res: Response) => {
    try {
        await updateTargetStatus(Number(req.params.id), Boolean(req.body.enabled));
        updateTargets(await getEnabledTargets());
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', async (req: Request, res: Response) => {
    try {
        await removeTarget(Number(req.params.id));
        updateTargets(await getEnabledTargets());
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
