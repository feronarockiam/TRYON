const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const { requireApiKey } = require('../middleware/auth');
const { modelUpload } = require('../middleware/upload');
const { get, all, run } = require('../db');
const { modelUrl } = require('../services/storage');

router.use(requireApiKey);

// ---------------------------------------------------------------------------
// GET /models — list models with filters
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  const { gender, body_type, skin_tone, ethnicity, age_range, page = 1, limit = 50 } = req.query;

  const conditions = [
    'is_active = 1',
    '(workspace_id IS NULL OR workspace_id = ?)',
  ];
  const params = [req.workspace.id];

  if (gender) { conditions.push('gender = ?'); params.push(gender); }
  if (body_type) { conditions.push('body_type = ?'); params.push(body_type); }
  if (skin_tone) { conditions.push('skin_tone = ?'); params.push(skin_tone); }
  if (ethnicity) { conditions.push('ethnicity = ?'); params.push(ethnicity); }
  if (age_range) { conditions.push('age_range = ?'); params.push(age_range); }

  const where = conditions.join(' AND ');
  const offset = (Number(page) - 1) * Number(limit);

  const models = all(
    `SELECT * FROM ai_models WHERE ${where} ORDER BY name ASC LIMIT ? OFFSET ?`,
    [...params, Number(limit), offset]
  );
  const total = get(`SELECT COUNT(*) as n FROM ai_models WHERE ${where}`, params).n;

  res.json({
    data: models.map(formatModel),
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
    filters: {
      gender: ['feminine', 'masculine', 'androgynous'],
      body_type: ['petite', 'slim', 'regular', 'curvy', 'plus'],
      age_range: ['18-25', '26-35', '36-50', '50+'],
    },
  });
});

// ---------------------------------------------------------------------------
// GET /models/:id
// ---------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const model = get(
    'SELECT * FROM ai_models WHERE id = ? AND is_active = 1 AND (workspace_id IS NULL OR workspace_id = ?)',
    [req.params.id, req.workspace.id]
  );
  if (!model) return res.status(404).json({ error: 'Model not found' });
  res.json(formatModel(model));
});

// ---------------------------------------------------------------------------
// POST /models — add a new model (with image upload for each pose)
// ---------------------------------------------------------------------------
router.post('/', modelUpload.fields([
  { name: 'front', maxCount: 1 },
  { name: 'back', maxCount: 1 },
  { name: 'side', maxCount: 1 },
  { name: 'lifestyle', maxCount: 1 },
]), (req, res) => {
  const { name, gender, body_type, skin_tone, ethnicity, age_range, height_cm, size_label, tags } = req.body;

  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!req.files?.front) return res.status(400).json({ error: 'front pose image is required' });

  const filePaths = {};
  const fileUrls = {};
  const poses = [];

  for (const pose of ['front', 'back', 'side', 'lifestyle']) {
    if (req.files?.[pose]?.[0]) {
      filePaths[pose] = req.files[pose][0].path;
      fileUrls[pose] = modelUrl(path.basename(req.files[pose][0].path));
      poses.push(pose);
    }
  }

  const id = uuidv4();
  const isCustom = req.workspace ? 1 : 0;
  const workspaceId = isCustom ? req.workspace.id : null;

  run(
    `INSERT INTO ai_models (id, name, gender, body_type, skin_tone, ethnicity, age_range, height_cm, size_label, poses, file_paths, file_urls, tags, is_custom, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, gender, body_type, skin_tone, ethnicity, age_range,
     height_cm ? Number(height_cm) : null, size_label,
     JSON.stringify(poses), JSON.stringify(filePaths), JSON.stringify(fileUrls),
     JSON.stringify(tags ? JSON.parse(tags) : []),
     isCustom, workspaceId]
  );

  res.status(201).json(formatModel(get('SELECT * FROM ai_models WHERE id = ?', [id])));
});

// ---------------------------------------------------------------------------
// PATCH /models/:id — update model metadata
// ---------------------------------------------------------------------------
router.patch('/:id', (req, res) => {
  const model = get(
    'SELECT * FROM ai_models WHERE id = ? AND (workspace_id IS NULL OR workspace_id = ?)',
    [req.params.id, req.workspace.id]
  );
  if (!model) return res.status(404).json({ error: 'Model not found' });

  const allowed = ['name', 'gender', 'body_type', 'skin_tone', 'ethnicity', 'age_range', 'height_cm', 'size_label', 'is_active'];
  const updates = [];
  const params = [];

  for (const field of allowed) {
    if (req.body[field] !== undefined) { updates.push(`${field} = ?`); params.push(req.body[field]); }
  }
  if (req.body.tags) { updates.push('tags = ?'); params.push(JSON.stringify(req.body.tags)); }
  if (!updates.length) return res.status(400).json({ error: 'No updatable fields provided' });

  run(`UPDATE ai_models SET ${updates.join(', ')} WHERE id = ?`, [...params, req.params.id]);
  res.json(formatModel(get('SELECT * FROM ai_models WHERE id = ?', [req.params.id])));
});

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------
function formatModel(m) {
  return {
    ...m,
    poses: tryParse(m.poses, []),
    file_paths: tryParse(m.file_paths, {}),
    file_urls: tryParse(m.file_urls, {}),
    tags: tryParse(m.tags, []),
    is_active: Boolean(m.is_active),
    is_custom: Boolean(m.is_custom),
  };
}

function tryParse(val, fallback) {
  try { return JSON.parse(val); } catch { return fallback; }
}

module.exports = router;
