import express from 'express';
import cors from 'cors';
import { config, validateConfig } from './config/index.js';
import authRoutes from './routes/auth.routes.js';
import ticketRoutes from './routes/ticket.routes.js';

const app = express();

const allowedOrigins = [
  config.frontendUrl,
  'https://customer-ai-frontend.vercel.app',
  'http://localhost:5173',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const normalized = origin.replace(/\/+$/, '');
    if (allowedOrigins.includes(normalized) || normalized.endsWith('.vercel.app')) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
}));

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'ResoX backend is running',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);

validateConfig();

app.listen(config.port, () => {
  console.log(`ResoX backend running on http://localhost:${config.port}`);
});