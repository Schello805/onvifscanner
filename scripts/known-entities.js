const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(process.cwd(), 'data');
const ENTITIES_FILE = path.join(DATA_DIR, 'known-entities.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function normalizeIdentifier(val) {
  return String(val || '')
    .toUpperCase()
    .replace(/[^A-Z0-9ÄÖÜ]/g, '');
}

function loadKnownEntities() {
  ensureDataDir();
  try {
    if (fs.existsSync(ENTITIES_FILE)) {
      const content = fs.readFileSync(ENTITIES_FILE, 'utf8');
      const data = JSON.parse(content);
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.error('[KnownEntities] Error reading known-entities.json:', err.message);
  }
  return [];
}

function saveKnownEntities(entities) {
  ensureDataDir();
  try {
    fs.writeFileSync(ENTITIES_FILE, JSON.stringify(entities, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[KnownEntities] Error writing known-entities.json:', err.message);
    return false;
  }
}

function addKnownEntity({ type = 'plate', identifier, name, category = 'family', notes = '', notify = true }) {
  if (!identifier || !name) {
    throw new Error('Identifier und Name sind erforderlich.');
  }
  const entities = loadKnownEntities();
  const normalized = normalizeIdentifier(identifier);

  const existingIndex = entities.findIndex(
    (e) => e.type === type && normalizeIdentifier(e.identifier) === normalized
  );

  const entity = {
    id: existingIndex >= 0 ? entities[existingIndex].id : crypto.randomUUID(),
    type,
    identifier: identifier.trim().toUpperCase(),
    normalizedIdentifier: normalized,
    name: name.trim(),
    category, // 'family' | 'guest' | 'service' | 'suspicious'
    notes: notes.trim(),
    notify: Boolean(notify),
    createdAt: existingIndex >= 0 ? entities[existingIndex].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastSeen: existingIndex >= 0 ? entities[existingIndex].lastSeen : null,
    lastCamera: existingIndex >= 0 ? entities[existingIndex].lastCamera : null,
  };

  if (existingIndex >= 0) {
    entities[existingIndex] = entity;
  } else {
    entities.push(entity);
  }

  saveKnownEntities(entities);
  return entity;
}

function updateKnownEntity(id, updates) {
  const entities = loadKnownEntities();
  const index = entities.findIndex((e) => e.id === id);
  if (index === -1) return null;

  const current = entities[index];
  const updated = {
    ...current,
    ...updates,
    id: current.id,
    updatedAt: new Date().toISOString(),
  };

  if (updates.identifier) {
    updated.identifier = updates.identifier.trim().toUpperCase();
    updated.normalizedIdentifier = normalizeIdentifier(updates.identifier);
  }

  entities[index] = updated;
  saveKnownEntities(entities);
  return updated;
}

function deleteKnownEntity(id) {
  const entities = loadKnownEntities();
  const filtered = entities.filter((e) => e.id !== id);
  if (filtered.length !== entities.length) {
    saveKnownEntities(filtered);
    return true;
  }
  return false;
}

function findKnownEntity(identifier, type = 'plate') {
  if (!identifier) return null;
  const normalized = normalizeIdentifier(identifier);
  if (!normalized) return null;

  const entities = loadKnownEntities();
  return (
    entities.find((e) => e.type === type && e.normalizedIdentifier === normalized) || null
  );
}

function touchKnownEntity(id, cameraName) {
  const entities = loadKnownEntities();
  const index = entities.findIndex((e) => e.id === id);
  if (index === -1) return null;

  entities[index].lastSeen = new Date().toISOString();
  entities[index].lastCamera = cameraName || null;
  saveKnownEntities(entities);
  return entities[index];
}

module.exports = {
  loadKnownEntities,
  saveKnownEntities,
  addKnownEntity,
  updateKnownEntity,
  deleteKnownEntity,
  findKnownEntity,
  touchKnownEntity,
  normalizeIdentifier,
};
