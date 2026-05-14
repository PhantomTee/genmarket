import { Router, Request, Response } from 'express';
import { getRecentPurchases, getPurchasesByBuyer } from '../db/schema.js';

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

// GET /api/purchases/buyer/:address — purchase history for a specific buyer
// Used by the dashboard "buying" tab so history persists across devices/sessions.
router.get('/buyer/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    if (!address || typeof address !== 'string' || !address.trim()) {
      return res.status(400).json({ error: 'address is required' });
    }
    const rows = await getPurchasesByBuyer(address.trim());
    return res.json(rows);
  } catch (err: any) {
    console.error('GET /api/purchases/buyer/:address error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
