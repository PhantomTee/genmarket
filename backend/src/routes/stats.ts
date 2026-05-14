import { Router, Request, Response } from 'express';
import { getMarketplaceStats } from '../db/schema.js';

const router = Router();

// GET /api/stats — homepage live counters (cached implicitly by Next.js revalidate)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const stats = await getMarketplaceStats();
    // Allow Vercel/CDN to cache for 60 seconds
    res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.json(stats);
  } catch (err: any) {
    console.error('GET /api/stats error:', err.message);
    return res.json({ listings: 0, purchases: 0 });
  }
});

export default router;
