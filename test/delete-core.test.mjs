
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  apply,
  closeLiveSessions,
  collectDeleteTargets,
  deleteSessionResponse,
  detachFromWorkspaces,
  evictLiveSessions,
  findSessionDirectories,
  forgetInRegistry,
  liveSessionIds,
  resolveRoots,
  SESSION_DELETE_PATH,
  SESSION_DELETE_READY_PATH,
} from '../lib/host.js';

const ROOT_ID = 'session-11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const SCOPE_A = '--C-Users-Administrator-Documents-workspace--';
const SCOPE_B = '--C-Users-Administrator-Documents-other--';

async function exists(target) {
  return (await stat(target).catch(() => null)) !== null;
}

async function makeTree() {
  const base = await mkdtemp(path.join(tmpdir(), 'dsh-session-delete-'));
  const sessionsRoot = path.join(base, 'sessions');
  const storagesRoot = path.join(base, 'storages');
  for (const [scope, id] of [[SCOPE_A, ROOT_ID], [SCOPE_B, ROOT_ID], [SCOPE_A, CHILD_ID]]) {
    const dir = path.join(sessionsRoot, scope, id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'session.v4.jsonl.zstd'), 'stub');
  }
  const cacheDir = path.join(storagesRoot, 'session_projcache', 'sessions');
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path.join(cacheDir, `${ROOT_ID}.json`), '{}');
  await writeFile(path.join(cacheDir, `${CHILD_ID}.json`), '{}');
  return { base, sessionsRoot, storagesRoot };
}

function makeStore(live, calls, { detachable = true } = {}) {
  const entries = new Map();
  for (const id of live) {
    entries.set(id, detachable ? {
      detach: () => {
        calls.detached.push(id);
        entries.delete(id);
      },
    } : {});
  }
  return {
    get: (id) => (entries.has(id) ? { id } : undefined),
    liveEntryFor: (session) => entries.get(session.id),
  };
}

function fakeCtx({ live = [], activity = [], descendants = [CHILD_ID], registry, agents, detachable = true } = {}) {
  const calls = { registry: [], disposed: [], detached: [] };
  const store = makeStore(live, calls, { detachable });
  const agentHandles = agents ?? new Map(live.map((id) => [id, {
    dispose: async () => {
      calls.disposed.push(id);

      const entry = store.get(id);
      if (entry !== undefined) store.liveEntryFor(entry)?.detach?.();
    },
  }]));
  const ctx = {
    calls,
    logger: { warn() {}, info() {} },
    get(service) {
      if (service === 'sessionPersistence') return { root: undefined };
      if (service === 'sessions') return store;
      if (service === 'agents') return { get: (id) => agentHandles.get(id) };
      if (service === 'sessionQuery') return { traceSession: async () => ({ descendants: descendants.map((id) => ({ session: { header: { id } } })) }) };
      if (service === 'workspaceRegistry') {
        return registry ?? {
          unpinSession: async (id) => calls.registry.push(['unpin', id]),
          unarchiveSession: async (id) => calls.registry.push(['unarchive', id]),
        };
      }
      return undefined;
    },
    async waterfall(name, payload) {
      assert.equal(name, 'workspace/session-activity');
      assert.equal(payload.sessionId, ROOT_ID);
      return activity;
    },
  };
  return ctx;
}

function fakeRequest(body) {
  return { json: async () => body };
}

const config = (tree) => ({ sessionsRoot: tree.sessionsRoot, storagesRoot: tree.storagesRoot, logFile: false });

{
  const tree = await makeTree();

  const workspace = {
    id: 'ws-1',
    record: { path: 'C:\\work', title: 'work', sessionIds: [ROOT_ID, CHILD_ID, 'session-keep'] },
    detached: [],
    async detachSession(sessionId) {
      this.detached.push(sessionId);
      this.record.sessionIds = this.record.sessionIds.filter((entry) => entry !== sessionId);
    },
  };
  const ctx = fakeCtx({ registry: {
    list: () => [workspace],
    unpinSession: async (id) => ctx.calls.registry.push(['unpin', id]),
    unarchiveSession: async (id) => ctx.calls.registry.push(['unarchive', id]),
  } });
  const response = await deleteSessionResponse(ctx, fakeRequest({ sessionId: ROOT_ID }), config(tree));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.deleted, [ROOT_ID, CHILD_ID]);
  assert.deepEqual(payload.closedLive, []);
  assert.deepEqual(payload.stillLive, []);
  assert.equal(await exists(path.join(tree.sessionsRoot, SCOPE_A, ROOT_ID)), false);
  assert.equal(await exists(path.join(tree.sessionsRoot, SCOPE_B, ROOT_ID)), false);
  assert.equal(await exists(path.join(tree.sessionsRoot, SCOPE_A, CHILD_ID)), false);
  assert.equal(await exists(path.join(tree.storagesRoot, 'session_projcache', 'sessions', `${ROOT_ID}.json`)), false);
  assert.equal(await exists(path.join(tree.storagesRoot, 'session_projcache', 'sessions', `${CHILD_ID}.json`)), false);
  assert.deepEqual(ctx.calls.registry, [
    ['unpin', ROOT_ID], ['unarchive', ROOT_ID],
    ['unpin', CHILD_ID], ['unarchive', CHILD_ID],
  ]);
  assert.deepEqual(workspace.detached, [ROOT_ID, CHILD_ID], 'the workspace membership is rewritten');
  assert.deepEqual(workspace.record.sessionIds, ['session-keep'], 'unrelated members keep their slots');
  assert.deepEqual(payload.detachedWorkspaces, [['ws-1', ROOT_ID], ['ws-1', CHILD_ID]], 'the response reports the dropped memberships');
  await rm(tree.base, { recursive: true, force: true });
  console.log('ok 1 - deletes the session, its descendants, cache records, and registry bookkeeping');
}

{
  const tree = await makeTree();
  const ctx = fakeCtx({ live: [ROOT_ID, CHILD_ID] });
  const response = await deleteSessionResponse(ctx, fakeRequest({ sessionId: ROOT_ID }), config(tree));
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.deepEqual(payload.closedLive, [ROOT_ID, CHILD_ID]);
  assert.deepEqual(payload.evictedLive, []);
  assert.deepEqual(payload.stillLive, []);
  assert.deepEqual(ctx.calls.disposed, [ROOT_ID, CHILD_ID]);
  assert.equal(await exists(path.join(tree.sessionsRoot, SCOPE_A, ROOT_ID)), false);
  assert.equal(await exists(path.join(tree.sessionsRoot, SCOPE_A, CHILD_ID)), false);
  await rm(tree.base, { recursive: true, force: true });
  console.log('ok 2 - disposes the live Agent of an idle session, then deletes its files');
}

{
  const tree = await makeTree();
  const ctx = fakeCtx({ live: [ROOT_ID, CHILD_ID], agents: new Map() });
  const response = await deleteSessionResponse(ctx, fakeRequest({ sessionId: ROOT_ID }), config(tree));
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.deepEqual(payload.closedLive, []);
  assert.deepEqual(payload.evictedLive, [ROOT_ID, CHILD_ID]);
  assert.deepEqual(payload.stillLive, [], 'nothing may stay live, or the Host list keeps returning it');
  assert.deepEqual(ctx.calls.detached, [ROOT_ID, CHILD_ID]);
  assert.equal(await exists(path.join(tree.sessionsRoot, SCOPE_A, ROOT_ID)), false);
  assert.equal(await exists(path.join(tree.sessionsRoot, SCOPE_A, CHILD_ID)), false);
  await rm(tree.base, { recursive: true, force: true });
  console.log('ok 2b - detaches an Agent-less live session so the list can drop it');
}

{
  const tree = await makeTree();
  const ctx = fakeCtx({ live: [ROOT_ID], agents: new Map(), detachable: false });
  const response = await deleteSessionResponse(ctx, fakeRequest({ sessionId: ROOT_ID }), config(tree));
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.deepEqual(payload.evictedLive, []);
  assert.deepEqual(payload.stillLive, [ROOT_ID]);
  assert.equal(await exists(path.join(tree.sessionsRoot, SCOPE_A, ROOT_ID)), false);
  await rm(tree.base, { recursive: true, force: true });
  console.log('ok 2b2 - an un-detachable live entry is reported and its files still go');
}

{
  const tree = await makeTree();
  const agents = new Map([[ROOT_ID, { dispose: async () => { throw new Error('teardown exploded'); } }]]);
  const ctx = fakeCtx({ live: [ROOT_ID], agents });
  const response = await deleteSessionResponse(ctx, fakeRequest({ sessionId: ROOT_ID }), config(tree));
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.deepEqual(payload.closedLive, []);
  assert.deepEqual(payload.evictedLive, [ROOT_ID]);
  assert.deepEqual(payload.stillLive, []);
  assert.equal(await exists(path.join(tree.sessionsRoot, SCOPE_A, ROOT_ID)), false);
  await rm(tree.base, { recursive: true, force: true });
  console.log('ok 2c - a failing Agent disposer still removes the files and the live trace');
}

{
  const tree = await makeTree();
  const activity = [{ kind: 'turn', items: [{ id: ROOT_ID, label: 'turn' }] }];
  const response = await deleteSessionResponse(fakeCtx({ activity }), fakeRequest({ sessionId: ROOT_ID }), config(tree));
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(payload.code, 'session-delete/session-active');
  assert.deepEqual(payload.activity, activity);
  assert.equal(await exists(path.join(tree.sessionsRoot, SCOPE_A, ROOT_ID)), true);
  await rm(tree.base, { recursive: true, force: true });
  console.log('ok 3 - refuses a session with running work and reports the activity');
}

{
  const tree = await makeTree();
  const missing = await deleteSessionResponse(fakeCtx(), fakeRequest({ sessionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }), config(tree));
  assert.equal(missing.status, 404);

  for (const body of [{}, { sessionId: '' }, { sessionId: '../../etc' }, { sessionId: 'a/b' }, { sessionId: 42 }]) {
    const response = await deleteSessionResponse(fakeCtx(), fakeRequest(body), config(tree));
    assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }
  await rm(tree.base, { recursive: true, force: true });
  console.log('ok 4 - rejects unknown ids and traversal-shaped bodies');
}

{
  const tree = await makeTree();
  const response = await deleteSessionResponse(
    fakeCtx(),
    fakeRequest({ sessionId: ROOT_ID }),
    { ...config(tree), deleteDescendants: false },
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(payload.deleted, [ROOT_ID]);
  assert.equal(await exists(path.join(tree.sessionsRoot, SCOPE_A, CHILD_ID)), true);
  await rm(tree.base, { recursive: true, force: true });
  console.log('ok 5 - deleteDescendants:false keeps sub-sessions');
}

{
  const tree = await makeTree();
  const roots = resolveRoots(fakeCtx(), { sessionsRoot: tree.sessionsRoot, storagesRoot: tree.storagesRoot });
  assert.equal(roots.sessionsRoot, tree.sessionsRoot);
  const dirs = await findSessionDirectories(tree.sessionsRoot, ROOT_ID);
  assert.deepEqual(dirs.sort(), [path.join(tree.sessionsRoot, SCOPE_A, ROOT_ID), path.join(tree.sessionsRoot, SCOPE_B, ROOT_ID)].sort());
  assert.deepEqual(await findSessionDirectories(path.join(tree.base, 'nope'), ROOT_ID), []);
  assert.deepEqual(await collectDeleteTargets(fakeCtx(), ROOT_ID), [ROOT_ID, CHILD_ID]);
  assert.deepEqual(liveSessionIds(fakeCtx(), [ROOT_ID]), []);
  assert.deepEqual(liveSessionIds(fakeCtx({ live: [ROOT_ID] }), [ROOT_ID, CHILD_ID]), [ROOT_ID]);
  const noAgents = fakeCtx({ live: [ROOT_ID], agents: new Map() });
  assert.deepEqual(await closeLiveSessions(noAgents, [ROOT_ID]), { closed: [], stillLive: [ROOT_ID] });
  assert.deepEqual(evictLiveSessions(noAgents, [ROOT_ID]), { evicted: [ROOT_ID], remaining: [] });
  assert.deepEqual(liveSessionIds(noAgents, [ROOT_ID]), [], 'the store let go of the evicted session');
  await rm(tree.base, { recursive: true, force: true });
  console.log('ok 6 - path helpers behave on missing roots and multiple scopes');
}

{
  const registrations = [];
  const effectIds = [];
  const ctx = {
    logger: { warn() {} },
    get: (name) => (name === 'connection' ? { fetch: { register: (route) => { registrations.push(route); return () => {}; } } } : undefined),
    effect: (callback, id) => {
      effectIds.push(id);
      callback();
    },
  };
  apply(ctx, { logFile: false });
  assert.equal(registrations.length, 2);
  assert.equal(registrations[0].path, SESSION_DELETE_PATH);
  assert.deepEqual(registrations[0].methods, ['POST']);
  assert.equal(registrations[0].requestBody, 'buffered');
  assert.equal(typeof registrations[0].fetch, 'function');
  assert.equal(registrations[1].path, SESSION_DELETE_READY_PATH);
  assert.deepEqual(registrations[1].methods, ['POST']);
  assert.equal(effectIds[0], 'session-delete: authenticated delete route');
  assert.equal(effectIds[1], 'session-delete: browser-readiness receipt');

  const receipt = await registrations[1].fetch();
  assert.equal(receipt.status, 200);
  console.log('ok 7 - apply() registers the delete route and the browser-readiness receipt');
}

{
  const makeWorkspace = (id, sessionIds, { throwing = false } = {}) => ({
    id,
    record: { path: 'C:\\work\\' + id, title: id, sessionIds: [...sessionIds] },
    detached: [],
    detachCalls: [],
    async detachSession(sessionId) {
      this.detachCalls.push(sessionId);
      if (throwing) throw new Error('domain write refused');
      if (!this.record.sessionIds.includes(sessionId)) return;
      this.record.sessionIds = this.record.sessionIds.filter((entry) => entry !== sessionId);
      this.detached.push(sessionId);
    },
  });

  const accounting = makeWorkspace('ws-accounting', [ROOT_ID, 'session-keep']);
  const childOnly = makeWorkspace('ws-child', [CHILD_ID]);
  const bystander = makeWorkspace('ws-bystander', ['session-keep']);
  const registry = { list: () => [accounting, childOnly, bystander] };

  const dropped = await detachFromWorkspaces(registry, [ROOT_ID, CHILD_ID]);
  assert.deepEqual(dropped, [['ws-accounting', ROOT_ID], ['ws-child', CHILD_ID]]);
  assert.deepEqual(accounting.detached, [ROOT_ID]);
  assert.deepEqual(accounting.record.sessionIds, ['session-keep']);
  assert.deepEqual(childOnly.record.sessionIds, []);
  assert.deepEqual(bystander.detachCalls, [], 'a Workspace that does not account the id is never written');
  console.log('ok 8 - detachFromWorkspaces drops exactly the accounting Workspaces');

  const unpinCalls = [];
  const throwingWorkspace = makeWorkspace('ws-throwing', [ROOT_ID], { throwing: true });
  const ctx = {
    get: (service) => (service === 'workspaceRegistry'
      ? {
        list: () => [makeWorkspace('ws-fresh', [ROOT_ID]), throwingWorkspace],
        unpinSession: async (id) => unpinCalls.push(['unpin', id]),
        unarchiveSession: async (id) => unpinCalls.push(['unarchive', id]),
      }
      : undefined),
  };
  assert.deepEqual(await forgetInRegistry(ctx, [ROOT_ID, CHILD_ID]), [['ws-fresh', ROOT_ID]], 'bookkeeping never throws and reports what it dropped');
  assert.deepEqual(unpinCalls, [
    ['unpin', ROOT_ID], ['unarchive', ROOT_ID],
    ['unpin', CHILD_ID], ['unarchive', CHILD_ID],
  ]);
  assert.deepEqual(throwingWorkspace.detachCalls, [ROOT_ID], 'the refused write was still attempted');

  assert.deepEqual(await detachFromWorkspaces({}, [ROOT_ID]), []);
  assert.deepEqual(await detachFromWorkspaces({ list: () => undefined }, [ROOT_ID]), []);
  assert.deepEqual(await detachFromWorkspaces({ list: () => [{ id: 'ws-nullable', record: {} }] }, [ROOT_ID]), []);
  assert.deepEqual(await detachFromWorkspaces({ list: () => [{ id: 'ws-detachless', record: { sessionIds: [ROOT_ID] } }] }, [ROOT_ID]), []);
  assert.deepEqual(await forgetInRegistry({ get: () => undefined }, [ROOT_ID]), []);
  assert.deepEqual(await forgetInRegistry({ get: () => { throw new Error('no registry'); } }, [ROOT_ID]), []);
  console.log('ok 8b - a refused or absent membership surface degrades to pin/archive only');
}

console.log('\nall delete-core checks passed');
