/**
 * In-memory async job queue.
 * Suitable for development / single-instance deployments.
 * Replace with BullMQ + Redis for multi-instance production.
 */
const { v4: uuidv4 } = require('uuid');
const { get, run, all, transaction } = require('../db');
const { generate } = require('./tryon');

const CONCURRENCY = parseInt(process.env.JOB_CONCURRENCY || '3', 10);
let activeWorkers = 0;
let processing = false;

// ---------------------------------------------------------------------------
// Job creation
// ---------------------------------------------------------------------------

/**
 * Create a job with a list of { garmentId, modelId, pose } combos.
 */
function createJob(workspaceId, items, settings = {}, name = null) {
  const jobId = uuidv4();
  const jobName = name || `Job ${new Date().toISOString().slice(0, 16)}`;

  transaction(() => {
    run(
      `INSERT INTO jobs (id, workspace_id, name, type, total_items, settings)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [jobId, workspaceId, jobName, items.length === 1 ? 'single' : 'bulk', items.length, JSON.stringify(settings)]
    );

    for (const item of items) {
      run(
        `INSERT INTO job_items (id, job_id, garment_id, model_id, pose)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), jobId, item.garmentId, item.modelId, item.pose || 'front']
      );
    }
  });

  // Kick off processing asynchronously
  setImmediate(processQueue);

  return jobId;
}

// ---------------------------------------------------------------------------
// Queue processing
// ---------------------------------------------------------------------------

async function processQueue() {
  if (processing) return;
  processing = true;

  try {
    while (activeWorkers < CONCURRENCY) {
      const item = get(
        `SELECT ji.*, j.workspace_id, j.settings as job_settings
         FROM job_items ji
         JOIN jobs j ON ji.job_id = j.id
         WHERE ji.status = 'pending' AND j.status IN ('pending','processing')
         ORDER BY ji.created_at ASC
         LIMIT 1`
      );
      if (!item) break;

      activeWorkers++;
      processItem(item).finally(() => {
        activeWorkers--;
        // Try to pick up more work
        setImmediate(processQueue);
      });
    }
  } finally {
    processing = false;
  }
}

async function processItem(item) {
  // Mark item + parent job as processing
  run(`UPDATE job_items SET status = 'processing', attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?`, [item.id]);
  run(`UPDATE jobs SET status = 'processing', updated_at = datetime('now') WHERE id = ? AND status = 'pending'`, [item.job_id]);

  try {
    const garment = get('SELECT * FROM garments WHERE id = ?', [item.garment_id]);
    const aiModel = get('SELECT * FROM ai_models WHERE id = ?', [item.model_id]);

    if (!garment) throw new Error(`Garment ${item.garment_id} not found`);
    if (!aiModel) throw new Error(`Model ${item.model_id} not found`);

    const settings = JSON.parse(item.job_settings || '{}');
    const filePaths = JSON.parse(aiModel.file_paths || '{}');
    const modelFilePath = filePaths[item.pose] || filePaths.front || null;

    const result = await generate(garment.file_path, modelFilePath, settings);

    // Save asset
    const assetId = uuidv4();
    run(
      `INSERT INTO assets (id, workspace_id, garment_id, model_id, job_item_id, type, file_path, file_url, resolution, format, width, height, file_size, settings)
       VALUES (?, ?, ?, ?, ?, 'tryon', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        assetId,
        item.workspace_id,
        item.garment_id,
        item.model_id,
        item.id,
        result.filePath,
        result.fileUrl,
        result.resolution,
        result.format,
        result.width,
        result.height,
        result.fileSize,
        JSON.stringify(settings),
      ]
    );

    run(
      `UPDATE job_items SET status = 'completed', asset_id = ?, updated_at = datetime('now') WHERE id = ?`,
      [assetId, item.id]
    );
  } catch (err) {
    console.error(`[jobQueue] item ${item.id} failed:`, err.message);
    const willRetry = item.attempts < 2;
    run(
      `UPDATE job_items SET status = ?, error = ?, updated_at = datetime('now') WHERE id = ?`,
      [willRetry ? 'pending' : 'failed', err.message, item.id]
    );
  }

  updateJobProgress(item.job_id);
}

function updateJobProgress(jobId) {
  const counts = get(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status IN ('pending','processing') THEN 1 ELSE 0 END) as remaining
     FROM job_items WHERE job_id = ?`,
    [jobId]
  );

  const progress = counts.total > 0 ? Math.round(((counts.completed + counts.failed) / counts.total) * 100) : 0;
  const isDone = counts.remaining === 0;
  const status = isDone ? (counts.failed === counts.total ? 'failed' : 'completed') : 'processing';

  run(
    `UPDATE jobs SET
      status = ?, progress = ?,
      completed_items = ?, failed_items = ?,
      completed_at = CASE WHEN ? THEN datetime('now') ELSE completed_at END,
      updated_at = datetime('now')
     WHERE id = ?`,
    [status, progress, counts.completed, counts.failed, isDone ? 1 : 0, jobId]
  );
}

// Resume any pending jobs from a previous server run
function resumePendingJobs() {
  run(`UPDATE job_items SET status = 'pending' WHERE status = 'processing'`);
  run(`UPDATE jobs SET status = 'pending' WHERE status = 'processing'`);
  const pending = get(`SELECT COUNT(*) as n FROM job_items WHERE status = 'pending'`);
  if (pending.n > 0) {
    console.log(`[jobQueue] Resuming ${pending.n} pending job items`);
    setImmediate(processQueue);
  }
}

module.exports = { createJob, processQueue, resumePendingJobs };
