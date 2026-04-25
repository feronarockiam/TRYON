const { get } = require('../db');

/**
 * API key authentication middleware.
 * Reads X-API-Key header (or ?api_key query param for convenience).
 * Attaches workspace to req.workspace.
 */
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key) return res.status(401).json({ error: 'Missing API key. Pass X-API-Key header.' });

  const workspace = get('SELECT * FROM workspaces WHERE api_key = ?', [key]);
  if (!workspace) return res.status(401).json({ error: 'Invalid API key.' });

  req.workspace = {
    ...workspace,
    settings: JSON.parse(workspace.settings || '{}'),
  };
  next();
}

/**
 * Optional auth — attaches workspace if key present, but doesn't block.
 * Used for public-facing endpoints like the widget.
 */
function optionalApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key) {
    const workspace = get('SELECT * FROM workspaces WHERE api_key = ?', [key]);
    if (workspace) req.workspace = { ...workspace, settings: JSON.parse(workspace.settings || '{}') };
  }
  next();
}

module.exports = { requireApiKey, optionalApiKey };
