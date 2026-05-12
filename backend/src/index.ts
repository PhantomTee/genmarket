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

const allowedOrigins = [
  'http://localhost:3000',
  'https://genmarketplace.vercel.app',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({ success: true, service: 'genmarket-backend', status: 'ok' });
});

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

// JSON 404 fallback — ensures backend never returns plain-text errors
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({ success: false, error: 'Route not found', method: req.method, path: req.path });
});

app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
);

const PORT = parseInt(process.env.PORT ?? '4000', 10);

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`GenMarket backend running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialise database:', err.message);
    process.exit(1);
  });
