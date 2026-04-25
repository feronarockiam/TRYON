const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { garmentPath, modelPath } = require('../services/storage');

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_MB = 20;

function imageFilter(req, file, cb) {
  if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
  else cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: JPG, PNG, WebP`));
}

const garmentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.dirname(garmentPath('x'))),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  fileFilter: imageFilter,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
});

const modelUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.dirname(modelPath('x'))),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  fileFilter: imageFilter,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
});

// For bulk ZIP uploads
const zipUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, '/tmp'),
    filename: (req, file, cb) => cb(null, `${uuidv4()}.zip`),
  }),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) cb(null, true);
    else cb(new Error('Only ZIP files allowed for bulk upload'));
  },
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

module.exports = { garmentUpload, modelUpload, zipUpload };
