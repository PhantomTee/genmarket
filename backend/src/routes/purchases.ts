import { Router, Request, Response } from 'express';
import { getRecentPurchases } from '../db/schema.js';

const router = Router();

// GET /api/purchases/recent — last 15 confirmed purchases (status = 'released')
router.get('/recent', async (_req: Request, res: Response) => {
  try {
    const rows = await getRecentPurchases(15);
    return res.json(rows);
  } catch (err: any) {
    console.error('GET /api/purchases/recent error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
