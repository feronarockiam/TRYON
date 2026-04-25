const express = require('express');
const router = express.Router();

const { requireApiKey } = require('../middleware/auth');
const { get, all } = require('../db');

router.use(requireApiKey);

// ---------------------------------------------------------------------------
// GET /analytics/overview — main dashboard metrics
// ---------------------------------------------------------------------------
router.get('/overview', (req, res) => {
  const wid = req.workspace.id;
  const { days = 30 } = req.query;
  const since = `datetime('now', '-${Number(days)} days')`;

  const garments = {
    total: get(`SELECT COUNT(*) as n FROM garments WHERE workspace_id = ? AND deleted_at IS NULL`, [wid]).n,
    ready: get(`SELECT COUNT(*) as n FROM garments WHERE workspace_id = ? AND status = 'ready' AND deleted_at IS NULL`, [wid]).n,
    draft: get(`SELECT COUNT(*) as n FROM garments WHERE workspace_id = ? AND status = 'draft' AND deleted_at IS NULL`, [wid]).n,
    analyzed: get(`SELECT COUNT(*) as n FROM garments WHERE workspace_id = ? AND ai_analyzed = 1 AND deleted_at IS NULL`, [wid]).n,
    avg_quality: get(`SELECT ROUND(AVG(quality_score),1) as v FROM garments WHERE workspace_id = ? AND deleted_at IS NULL`, [wid]).v || 0,
  };

  const jobs = {
    total: get(`SELECT COUNT(*) as n FROM jobs WHERE workspace_id = ?`, [wid]).n,
    completed: get(`SELECT COUNT(*) as n FROM jobs WHERE workspace_id = ? AND status = 'completed'`, [wid]).n,
    processing: get(`SELECT COUNT(*) as n FROM jobs WHERE workspace_id = ? AND status IN ('pending','processing')`, [wid]).n,
    failed: get(`SELECT COUNT(*) as n FROM jobs WHERE workspace_id = ? AND status = 'failed'`, [wid]).n,
    recent: get(`SELECT COUNT(*) as n FROM jobs WHERE workspace_id = ? AND created_at >= ${since}`, [wid]).n,
  };

  const assets = {
    total: get(`SELECT COUNT(*) as n FROM assets WHERE workspace_id = ?`, [wid]).n,
    approved: get(`SELECT COUNT(*) as n FROM assets WHERE workspace_id = ? AND status = 'approved'`, [wid]).n,
    published: get(`SELECT COUNT(*) as n FROM assets WHERE workspace_id = ? AND status = 'published'`, [wid]).n,
    draft: get(`SELECT COUNT(*) as n FROM assets WHERE workspace_id = ? AND status = 'draft'`, [wid]).n,
    rejected: get(`SELECT COUNT(*) as n FROM assets WHERE workspace_id = ? AND status = 'rejected'`, [wid]).n,
    recent: get(`SELECT COUNT(*) as n FROM assets WHERE workspace_id = ? AND created_at >= ${since}`, [wid]).n,
  };

  const coverage = garments.total > 0
    ? Math.round((get(`SELECT COUNT(DISTINCT garment_id) as n FROM assets WHERE workspace_id = ? AND status IN ('approved','published')`, [wid]).n / garments.total) * 100)
    : 0;

  res.json({
    period_days: Number(days),
    garments,
    jobs,
    assets,
    try_on_coverage_pct: coverage,
    credits: {
      remaining: req.workspace.credits,
      used_period: get(`SELECT COUNT(*) as n FROM job_items ji JOIN jobs j ON ji.job_id = j.id WHERE j.workspace_id = ? AND ji.created_at >= ${since}`, [wid]).n,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /analytics/garments — per-garment try-on stats
// ---------------------------------------------------------------------------
router.get('/garments', (req, res) => {
  const wid = req.workspace.id;
  const { page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const rows = all(
    `SELECT
       g.id, g.name, g.sku, g.category, g.quality_score,
       COUNT(DISTINCT a.id) as total_assets,
       SUM(CASE WHEN a.status = 'approved' THEN 1 ELSE 0 END) as approved_assets,
       SUM(CASE WHEN a.status = 'published' THEN 1 ELSE 0 END) as published_assets,
       SUM(CASE WHEN a.status = 'rejected' THEN 1 ELSE 0 END) as rejected_assets
     FROM garments g
     LEFT JOIN assets a ON g.id = a.garment_id
     WHERE g.workspace_id = ? AND g.deleted_at IS NULL
     GROUP BY g.id
     ORDER BY total_assets DESC, g.created_at DESC
     LIMIT ? OFFSET ?`,
    [wid, Number(limit), offset]
  );

  const total = get(`SELECT COUNT(*) as n FROM garments WHERE workspace_id = ? AND deleted_at IS NULL`, [wid]).n;

  res.json({
    data: rows,
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
  });
});

// ---------------------------------------------------------------------------
// GET /analytics/models — most-used models
// ---------------------------------------------------------------------------
router.get('/models', (req, res) => {
  const wid = req.workspace.id;

  const rows = all(
    `SELECT
       m.id, m.name, m.gender, m.body_type, m.skin_tone,
       COUNT(a.id) as total_assets,
       SUM(CASE WHEN a.status = 'approved' THEN 1 ELSE 0 END) as approved
     FROM ai_models m
     LEFT JOIN assets a ON m.id = a.model_id AND a.workspace_id = ?
     GROUP BY m.id
     HAVING total_assets > 0
     ORDER BY total_assets DESC
     LIMIT 20`,
    [wid]
  );

  res.json({ data: rows });
});

// ---------------------------------------------------------------------------
// GET /analytics/quality — quality score distribution
// ---------------------------------------------------------------------------
router.get('/quality', (req, res) => {
  const wid = req.workspace.id;

  const distribution = all(
    `SELECT
       CASE
         WHEN quality_score >= 90 THEN 'excellent'
         WHEN quality_score >= 70 THEN 'good'
         WHEN quality_score >= 50 THEN 'fair'
         ELSE 'poor'
       END as tier,
       COUNT(*) as count
     FROM garments
     WHERE workspace_id = ? AND deleted_at IS NULL
     GROUP BY tier`,
    [wid]
  );

  const flagged = all(
    `SELECT id, name, sku, quality_score, quality_issues
     FROM garments
     WHERE workspace_id = ? AND quality_score < 50 AND deleted_at IS NULL
     ORDER BY quality_score ASC LIMIT 20`,
    [wid]
  );

  res.json({
    distribution,
    flagged_garments: flagged.map(g => ({
      ...g,
      quality_issues: tryParse(g.quality_issues, []),
    })),
  });
});

function tryParse(val, fallback) {
  try { return JSON.parse(val); } catch { return fallback; }
}

module.exports = router;
