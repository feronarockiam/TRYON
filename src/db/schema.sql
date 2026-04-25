PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  api_key     TEXT UNIQUE NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'starter',
  credits     INTEGER NOT NULL DEFAULT 200,
  settings    TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS garments (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  name              TEXT,
  sku               TEXT,
  category          TEXT,
  subcategory       TEXT,
  color             TEXT,
  tags              TEXT NOT NULL DEFAULT '[]',
  quality_score     INTEGER NOT NULL DEFAULT 0,
  quality_issues    TEXT NOT NULL DEFAULT '[]',
  ai_analyzed       INTEGER NOT NULL DEFAULT 0,
  ai_description    TEXT,
  status            TEXT NOT NULL DEFAULT 'draft',
  file_path         TEXT NOT NULL,
  file_url          TEXT,
  original_filename TEXT,
  file_size         INTEGER,
  width             INTEGER,
  height            INTEGER,
  collection        TEXT,
  season            TEXT,
  metadata          TEXT NOT NULL DEFAULT '{}',
  deleted_at        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX IF NOT EXISTS idx_garments_workspace ON garments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_garments_status ON garments(status);
CREATE INDEX IF NOT EXISTS idx_garments_sku ON garments(sku);

CREATE TABLE IF NOT EXISTS ai_models (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  gender        TEXT,
  body_type     TEXT,
  skin_tone     TEXT,
  ethnicity     TEXT,
  age_range     TEXT,
  height_cm     INTEGER,
  size_label    TEXT,
  poses         TEXT NOT NULL DEFAULT '[]',
  file_paths    TEXT NOT NULL DEFAULT '{}',
  file_urls     TEXT NOT NULL DEFAULT '{}',
  tags          TEXT NOT NULL DEFAULT '[]',
  is_active     INTEGER NOT NULL DEFAULT 1,
  is_custom     INTEGER NOT NULL DEFAULT 0,
  workspace_id  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  name            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  type            TEXT NOT NULL DEFAULT 'bulk',
  total_items     INTEGER NOT NULL DEFAULT 0,
  completed_items INTEGER NOT NULL DEFAULT 0,
  failed_items    INTEGER NOT NULL DEFAULT 0,
  settings        TEXT NOT NULL DEFAULT '{}',
  progress        INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at    TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_workspace ON jobs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

CREATE TABLE IF NOT EXISTS job_items (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL,
  garment_id  TEXT NOT NULL,
  model_id    TEXT NOT NULL,
  pose        TEXT NOT NULL DEFAULT 'front',
  status      TEXT NOT NULL DEFAULT 'pending',
  asset_id    TEXT,
  error       TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (garment_id) REFERENCES garments(id),
  FOREIGN KEY (model_id) REFERENCES ai_models(id)
);

CREATE INDEX IF NOT EXISTS idx_job_items_job ON job_items(job_id);
CREATE INDEX IF NOT EXISTS idx_job_items_status ON job_items(status);

CREATE TABLE IF NOT EXISTS assets (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  garment_id    TEXT,
  model_id      TEXT,
  job_item_id   TEXT,
  type          TEXT NOT NULL DEFAULT 'tryon',
  status        TEXT NOT NULL DEFAULT 'draft',
  file_path     TEXT NOT NULL,
  file_url      TEXT,
  resolution    TEXT,
  format        TEXT,
  width         INTEGER,
  height        INTEGER,
  file_size     INTEGER,
  settings      TEXT NOT NULL DEFAULT '{}',
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX IF NOT EXISTS idx_assets_workspace ON assets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_assets_garment ON assets(garment_id);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
