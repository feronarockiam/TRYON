const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../data/tryon.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
  }
  return db;
}

// Helper: run a query and return all rows
function all(sql, params = []) {
  return getDb().prepare(sql).all(...params);
}

// Helper: run a query and return first row
function get(sql, params = []) {
  return getDb().prepare(sql).get(...params);
}

// Helper: run an insert/update/delete
function run(sql, params = []) {
  return getDb().prepare(sql).run(...params);
}

// Helper: run multiple statements in a transaction
function transaction(fn) {
  return getDb().transaction(fn)();
}

module.exports = { getDb, all, get, run, transaction };
