/**
 * Processes a garment image after upload:
 *  1. Read dimensions with Sharp
 *  2. Validate minimum quality thresholds locally (no AI call)
 *  3. Call Gemini for full analysis (only if not already analyzed)
 *  4. Save results back to DB
 */
const sharp = require('sharp');
const { analyzeGarment } = require('./gemini');
const { run, get } = require('../db');

const MIN_DIMENSION = 400; // px — below this we reject immediately

async function getDimensions(filePath) {
  const meta = await sharp(filePath).metadata();
  return { width: meta.width, height: meta.height };
}

function localQualityCheck(width, height) {
  const issues = [];
  let score = 100;

  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    issues.push(`Resolution too low (${width}×${height}px, minimum ${MIN_DIMENSION}px)`);
    score -= 40;
  } else if (width < 1024 || height < 1024) {
    issues.push('Resolution below recommended 1024px — quality may be reduced');
    score -= 15;
  }

  return { score: Math.max(0, score), issues };
}

/**
 * Full processing pipeline for a newly uploaded garment.
 * Calls Gemini once and caches in DB.
 */
async function processGarment(garmentId) {
  const garment = get('SELECT * FROM garments WHERE id = ?', [garmentId]);
  if (!garment) throw new Error(`Garment ${garmentId} not found`);
  if (garment.ai_analyzed) return; // already done — don't burn API credits

  const { width, height } = await getDimensions(garment.file_path);
  const local = localQualityCheck(width, height);

  let aiResult = null;
  try {
    aiResult = await analyzeGarment(garment.file_path);
  } catch (err) {
    // Gemini failure is non-fatal — we store what we have locally
    console.error(`[gemini] analyzeGarment failed for ${garmentId}:`, err.message);
  }

  const qualityScore = aiResult ? Math.round((local.score + aiResult.quality_score) / 2) : local.score;
  const qualityIssues = [...local.issues, ...(aiResult?.quality_issues ?? [])];

  run(
    `UPDATE garments SET
      width = ?, height = ?,
      category = ?, subcategory = ?,
      color = ?, tags = ?,
      quality_score = ?, quality_issues = ?,
      ai_description = ?, ai_analyzed = 1,
      metadata = ?,
      status = ?,
      updated_at = datetime('now')
    WHERE id = ?`,
    [
      width, height,
      aiResult?.category ?? garment.category,
      aiResult?.subcategory ?? garment.subcategory,
      aiResult?.color ?? garment.color,
      JSON.stringify(aiResult?.tags ?? []),
      qualityScore,
      JSON.stringify(qualityIssues),
      aiResult?.description ?? null,
      JSON.stringify({
        pattern: aiResult?.pattern,
        fit: aiResult?.fit,
        fabric_texture: aiResult?.fabric_texture,
        colors: aiResult?.colors,
      }),
      qualityScore >= 50 ? 'ready' : 'draft',
      garmentId,
    ]
  );
}

module.exports = { processGarment, getDimensions, localQualityCheck };
