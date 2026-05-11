import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initDb } from './db/schema';
import listingsRouter from './routes/listings';
import judgeRouter from './routes/judge';
import paymentsRouter from './routes/payments';
import { lintContract } from './services/lint';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api/listings', listingsRouter);
app.use('/api/judge', judgeRouter);
app.use('/api/payments', paymentsRouter);

// POST /api/lint — inline, no separate router needed
app.post('/api/lint', (req, res) => {
  const { code } = req.body;
  if (typeof code !== 'string') {
    return res.status(400).json({ error: 'code must be a string' });
  }
  return res.json(lintContract(code));
});

app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
);

const PORT = parseInt(process.env.PORT ?? '4000', 10);

initDb();
app.listen(PORT, () => {
  console.log(`GenMarket backend running on port ${PORT}`);
});
