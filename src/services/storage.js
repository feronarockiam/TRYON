const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function localUrl(relativePath) {
  return `${BASE_URL}/static/${relativePath.replace(/\\/g, '/')}`;
}

function garmentPath(filename) {
  return path.join(ROOT, 'uploads/garments', filename);
}

function modelPath(filename) {
  return path.join(ROOT, 'uploads/models', filename);
}

function generatedPath(filename) {
  return path.join(ROOT, 'generated/tryon', filename);
}

function garmentUrl(filename) {
  return localUrl(`uploads/garments/${filename}`);
}

function modelUrl(filename) {
  return localUrl(`uploads/models/${filename}`);
}

function generatedUrl(filename) {
  return localUrl(`generated/tryon/${filename}`);
}

function deleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // best effort
  }
}

function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

// Initialise all storage directories on startup
function init() {
  ensureDir(path.join(ROOT, 'uploads/garments'));
  ensureDir(path.join(ROOT, 'uploads/models'));
  ensureDir(path.join(ROOT, 'generated/tryon'));
  ensureDir(path.join(ROOT, 'data'));
}

module.exports = {
  init,
  ROOT,
  BASE_URL,
  garmentPath,
  modelPath,
  generatedPath,
  garmentUrl,
  modelUrl,
  generatedUrl,
  deleteFile,
  getFileSize,
};
