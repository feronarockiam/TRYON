/**
 * Gemini AI wrapper — frugal usage policy:
 *  - Only called once per garment (result cached in DB)
 *  - Uses gemini-1.5-flash (cheapest vision model)
 *  - Used for: garment analysis, quality scoring, auto-tagging
 *  - NOT used for: try-on generation (handled by tryon.js stub)
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Use flash — cheapest model that supports vision
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

function fileToGenerativePart(filePath, mimeType) {
  return {
    inlineData: {
      data: fs.readFileSync(filePath).toString('base64'),
      mimeType,
    },
  };
}

function detectMime(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  return map[ext] || 'image/jpeg';
}

/**
 * Analyse a garment image and return structured metadata.
 * Result should be cached in DB (ai_analyzed=1) to avoid repeat calls.
 */
async function analyzeGarment(filePath) {
  const imagePart = fileToGenerativePart(filePath, detectMime(filePath));

  const prompt = `You are a fashion product cataloguing AI. Analyse this garment image and return ONLY valid JSON with this exact structure:

{
  "category": "<one of: tops, bottoms, dresses, outerwear, footwear, accessories, other>",
  "subcategory": "<specific type e.g. t-shirt, jeans, blazer, sneakers>",
  "color": "<primary color name>",
  "colors": ["<color1>", "<color2>"],
  "tags": ["<tag1>", "<tag2>", "<tag3>"],
  "quality_score": <integer 0-100>,
  "quality_issues": ["<issue1 if any>"],
  "description": "<one sentence product description>",
  "pattern": "<solid, striped, floral, geometric, graphic, etc>",
  "fit": "<slim, regular, relaxed, oversized>",
  "fabric_texture": "<cotton, denim, silk, knit, leather, etc>"
}

Quality score rules:
- 90-100: Perfect white/neutral bg, full garment visible, sharp, studio lighting
- 70-89: Minor issues (slight shadow, small background imperfections)
- 50-69: Moderate issues (cluttered background, partial garment, soft focus)
- 0-49: Major issues (wrong angle, garment obscured, very low resolution)

Only add quality_issues entries if there are actual problems. Return ONLY the JSON object, no markdown.`;

  const result = await model.generateContent([prompt, imagePart]);
  const text = result.response.text().trim();

  // Strip markdown code fences if model adds them anyway
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  return JSON.parse(cleaned);
}

/**
 * Validate a garment image quality without full analysis.
 * Lighter call — only returns pass/fail + issues.
 */
async function quickQualityCheck(filePath) {
  const imagePart = fileToGenerativePart(filePath, detectMime(filePath));

  const prompt = `Rate this garment image quality for e-commerce on a scale of 0-100. Return ONLY JSON:
{"score": <0-100>, "issues": ["<issue if any>"], "suitable_for_tryon": <true/false>}`;

  const result = await model.generateContent([prompt, imagePart]);
  const text = result.response.text().trim();
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(cleaned);
}

module.exports = { analyzeGarment, quickQualityCheck };
