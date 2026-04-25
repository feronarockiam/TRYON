require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

const { init: initStorage, ROOT } = require('./services/storage');
const { resumePendingJobs } = require('./services/jobQueue');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
initStorage();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiter — generous for dev, tighten per-plan in production
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
}));

// Serve the frontend dashboard
app.use(express.static(path.join(__dirname, '../public')));

// Serve uploaded and generated files statically
app.use('/static', express.static(path.join(ROOT)));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api/workspace', require('./routes/workspace'));
app.use('/api/garments', require('./routes/garments'));
app.use('/api/models', require('./routes/models'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/assets', require('./routes/assets'));
app.use('/api/analytics', require('./routes/analytics'));

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    engine: process.env.TRYON_ENGINE || 'composite',
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// SPA fallback — serve index.html for any non-API, non-static GET
// ---------------------------------------------------------------------------
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/static') && !req.path.startsWith('/health')) {
    return res.sendFile(path.join(__dirname, '../public/index.html'));
  }
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ---------------------------------------------------------------------------
// Error handlers
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large' });
  console.error('[error]', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n🚀  TRYON API running at http://localhost:${PORT}`);
  console.log(`   Engine: ${process.env.TRYON_ENGINE || 'composite (dev stub)'}`);
  console.log(`   Static files: http://localhost:${PORT}/static/`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
  resumePendingJobs();
});
