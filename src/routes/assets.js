const express = require('express');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const router = express.Router();

const { requireApiKey } = require('../middleware/auth');
const { get, all, run } = require('../db');

router.use(requireApiKey);

// ---------------------------------------------------------------------------
// GET /assets — list assets with filters
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  const { garment_id, model_id, status, type, page = 1, limit = 20 } = req.query;

  const conditions = ['a.workspace_id = ?'];
  const params = [req.workspace.id];

  if (garment_id) { conditions.push('a.garment_id = ?'); params.push(garment_id); }
  if (model_id) { conditions.push('a.model_id = ?'); params.push(model_id); }
  if (status) { conditions.push('a.status = ?'); params.push(status); }
  if (type) { conditions.push('a.type = ?'); params.push(type); }

  const offset = (Number(page) - 1) * Number(limit);
  const assets = all(
    `SELECT a.*, g.name as garment_name, g.sku, m.name as model_name
     FROM assets a
     LEFT JOIN garments g ON a.garment_id = g.id
     LEFT JOIN ai_models m ON a.model_id = m.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...params, Number(limit), offset]
  );
  const total = get(`SELECT COUNT(*) as n FROM assets a WHERE ${conditions.join(' AND ')}`, params).n;

  res.json({
    data: assets.map(formatAsset),
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
  });
});

// ---------------------------------------------------------------------------
// GET /assets/:id
// ---------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const asset = get(
    `SELECT a.*, g.name as garment_name, g.sku, m.name as model_name
     FROM assets a
     LEFT JOIN garments g ON a.garment_id = g.id
     LEFT JOIN ai_models m ON a.model_id = m.id
     WHERE a.id = ? AND a.workspace_id = ?`,
    [req.params.id, req.workspace.id]
  );
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  res.json(formatAsset(asset));
});

// ---------------------------------------------------------------------------
// PATCH /assets/:id/status — approve / reject / publish
// ---------------------------------------------------------------------------
router.patch('/:id/status', (req, res) => {
  const { status, notes } = req.body;
  const allowed = ['draft', 'approved', 'rejected', 'published'];
  if (!allowed.includes(status)) return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });

  const asset = get('SELECT * FROM assets WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspace.id]);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  run(
    `UPDATE assets SET status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
    [status, notes || asset.notes, req.params.id]
  );
  res.json(formatAsset(get('SELECT * FROM assets WHERE id = ?', [req.params.id])));
});

// ---------------------------------------------------------------------------
// POST /assets/bulk-status — bulk approve/reject
// ---------------------------------------------------------------------------
router.post('/bulk-status', (req, res) => {
  const { ids, status, notes } = req.body;
  const allowed = ['approved', 'rejected', 'published'];
  if (!allowed.includes(status)) return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids must be a non-empty array' });

  const placeholders = ids.map(() => '?').join(',');
  run(
    `UPDATE assets SET status = ?, notes = COALESCE(?, notes), updated_at = datetime('now')
     WHERE id IN (${placeholders}) AND workspace_id = ?`,
    [status, notes || null, ...ids, req.workspace.id]
  );

  res.json({ message: `Updated ${ids.length} assets to status: ${status}` });
});

// ---------------------------------------------------------------------------
// GET /assets/:id/download — stream file download
// ---------------------------------------------------------------------------
router.get('/:id/download', (req, res) => {
  const asset = get('SELECT * FROM assets WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspace.id]);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (!fs.existsSync(asset.file_path)) return res.status(404).json({ error: 'File not found on disk' });

  const ext = path.extname(asset.file_path);
  res.download(asset.file_path, `asset-${asset.id}${ext}`);
});

// ---------------------------------------------------------------------------
// POST /assets/bulk-download — ZIP of multiple assets
// ---------------------------------------------------------------------------
router.post('/bulk-download', (req, res) => {
  const { ids, garment_id, model_id, status } = req.body;

  let assets;
  if (ids && Array.isArray(ids)) {
    const ph = ids.map(() => '?').join(',');
    assets = all(
      `SELECT a.*, g.sku FROM assets a LEFT JOIN garments g ON a.garment_id = g.id WHERE a.id IN (${ph}) AND a.workspace_id = ?`,
      [...ids, req.workspace.id]
    );
  } else {
    const conds = ['a.workspace_id = ?'];
    const params = [req.workspace.id];
    if (garment_id) { conds.push('a.garment_id = ?'); params.push(garment_id); }
    if (model_id) { conds.push('a.model_id = ?'); params.push(model_id); }
    if (status) { conds.push('a.status = ?'); params.push(status); }
    assets = all(
      `SELECT a.*, g.sku FROM assets a LEFT JOIN garments g ON a.garment_id = g.id WHERE ${conds.join(' AND ')}`,
      params
    );
  }

  if (!assets.length) return res.status(404).json({ error: 'No assets found' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="tryon-assets-${Date.now()}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);

  for (const asset of assets) {
    if (fs.existsSync(asset.file_path)) {
      const label = asset.sku ? `${asset.sku}-${asset.id}` : asset.id;
      archive.file(asset.file_path, { name: `${label}${path.extname(asset.file_path)}` });
    }
  }

  archive.finalize();
});

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------
function formatAsset(a) {
  return { ...a, settings: tryParse(a.settings, {}) };
}

function tryParse(val, fallback) {
  try { return JSON.parse(val); } catch { return fallback; }
}

module.exports = router;
