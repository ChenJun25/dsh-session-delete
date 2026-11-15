
import { appendFile, readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const name = 'session-delete';

export const inject = ['connection'];

export const SESSION_DELETE_PATH = '/api/session.delete';

export const SESSION_DELETE_READY_PATH = '/api/session.delete/ready';

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

const VERSION = 6;

function resolveHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return path.resolve(fromEnv);
  return path.join(homedir(), '.dsh');
}

export function resolveRoots(ctx, config = {}) {
  const home = resolveHome();
  const configuredSessions = config.sessionsRoot;
  const sessionsRoot = typeof configuredSessions === 'string' && configuredSessions.length > 0
    ? path.resolve(configuredSessions)
    : sessionPersistenceRoot(ctx) ?? path.join(home, 'sessions');
  const configuredStorages = config.storagesRoot;
  const storagesRoot = typeof configuredStorages === 'string' && configuredStorages.length > 0
    ? path.resolve(configuredStorages)
    : path.join(home, 'storages');
  return { sessionsRoot, storagesRoot };
}

function sessionPersistenceRoot(ctx) {
  try {
    const persistence = ctx.get('sessionPersistence');
    const root = persistence?.root;
    return typeof root === 'string' && root.length > 0 ? path.resolve(root) : undefined;
  } catch {
    return undefined;
  }
}

export async function findSessionDirectories(sessionsRoot, sessionId) {
  const found = [];
  let scopes;
  try {
    scopes = await readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of scopes) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(sessionsRoot, entry.name, sessionId);
    const info = await stat(candidate).catch(() => null);
    if (info?.isDirectory() === true) found.push(candidate);
  }
  return found;
}

export async function removeProjectionCache(storagesRoot, sessionId) {
  const removed = [];
  const target = `${sessionId}.json`;
  const walk = async (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (entry.name !== target) continue;
      await rm(full, { force: true });
      removed.push(full);
    }
  };
  await walk(path.join(storagesRoot, 'session_projcache'), 0);
  return removed;
}

export async function collectDeleteTargets(ctx, sessionId) {
  const ids = [sessionId];
  let query;
  try {
    query = ctx.get('sessionQuery');
  } catch {
    return ids;
  }
  if (query === undefined || typeof query.traceSession !== 'function') return ids;
  try {
    const lineage = await query.traceSession(sessionId);
    for (const node of lineage?.descendants ?? []) {
      const id = node?.session?.header?.id;
      if (typeof id === 'string' && id.length > 0 && !ids.includes(id)) ids.push(id);
    }
  } catch {

  }
  return ids;
}

export function liveSessionIds(ctx, ids) {
  let sessions;
  try {
    sessions = ctx.get('sessions');
  } catch {
    return [];
  }
  if (sessions === undefined || typeof sessions.get !== 'function') return [];
  const live = [];
  for (const id of ids) {
    try {
      if (sessions.get(id) !== undefined) live.push(id);
    } catch {

    }
  }
  return live;
}

export async function closeLiveSessions(ctx, ids) {
  const live = liveSessionIds(ctx, ids);
  const closed = [];
  const stillLive = [];
  if (live.length === 0) return { closed, stillLive };
  let agents;
  try {
    agents = ctx.get('agents');
  } catch {
    agents = undefined;
  }
  for (const id of live) {
    const agent = agents !== undefined && typeof agents.get === 'function'
      ? (() => {
        try {
          return agents.get(id);
        } catch {
          return undefined;
        }
      })()
      : undefined;
    if (agent === undefined || typeof agent.dispose !== 'function') {
      stillLive.push(id);
      continue;
    }
    try {
      await agent.dispose();
      closed.push(id);
    } catch {
      stillLive.push(id);
    }
  }
  return { closed, stillLive };
}

export function evictLiveSessions(ctx, ids) {
  const evicted = [];
  const remaining = [];
  if (ids.length === 0) return { evicted, remaining };
  let sessions;
  try {
    sessions = ctx.get('sessions');
  } catch {
    sessions = undefined;
  }
  if (sessions === undefined || typeof sessions.get !== 'function') {
    return { evicted, remaining: [...ids] };
  }
  for (const id of ids) {
    let session;
    try {
      session = sessions.get(id);
    } catch {
      session = undefined;
    }
    if (session === undefined) continue;
    let entry;
    try {
      entry = typeof sessions.liveEntryFor === 'function'
        ? sessions.liveEntryFor(session)
        : sessions.store?.get?.(id);
    } catch {
      entry = undefined;
    }
    if (entry === undefined || typeof entry.detach !== 'function') {
      remaining.push(id);
      continue;
    }
    try {
      entry.detach();

      const stillLive = sessions.get(id) !== undefined;
      if (stillLive) remaining.push(id);
      else evicted.push(id);
    } catch {
      remaining.push(id);
    }
  }
  return { evicted, remaining };
}

export async function sessionActivity(ctx, sessionId) {
  try {
    return await ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]));
  } catch {
    return [];
  }
}

export async function forgetInRegistry(ctx, ids) {
  let registry;
  try {
    registry = ctx.get('workspaceRegistry');
  } catch {
    return [];
  }
  if (registry === undefined) return [];
  for (const id of ids) {
    for (const method of ['unpinSession', 'unarchiveSession']) {
      const call = registry[method];
      if (typeof call !== 'function') continue;
      try {
        await call.call(registry, id);
      } catch {

      }
    }
  }
  return detachFromWorkspaces(registry, ids);
}

export async function detachFromWorkspaces(registry, ids) {
  const dropped = [];
  let workspaces;
  try {
    workspaces = registry.list();
  } catch {
    return dropped;
  }
  if (!Array.isArray(workspaces)) return dropped;
  for (const workspace of workspaces) {
    const detach = workspace?.detachSession;
    if (typeof detach !== 'function') continue;
    const accounted = workspace.record?.sessionIds;
    if (!Array.isArray(accounted)) continue;
    for (const id of ids) {
      if (!accounted.includes(id)) continue;
      try {
        await detach.call(workspace, id);
        dropped.push([workspace.id, id]);
      } catch {

      }
    }
  }
  return dropped;
}

function auditLog(config) {
  if (config.logFile === false) return undefined;
  const target = typeof config.logFile === 'string' && config.logFile.length > 0
    ? path.resolve(config.logFile)
    : path.join(resolveHome(), 'session-delete.log');
  return (message) => {
    void appendFile(target, `${new Date().toISOString()} ${message}\n`).catch(() => {});
  };
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function readSessionId(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return undefined;
  }
  const sessionId = payload?.sessionId;
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) return undefined;
  return sessionId;
}

export async function deleteSessionResponse(ctx, request, config = {}) {
  const log = auditLog(config);
  const sessionId = await readSessionId(request);
  if (sessionId === undefined) {
    return jsonResponse(400, {
      ok: false,
      code: 'session-delete/bad-request',
      message: 'Body must be {"sessionId":"<id>"} with a host-minted session id.',
    });
  }

  const roots = resolveRoots(ctx, config);
  const directories = await findSessionDirectories(roots.sessionsRoot, sessionId);
  const targets = config.deleteDescendants === false
    ? [sessionId]
    : await collectDeleteTargets(ctx, sessionId);
  const live = liveSessionIds(ctx, targets);
  if (directories.length === 0 && live.length === 0) {
    log?.(`refused not-found session=${sessionId}`);
    return jsonResponse(404, {
      ok: false,
      code: 'session-delete/not-found',
      message: `No stored Session log for "${sessionId}".`,
    });
  }

  const activity = await sessionActivity(ctx, sessionId);
  if (activity.length > 0) {
    log?.(`refused active session=${sessionId} families=${activity.map((entry) => entry?.kind ?? '?').join(',')}`);
    return jsonResponse(409, {
      ok: false,
      code: 'session-delete/session-active',
      message: `Session "${sessionId}" still has running work. Stop it first, then delete.`,
      activity,
    });
  }

  const { closed, stillLive } = await closeLiveSessions(ctx, targets);
  const { evicted, remaining } = config.evictLive === false
    ? { evicted: [], remaining: stillLive }
    : evictLiveSessions(ctx, stillLive);

  const deletedDirectories = [];
  const removedCache = [];
  for (const id of targets) {
    for (const dir of await findSessionDirectories(roots.sessionsRoot, id)) {
      await rm(dir, { recursive: true, force: true });
      deletedDirectories.push(dir);
    }
    removedCache.push(...await removeProjectionCache(roots.storagesRoot, id));
  }

  const dropped = await forgetInRegistry(ctx, targets);
  const stillThere = liveSessionIds(ctx, targets);
  const droppedLabel = dropped.map(([workspaceId, id]) => `${workspaceId}:${id}`).join('|') || '-';
  log?.(
    `deleted session=${sessionId} sessions=${targets.length} directories=${deletedDirectories.length} cache=${removedCache.length}`
    + ` closedAgent=${closed.join('|') || '-'} evictedLive=${evicted.join('|') || '-'}`
    + ` detachedWorkspace=${droppedLabel} liveAfter=${stillThere.join('|') || '-'}`,
  );

  return jsonResponse(200, {
    ok: true,
    deleted: targets,
    directories: deletedDirectories,
    cacheRecords: removedCache,
    closedLive: closed,
    evictedLive: evicted,
    stillLive: stillThere,
    detachedWorkspaces: dropped,
  });
}

export function apply(ctx, config = {}) {
  const connection = ctx.get('connection');
  if (connection === undefined) {
    ctx.logger?.warn?.('session-delete: no connection service; the delete route is unavailable');
    return;
  }
  auditLog(config)?.(`plugin activated v${VERSION} routes=${SESSION_DELETE_PATH},${SESSION_DELETE_READY_PATH}`);
  ctx.effect(() => connection.fetch.register({
    path: SESSION_DELETE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        return await deleteSessionResponse(ctx, request, config);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.logger?.warn?.(`session-delete: ${message}`);
        return jsonResponse(500, { ok: false, code: 'session-delete/internal', message });
      }
    },
  }), 'session-delete: authenticated delete route');
  ctx.effect(() => connection.fetch.register({
    path: SESSION_DELETE_READY_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async () => {
      auditLog(config)?.('browser plugin applied');
      return jsonResponse(200, { ok: true });
    },
  }), 'session-delete: browser-readiness receipt');
}
