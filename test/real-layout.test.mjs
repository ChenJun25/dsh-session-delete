
import assert from 'node:assert/strict';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { deleteSessionResponse, resolveRoots } from '../lib/host.js';

const HOME = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
  ? path.resolve(process.env.DSH_HOME)
  : path.join(homedir(), '.dsh');
const SESSIONS = path.join(HOME, 'sessions');
const STORAGES = path.join(HOME, 'storages');
const SCOPE = '--C-Users-Administrator-Documents-dsh-session-delete-selftest--';
const ID = 'session-delete-selftest-0000';

async function listSessions() {
  const scopes = await readdir(SESSIONS, { withFileTypes: true }).catch(() => []);
  const found = [];
  for (const scope of scopes) {
    if (!scope.isDirectory()) continue;
    const ids = await readdir(path.join(SESSIONS, scope.name), { withFileTypes: true }).catch(() => []);
    for (const entry of ids) if (entry.isDirectory()) found.push(`${scope.name}/${entry.name}`);
  }
  return found.sort();
}

const ctx = {
  logger: { warn() {} },
  get: () => undefined,
  waterfall: async () => [],
};

const before = await listSessions();
const sessionDir = path.join(SESSIONS, SCOPE, ID);
const cacheFile = path.join(STORAGES, 'session_projcache', 'sessions', `${ID}.json`);
const cacheDirExisted = (await stat(path.dirname(cacheFile)).catch(() => null)) !== null;

try {
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, 'session.v4.jsonl.zstd'), 'selftest');
  await mkdir(path.dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, '{}');

  const roots = resolveRoots(ctx);
  assert.equal(roots.sessionsRoot, SESSIONS);
  assert.equal(roots.storagesRoot, STORAGES);
  console.log(`ok 1 - resolveRoots() matched the real home layout (${HOME})`);

  const response = await deleteSessionResponse(ctx, { json: async () => ({ sessionId: ID }) }, { logFile: false });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.deepEqual(payload.deleted, [ID]);
  assert.equal(await stat(sessionDir).catch(() => null), null, 'the synthetic Session directory is gone');
  assert.equal(await stat(cacheFile).catch(() => null), null, 'the synthetic cache record is gone');
  console.log('ok 2 - deleted the synthetic Session directory and its projection-cache record');

  const after = await listSessions();
  assert.deepEqual(after, before, 'no other stored Session changed');
  console.log(`ok 3 - every other stored Session is untouched (${before.length} before, ${after.length} after)`);
} finally {
  await rm(path.join(SESSIONS, SCOPE), { recursive: true, force: true });
  await rm(cacheFile, { force: true });
  if (!cacheDirExisted) await rm(path.dirname(cacheFile), { recursive: true, force: true });
}

console.log('\nreal-layout checks passed');
