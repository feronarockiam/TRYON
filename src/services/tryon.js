/**
 * Try-on generation service.
 *
 * Architecture: abstracted behind this module so the AI backend can be
 * swapped without touching any route or job queue code.
 *
 * Current backend: "composite" — Sharp-based image compositing.
 *   Places the garment image over the model image at a realistic scale.
 *   Suitable for development and demo; swap ENGINE below for production.
 *
 * To plug in a real model later, set ENGINE = 'fashn' | 'idmvton' | etc.
 * and implement the corresponding handler in ENGINES below.
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { generatedPath, generatedUrl } = require('./storage');

const ENGINE = process.env.TRYON_ENGINE || 'composite';

// ---------------------------------------------------------------------------
// Composite engine (dev stub — no external API calls)
// ---------------------------------------------------------------------------
async function compositeEngine(garmentPath, modelPath, settings = {}) {
  const {
    background = 'white',
    resolution = '2K',
    format = 'jpg',
  } = settings;

  const resMap = { '1K': 1024, '2K': 2048, '4K': 3840 };
  const targetWidth = resMap[resolution] || 2048;
  const targetHeight = Math.round(targetWidth * 1.5); // portrait ratio

  // Build background
  const bgColor = background === 'transparent'
    ? { r: 0, g: 0, b: 0, alpha: 0 }
    : { r: 255, g: 255, b: 255, alpha: 1 };

  const canvas = sharp({
    create: { width: targetWidth, height: targetHeight, channels: 4, background: bgColor },
  });

  const composites = [];

  // Place model image if it exists
  if (modelPath && fs.existsSync(modelPath)) {
    const modelBuf = await sharp(modelPath)
      .resize(targetWidth, targetHeight, { fit: 'contain', background: bgColor })
      .png()
      .toBuffer();
    composites.push({ input: modelBuf, top: 0, left: 0 });
  }

  // Place garment at roughly chest/torso position
  if (garmentPath && fs.existsSync(garmentPath)) {
    const garmentW = Math.round(targetWidth * 0.55);
    const garmentBuf = await sharp(garmentPath)
      .resize(garmentW, undefined, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    // Centre horizontally, place at ~20% from top
    const garmentMeta = await sharp(garmentBuf).metadata();
    const left = Math.round((targetWidth - garmentMeta.width) / 2);
    const top = Math.round(targetHeight * 0.20);
    composites.push({ input: garmentBuf, top, left });
  }

  const outputFilename = `${uuidv4()}.${format === 'png' ? 'png' : 'jpg'}`;
  const outputPath = generatedPath(outputFilename);

  const img = canvas.composite(composites);

  if (format === 'png') {
    await img.png().toFile(outputPath);
  } else {
    await img.jpeg({ quality: 90 }).toFile(outputPath);
  }

  const meta = await sharp(outputPath).metadata();

  return {
    filePath: outputPath,
    fileUrl: generatedUrl(outputFilename),
    width: meta.width,
    height: meta.height,
    fileSize: fs.statSync(outputPath).size,
    format: format === 'png' ? 'png' : 'jpg',
    resolution,
    engine: 'composite',
  };
}

// ---------------------------------------------------------------------------
// FASHN API engine stub (plug in real API key + impl when ready)
// ---------------------------------------------------------------------------
async function fashnEngine(garmentPath, modelPath, settings = {}) {
  throw new Error('FASHN engine not yet configured — set FASHN_API_KEY and implement fashnEngine()');
}

// ---------------------------------------------------------------------------
// Engine registry
// ---------------------------------------------------------------------------
const ENGINES = {
  composite: compositeEngine,
  fashn: fashnEngine,
};

/**
 * Generate a try-on image.
 * @param {string} garmentFilePath - absolute path to garment image
 * @param {string} modelFilePath   - absolute path to model image
 * @param {object} settings        - { background, resolution, format, pose }
 * @returns {object}               - { filePath, fileUrl, width, height, fileSize, format, resolution }
 */
async function generate(garmentFilePath, modelFilePath, settings = {}) {
  const engine = ENGINES[ENGINE];
  if (!engine) throw new Error(`Unknown TRYON_ENGINE: ${ENGINE}`);
  return engine(garmentFilePath, modelFilePath, settings);
}

module.exports = { generate };
