const express = require('express');
const router = express.Router();

const { requireApiKey } = require('../middleware/auth');
const { get, all, run } = require('../db');
const { createJob } = require('../services/jobQueue');

router.use(requireApiKey);

// ---------------------------------------------------------------------------
// POST /jobs — create a try-on job
// Body: { items: [{ garmentId, modelId, pose? }], settings?, name? }
//   OR: { garmentIds: [...], modelIds: [...], ... } → auto-expand matrix
// ---------------------------------------------------------------------------
router.post('/', (req, res) => {
  const { name, settings = {}, garmentIds, modelIds, items, poses = ['front'] } = req.body;

  let jobItems = [];

  // Mode 1: explicit item list
  if (items && Array.isArray(items)) {
    jobItems = items;
  }
  // Mode 2: matrix expansion — every garment × every model × every pose
  else if (garmentIds && modelIds) {
    if (!Array.isArray(garmentIds) || !Array.isArray(modelIds)) {
      return res.status(400).json({ error: 'garmentIds and modelIds must be arrays' });
    }
    for (const garmentId of garmentIds) {
      for (const modelId of modelIds) {
        for (const pose of poses) {
          jobItems.push({ garmentId, modelId, pose });
        }
      }
    }
  } else {
    return res.status(400).json({ error: 'Provide either items[] or garmentIds[] + modelIds[]' });
  }

  if (!jobItems.length) return res.status(400).json({ error: 'No items to process' });

  // Validate all referenced garments and models belong to this workspace
  for (const item of jobItems) {
    if (!item.garmentId || !item.modelId) {
      return res.status(400).json({ error: 'Each item must have garmentId and modelId' });
    }
    const garment = get('SELECT id FROM garments WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', [item.garmentId, req.workspace.id]);
    if (!garment) return res.status(400).json({ error: `Garment ${item.garmentId} not found in your workspace` });

    const model = get('SELECT id FROM ai_models WHERE id = ? AND is_active = 1 AND (workspace_id IS NULL OR workspace_id = ?)', [item.modelId, req.workspace.id]);
    if (!model) return res.status(400).json({ error: `Model ${item.modelId} not found` });
  }

  // Check credits
  const creditCost = jobItems.length;
  if (req.workspace.credits < creditCost) {
    return res.status(402).json({
      error: `Insufficient credits. Need ${creditCost}, have ${req.workspace.credits}`,
    });
  }

  const jobId = createJob(req.workspace.id, jobItems, settings, name);

  // Deduct credits
  run('UPDATE workspaces SET credits = credits - ? WHERE id = ?', [creditCost, req.workspace.id]);

  res.status(201).json(formatJob(get('SELECT * FROM jobs WHERE id = ?', [jobId])));
});

// ---------------------------------------------------------------------------
// GET /jobs — list jobs
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const conditions = ['workspace_id = ?'];
  const params = [req.workspace.id];

  if (status) { conditions.push('status = ?'); params.push(status); }

  const offset = (Number(page) - 1) * Number(limit);
  const jobs = all(
    `SELECT * FROM jobs WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, Number(limit), offset]
  );
  const total = get(`SELECT COUNT(*) as n FROM jobs WHERE ${conditions.join(' AND ')}`, params).n;

  res.json({
    data: jobs.map(formatJob),
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
  });
});

// ---------------------------------------------------------------------------
// GET /jobs/:id — job status + items
// ---------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const job = get('SELECT * FROM jobs WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspace.id]);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const items = all(
    `SELECT ji.*, a.file_url as asset_url, a.status as asset_status
     FROM job_items ji
     LEFT JOIN assets a ON ji.asset_id = a.id
     WHERE ji.job_id = ?
     ORDER BY ji.created_at ASC`,
    [req.params.id]
  );

  res.json({ ...formatJob(job), items });
});

// ---------------------------------------------------------------------------
// POST /jobs/:id/retry — re-queue failed items
// ---------------------------------------------------------------------------
router.post('/:id/retry', (req, res) => {
  const job = get('SELECT * FROM jobs WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspace.id]);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  run(
    `UPDATE job_items SET status = 'pending', error = NULL, updated_at = datetime('now')
     WHERE job_id = ? AND status = 'failed'`,
    [req.params.id]
  );
  run(`UPDATE jobs SET status = 'processing', updated_at = datetime('now') WHERE id = ?`, [req.params.id]);

  const { processQueue } = require('../services/jobQueue');
  setImmediate(processQueue);

  res.json({ message: 'Failed items re-queued', job: formatJob(get('SELECT * FROM jobs WHERE id = ?', [req.params.id])) });
});

// ---------------------------------------------------------------------------
// DELETE /jobs/:id — cancel pending job
// ---------------------------------------------------------------------------
router.delete('/:id', (req, res) => {
  const job = get('SELECT * FROM jobs WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspace.id]);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!['pending', 'processing'].includes(job.status)) {
    return res.status(400).json({ error: `Cannot cancel a job with status: ${job.status}` });
  }

  run(`UPDATE jobs SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`, [req.params.id]);
  run(`UPDATE job_items SET status = 'failed', error = 'Job cancelled', updated_at = datetime('now') WHERE job_id = ? AND status = 'pending'`, [req.params.id]);

  res.json({ message: 'Job cancelled' });
});

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------
function formatJob(j) {
  return { ...j, settings: tryParse(j.settings, {}) };
}

function tryParse(val, fallback) {
  try { return JSON.parse(val); } catch { return fallback; }
}

module.exports = router;
