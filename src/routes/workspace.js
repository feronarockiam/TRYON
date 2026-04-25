const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const { requireApiKey } = require('../middleware/auth');
const { get, run, all } = require('../db');

// ---------------------------------------------------------------------------
// POST /workspace — create a new workspace (used during onboarding / admin)
// No auth required for creation
// ---------------------------------------------------------------------------
router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const id = uuidv4();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const apiKey = `tryon_${uuidv4().replace(/-/g, '')}`;

  // Ensure slug is unique
  const existing = get('SELECT id FROM workspaces WHERE slug = ?', [slug]);
  const finalSlug = existing ? `${slug}-${id.slice(0, 6)}` : slug;

  run(
    `INSERT INTO workspaces (id, name, slug, api_key) VALUES (?, ?, ?, ?)`,
    [id, name, finalSlug, apiKey]
  );

  res.status(201).json({
    id,
    name,
    slug: finalSlug,
    api_key: apiKey,
    plan: 'starter',
    credits: 200,
    message: 'Workspace created. Save your api_key — it will not be shown again.',
  });
});

router.use(requireApiKey);

// ---------------------------------------------------------------------------
// GET /workspace — get current workspace info
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  const garmentCount = get('SELECT COUNT(*) as n FROM garments WHERE workspace_id = ? AND deleted_at IS NULL', [req.workspace.id]).n;
  const assetCount = get('SELECT COUNT(*) as n FROM assets WHERE workspace_id = ?', [req.workspace.id]).n;
  const pendingJobs = get("SELECT COUNT(*) as n FROM jobs WHERE workspace_id = ? AND status IN ('pending','processing')", [req.workspace.id]).n;

  res.json({
    id: req.workspace.id,
    name: req.workspace.name,
    slug: req.workspace.slug,
    plan: req.workspace.plan,
    credits: req.workspace.credits,
    settings: req.workspace.settings,
    stats: { garments: garmentCount, assets: assetCount, active_jobs: pendingJobs },
  });
});

// ---------------------------------------------------------------------------
// PATCH /workspace/settings — update workspace settings
// ---------------------------------------------------------------------------
router.patch('/settings', (req, res) => {
  const current = JSON.parse(get('SELECT settings FROM workspaces WHERE id = ?', [req.workspace.id]).settings || '{}');
  const merged = { ...current, ...req.body };
  run(`UPDATE workspaces SET settings = ? WHERE id = ?`, [JSON.stringify(merged), req.workspace.id]);
  res.json({ settings: merged });
});

// ---------------------------------------------------------------------------
// GET /workspace/api-keys — list API keys info (no raw keys)
// ---------------------------------------------------------------------------
router.get('/api-keys', (req, res) => {
  // In this simple version we have one key per workspace. Extend for multi-key later.
  res.json({
    keys: [{ id: req.workspace.id, masked: `tryon_****${req.workspace.api_key.slice(-6)}`, created_at: req.workspace.created_at }],
  });
});

// ---------------------------------------------------------------------------
// POST /workspace/api-keys/rotate — rotate API key
// ---------------------------------------------------------------------------
router.post('/api-keys/rotate', (req, res) => {
  const newKey = `tryon_${uuidv4().replace(/-/g, '')}`;
  run(`UPDATE workspaces SET api_key = ? WHERE id = ?`, [newKey, req.workspace.id]);
  res.json({ api_key: newKey, message: 'API key rotated. Update your integrations immediately.' });
});

module.exports = router;
