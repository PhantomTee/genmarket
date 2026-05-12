import 'dotenv/config';
import express from 'express';

// Keep the process alive on unhandled rejections — log and continue
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
});
import cors from 'cors';
import { initDb } from './db/schema';
import listingsRouter from './routes/listings';
import judgeRouter from './routes/judge';
import paymentsRouter from './routes/payments';
import contractsRouter from './routes/contracts';
import { lintContract } from './services/lint';

const app = express();

app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://genmarketplace.vercel.app',
    /\.vercel\.app$/,
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api/listings', listingsRouter);
app.use('/api/judge', judgeRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/contracts', contractsRouter);

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
