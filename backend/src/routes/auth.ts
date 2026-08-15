import { Router, Request, Response } from 'express';
import { generateNonce, buildMessage } from '../services/auth.js';

const router = Router();

// GET /api/auth/nonce?address=0x...&action=confirm-purchase
router.get('/nonce', (req: Request, res: Response) => {
  const { address, action } = req.query;
  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'address is required' });
  }
  if (!action || typeof action !== 'string') {
    return res.status(400).json({ error: 'action is required' });
  }
  const nonce = generateNonce(address);
  const message = buildMessage(address, nonce, action);
  return res.json({ nonce, message });
});

export default router;
