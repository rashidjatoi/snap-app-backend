const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'db.json');

const defaultDb = () => ({
  users: [],
  snaps: [],
  comments: [],
  reports: [],
  payments: [],
  coupons: [],
  subscriptions: [],
  notifications: [],
  tickets: [],
  announcements: [],
  sessions: [],
});

function load() {
  if (!fs.existsSync(DATA_FILE)) {
    const db = defaultDb();
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    return db;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function save(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function withDb(mutator) {
  const db = load();
  const result = mutator(db);
  save(db);
  return result;
}

module.exports = { load, save, withDb, DATA_FILE, defaultDb };
