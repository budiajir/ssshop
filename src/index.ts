import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import sessionsRouter from './routes/sessions.js';
import bookingsRouter from './routes/bookings.js';
import packagesRouter from './routes/packages.js';
import adminRouter from './routes/admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// ── Middleware ──────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Static Files (Frontend) ────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── API Routes ─────────────────────────────────
app.use('/api/sessions', sessionsRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/packages', packagesRouter);
app.use('/api/admin', adminRouter);

// ── Health Check ───────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── SPA Fallback ───────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Error Handler ──────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start Server ───────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  ⛰️  SSShophaus Boulder — Backend');
  console.log(`  🚀 Server running at http://localhost:${PORT}`);
  console.log(`  📡 API available at http://localhost:${PORT}/api`);
  console.log('');
});

export default app;
