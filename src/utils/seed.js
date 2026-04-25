/**
 * Seeds the platform with:
 *  1. A default workspace + API key
 *  2. A diverse AI model catalog (no real images needed for dev — uses placeholder paths)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { v4: uuidv4 } = require('uuid');
const { getDb, run, get } = require('../db');
const { init: initStorage } = require('../services/storage');

initStorage();
getDb(); // initialises schema

// ---------------------------------------------------------------------------
// Default workspace
// ---------------------------------------------------------------------------
const existing = get(`SELECT * FROM workspaces WHERE slug = 'default'`);
let apiKey;

if (existing) {
  apiKey = existing.api_key;
  console.log(`✓ Default workspace already exists`);
} else {
  apiKey = `tryon_${uuidv4().replace(/-/g, '')}`;
  run(
    `INSERT INTO workspaces (id, name, slug, api_key, plan, credits) VALUES (?, ?, ?, ?, ?, ?)`,
    [uuidv4(), 'Default Workspace', 'default', apiKey, 'scale', 10000]
  );
  console.log(`✓ Created default workspace`);
}

console.log(`\n  API Key: ${apiKey}\n`);

// ---------------------------------------------------------------------------
// AI Model catalog — 12 diverse models
// ---------------------------------------------------------------------------
const models = [
  {
    name: 'Aria',
    gender: 'feminine', body_type: 'slim', skin_tone: '2', ethnicity: 'East Asian',
    age_range: '18-25', height_cm: 172, size_label: 'XS',
    poses: ['front', 'back', 'side'], tags: ['editorial', 'minimalist'],
  },
  {
    name: 'Zara',
    gender: 'feminine', body_type: 'regular', skin_tone: '4', ethnicity: 'South Asian',
    age_range: '26-35', height_cm: 165, size_label: 'S',
    poses: ['front', 'back', 'lifestyle'], tags: ['casual', 'urban'],
  },
  {
    name: 'Jade',
    gender: 'feminine', body_type: 'curvy', skin_tone: '6', ethnicity: 'African American',
    age_range: '26-35', height_cm: 168, size_label: 'M',
    poses: ['front', 'back', 'side', 'lifestyle'], tags: ['bold', 'streetwear'],
  },
  {
    name: 'Luna',
    gender: 'feminine', body_type: 'plus', skin_tone: '3', ethnicity: 'Latina',
    age_range: '26-35', height_cm: 163, size_label: 'XL',
    poses: ['front', 'back', 'lifestyle'], tags: ['inclusive', 'casual'],
  },
  {
    name: 'Mira',
    gender: 'feminine', body_type: 'petite', skin_tone: '1', ethnicity: 'European',
    age_range: '18-25', height_cm: 155, size_label: 'XS',
    poses: ['front', 'back'], tags: ['petite', 'elegant'],
  },
  {
    name: 'Nadia',
    gender: 'feminine', body_type: 'regular', skin_tone: '5', ethnicity: 'Middle Eastern',
    age_range: '36-50', height_cm: 167, size_label: 'M',
    poses: ['front', 'back', 'lifestyle'], tags: ['mature', 'professional'],
  },
  {
    name: 'Kai',
    gender: 'masculine', body_type: 'slim', skin_tone: '3', ethnicity: 'East Asian',
    age_range: '18-25', height_cm: 180, size_label: 'S',
    poses: ['front', 'back', 'side'], tags: ['streetwear', 'athletic'],
  },
  {
    name: 'Marcus',
    gender: 'masculine', body_type: 'regular', skin_tone: '7', ethnicity: 'African American',
    age_range: '26-35', height_cm: 183, size_label: 'L',
    poses: ['front', 'back', 'lifestyle'], tags: ['casual', 'bold'],
  },
  {
    name: 'Leo',
    gender: 'masculine', body_type: 'regular', skin_tone: '2', ethnicity: 'European',
    age_range: '26-35', height_cm: 178, size_label: 'M',
    poses: ['front', 'back', 'side', 'lifestyle'], tags: ['classic', 'professional'],
  },
  {
    name: 'Ravi',
    gender: 'masculine', body_type: 'slim', skin_tone: '5', ethnicity: 'South Asian',
    age_range: '26-35', height_cm: 175, size_label: 'M',
    poses: ['front', 'back'], tags: ['casual', 'minimal'],
  },
  {
    name: 'Sam',
    gender: 'androgynous', body_type: 'slim', skin_tone: '3', ethnicity: 'Mixed',
    age_range: '18-25', height_cm: 173, size_label: 'S',
    poses: ['front', 'back', 'side'], tags: ['gender-neutral', 'editorial'],
  },
  {
    name: 'Grace',
    gender: 'feminine', body_type: 'plus', skin_tone: '8', ethnicity: 'African American',
    age_range: '36-50', height_cm: 170, size_label: 'XXL',
    poses: ['front', 'back', 'lifestyle'], tags: ['inclusive', 'mature'],
  },
];

let created = 0;
for (const m of models) {
  const exists = get(`SELECT id FROM ai_models WHERE name = ? AND is_custom = 0`, [m.name]);
  if (exists) continue;

  // In production these paths would be real model photos.
  // For dev, we point to placeholder paths — the composite engine handles missing files gracefully.
  const filePaths = {};
  const fileUrls = {};
  for (const pose of m.poses) {
    filePaths[pose] = `uploads/models/placeholder_${m.name.toLowerCase()}_${pose}.jpg`;
    fileUrls[pose] = `http://localhost:3000/static/uploads/models/placeholder_${m.name.toLowerCase()}_${pose}.jpg`;
  }

  run(
    `INSERT INTO ai_models (id, name, gender, body_type, skin_tone, ethnicity, age_range, height_cm, size_label, poses, file_paths, file_urls, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(), m.name, m.gender, m.body_type, m.skin_tone, m.ethnicity,
      m.age_range, m.height_cm, m.size_label,
      JSON.stringify(m.poses),
      JSON.stringify(filePaths),
      JSON.stringify(fileUrls),
      JSON.stringify(m.tags),
    ]
  );
  created++;
}

console.log(`✓ Seeded ${created} new AI models (${models.length - created} already existed)`);
console.log(`\n────────────────────────────────────────`);
console.log(`  Run the server: npm run dev`);
console.log(`  Health check:   curl http://localhost:3000/health`);
console.log(`  API Key:        ${apiKey}`);
console.log(`────────────────────────────────────────\n`);
