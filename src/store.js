const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'sent.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {
    return { seenUrls: [] };
  }
}

function save(db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

module.exports = { load, save };
