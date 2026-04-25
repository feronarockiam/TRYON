const express = require('express');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const { requireApiKey } = require('../middleware/auth');
const { garmentUpload, zipUpload } = require('../middleware/upload');
const { get, all, run } = require('../db');
const { processGarment, getDimensions } = require('../services/garmentProcessor');
const { garmentPath, garmentUrl, deleteFile } = require('../services/storage');

router.use(requireApiKey);

// ---------------------------------------------------------------------------
// GET /garments — list with filters + pagination
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  const {
    category, status, collection, season, sku,
    quality_min, quality_max,
    page = 1, limit = 20,
    sort = 'created_at', order = 'desc',
  } = req.query;

  const conditions = ['g.workspace_id = ?', 'g.deleted_at IS NULL'];
  const params = [req.workspace.id];

  if (category) { conditions.push('g.category = ?'); params.push(category); }
  if (status) { conditions.push('g.status = ?'); params.push(status); }
  if (collection) { conditions.push('g.collection = ?'); params.push(collection); }
  if (season) { conditions.push('g.season = ?'); params.push(season); }
  if (sku) { conditions.push('g.sku LIKE ?'); params.push(`%${sku}%`); }
  if (quality_min) { conditions.push('g.quality_score >= ?'); params.push(Number(quality_min)); }
  if (quality_max) { conditions.push('g.quality_score <= ?'); params.push(Number(quality_max)); }

  const safeSort = ['created_at', 'quality_score', 'name', 'sku', 'category'].includes(sort) ? sort : 'created_at';
  const safeOrder = order === 'asc' ? 'ASC' : 'DESC';
  const offset = (Number(page) - 1) * Number(limit);

  const where = conditions.join(' AND ');
  const garments = all(
    `SELECT g.* FROM garments g WHERE ${where} ORDER BY g.${safeSort} ${safeOrder} LIMIT ? OFFSET ?`,
    [...params, Number(limit), offset]
  );
  const total = get(`SELECT COUNT(*) as n FROM garments g WHERE ${where}`, params).n;

  res.json({
    data: garments.map(formatGarment),
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
  });
});

// ---------------------------------------------------------------------------
// GET /garments/:id
// ---------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const garment = get('SELECT * FROM garments WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', [req.params.id, req.workspace.id]);
  if (!garment) return res.status(404).json({ error: 'Garment not found' });
  res.json(formatGarment(garment));
});

// ---------------------------------------------------------------------------
// POST /garments/upload — single garment upload
// ---------------------------------------------------------------------------
router.post('/upload', garmentUpload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });

  const id = uuidv4();
  const { name, sku, collection, season, category } = req.body;
  const filePath = req.file.path;
  const fileUrl = garmentUrl(path.basename(filePath));

  try {
    const { width, height } = await getDimensions(filePath);

    run(
      `INSERT INTO garments (id, workspace_id, name, sku, category, collection, season, file_path, file_url, original_filename, file_size, width, height)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.workspace.id, name || req.file.originalname, sku, category, collection, season,
       filePath, fileUrl, req.file.originalname, req.file.size, width, height]
    );

    // Fire-and-forget Gemini analysis (happens in background)
    processGarment(id).catch(err => console.error(`[garments] processGarment error:`, err.message));

    const garment = get('SELECT * FROM garments WHERE id = ?', [id]);
    res.status(201).json(formatGarment(garment));
  } catch (err) {
    deleteFile(filePath);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /garments/bulk-upload — ZIP with optional metadata CSV
// ---------------------------------------------------------------------------
router.post('/bulk-upload', zipUpload.single('archive'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No ZIP file provided' });

  const zipPath = req.file.path;
  const results = { created: [], failed: [] };

  try {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries().filter(e =>
      !e.isDirectory && /\.(jpg|jpeg|png|webp)$/i.test(e.entryName) && !e.entryName.startsWith('__MACOSX')
    );

    // Parse optional metadata.csv if present
    let meta = {};
    const csvEntry = zip.getEntry('metadata.csv');
    if (csvEntry) {
      const lines = csvEntry.getData().toString('utf8').split('\n').filter(Boolean);
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const row = {};
        headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
        if (row.filename || row.sku) meta[row.filename || row.sku] = row;
      }
    }

    for (const entry of entries) {
      try {
        const filename = path.basename(entry.entryName);
        const ext = path.extname(filename).toLowerCase();
        const newFilename = `${uuidv4()}${ext}`;
        const destPath = garmentPath(newFilename);

        zip.extractEntryTo(entry, path.dirname(destPath), false, true, false, newFilename);

        const rowMeta = meta[filename] || meta[path.parse(filename).name] || {};
        const id = uuidv4();

        run(
          `INSERT INTO garments (id, workspace_id, name, sku, category, collection, season, file_path, file_url, original_filename, file_size)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, req.workspace.id,
           rowMeta.name || path.parse(filename).name,
           rowMeta.sku || null,
           rowMeta.category || null,
           rowMeta.collection || req.body.collection || null,
           rowMeta.season || req.body.season || null,
           destPath,
           garmentUrl(newFilename),
           filename,
           entry.header.size]
        );

        // Queue Gemini analysis asynchronously
        processGarment(id).catch(err => console.error(`[bulk] processGarment ${id}:`, err.message));

        results.created.push({ id, filename });
      } catch (err) {
        results.failed.push({ filename: entry.entryName, error: err.message });
      }
    }

    res.status(207).json({
      message: `Processed ${entries.length} images`,
      created: results.created.length,
      failed: results.failed.length,
      results,
    });
  } finally {
    try { fs.unlinkSync(zipPath); } catch {}
  }
});

// ---------------------------------------------------------------------------
// PATCH /garments/:id — update metadata
// ---------------------------------------------------------------------------
router.patch('/:id', (req, res) => {
  const garment = get('SELECT * FROM garments WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', [req.params.id, req.workspace.id]);
  if (!garment) return res.status(404).json({ error: 'Garment not found' });

  const allowed = ['name', 'sku', 'category', 'subcategory', 'color', 'collection', 'season', 'status'];
  const updates = [];
  const params = [];
  for (const field of allowed) {
    if (req.body[field] !== undefined) { updates.push(`${field} = ?`); params.push(req.body[field]); }
  }
  if (req.body.tags) { updates.push('tags = ?'); params.push(JSON.stringify(req.body.tags)); }
  if (!updates.length) return res.status(400).json({ error: 'No updatable fields provided' });

  updates.push(`updated_at = datetime('now')`);
  run(`UPDATE garments SET ${updates.join(', ')} WHERE id = ?`, [...params, req.params.id]);

  res.json(formatGarment(get('SELECT * FROM garments WHERE id = ?', [req.params.id])));
});

// ---------------------------------------------------------------------------
// POST /garments/:id/analyze — re-trigger Gemini analysis
// ---------------------------------------------------------------------------
router.post('/:id/analyze', async (req, res) => {
  const garment = get('SELECT * FROM garments WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', [req.params.id, req.workspace.id]);
  if (!garment) return res.status(404).json({ error: 'Garment not found' });

  // Force re-analysis even if already done
  run(`UPDATE garments SET ai_analyzed = 0 WHERE id = ?`, [req.params.id]);

  try {
    await processGarment(req.params.id);
    res.json(formatGarment(get('SELECT * FROM garments WHERE id = ?', [req.params.id])));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /garments/:id — soft delete
// ---------------------------------------------------------------------------
router.delete('/:id', (req, res) => {
  const garment = get('SELECT * FROM garments WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', [req.params.id, req.workspace.id]);
  if (!garment) return res.status(404).json({ error: 'Garment not found' });

  run(`UPDATE garments SET deleted_at = datetime('now'), status = 'archived' WHERE id = ?`, [req.params.id]);
  res.json({ message: 'Garment archived', id: req.params.id });
});

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------
function formatGarment(g) {
  return {
    ...g,
    tags: tryParse(g.tags, []),
    quality_issues: tryParse(g.quality_issues, []),
    metadata: tryParse(g.metadata, {}),
    ai_analyzed: Boolean(g.ai_analyzed),
  };
}

function tryParse(val, fallback) {
  try { return JSON.parse(val); } catch { return fallback; }
}

module.exports = router;
