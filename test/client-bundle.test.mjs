
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(here, '..', 'lib', 'client.js');

const modules = {
  react: {
    useState: (initial) => [initial, () => {}],
    Fragment: Symbol('Fragment'),
    createElement: () => null,
  },
  'react/jsx-runtime': {
    jsx: (type, props, key) => ({ type, props, key }),
    jsxs: (type, props, key) => ({ type, props, key }),
    Fragment: Symbol('Fragment'),
  },
  '@deepseek-ai/dsh-client-ui-primitives': {
    Button: () => null,
    IconCheckCircleFillRegular: () => null,
    IconCheckCircleOutlineRegular: () => null,
    IconTrashOutlineRegular: () => null,
    MenuItemButton: () => null,
    Modal: () => null,
  },
  '@deepseek-ai/dsh-client-store': {
    createSnapshotStore: (initial) => {
      let value = initial;
      const listeners = new Set();
      return {
        getSnapshot: () => value,
        set: (next) => {
          value = next;
          for (const listener of listeners) listener();
        },
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    },
  },
};

let definition;
const requested = [];
const fetches = [];
globalThis.fetch = async (url, init) => {
  fetches.push([url, init?.method]);
  return { ok: true };
};
globalThis.window = {
  __ModuleLoader__: {
    load: (value) => {
      definition = value;
    },
  },
};
const requireShim = (specifier) => {
  requested.push(specifier);
  if (specifier in modules) return modules[specifier];
  throw new Error(`unexpected module request: ${specifier}`);
};

await import(new URL(`file://${bundlePath.replaceAll('\\', '/')}`).href);

assert.ok(definition, 'bundle registered through window.__ModuleLoader__');
assert.equal(definition.id, 'dsh-session-delete');
assert.equal(typeof definition.factory, 'function');
console.log('ok 1 - bundle registers a factory under its package id');

const client = definition.factory(requireShim);
assert.equal(typeof client.apply, 'function');
assert.deepEqual(client.inject, ['slots', 'locale']);
for (const specifier of requested) {
  assert.ok(specifier in modules, `only seeded modules are requested (${specifier})`);
}
console.log(`ok 2 - resolves only seeded modules (${requested.join(', ')})`);

const registrations = [];
const dictionaries = [];
const injects = [];
const ctx = {
  effect: (callback) => {
    callback();
    return () => {};
  },
  locale: {
    register: (namespace, dictionariesByLocale) => {
      dictionaries.push({ namespace, dictionariesByLocale });
      return () => {};
    },
  },
  slots: {
    inject: (key, callback) => {
      injects.push(key);
      callback();
      return () => {};
    },
    register: (options, component) => {
      registrations.push({ options, component });
      return () => {};
    },
  },
  get: () => undefined,
};

client.apply(ctx);

assert.deepEqual(injects, [
  'sidebar.workspaces.session.menu.item',
  'sidebar.workspaces.session.menu.item',
  'sidebar.session.row.leading',
  'shell.overlay',
  'shell.overlay',
]);
assert.equal(registrations.length, 5);

const [menu, batchMenu, rowMark, dialog, batchOverlay] = registrations;
assert.equal(menu.options.name, 'sidebar.workspaces.session.menu.item');
assert.equal(menu.options.id, 'session-delete');
assert.equal(menu.options.order, 500);
assert.equal(typeof menu.component, 'function');
assert.equal(batchMenu.options.name, 'sidebar.workspaces.session.menu.item');
assert.equal(batchMenu.options.id, 'session-delete-batch');
assert.equal(typeof batchMenu.component, 'function');
assert.equal(rowMark.options.name, 'sidebar.session.row.leading');
assert.equal(rowMark.options.id, 'session-delete-batch-mark');
assert.equal(typeof rowMark.component, 'function');
assert.equal(dialog.options.name, 'shell.overlay');
assert.equal(dialog.options.id, 'session-delete-confirm');
assert.equal(typeof dialog.component, 'function');
assert.equal(batchOverlay.options.name, 'shell.overlay');
assert.equal(batchOverlay.options.id, 'session-delete-batch-overlay');
assert.equal(typeof batchOverlay.component, 'function');
console.log('ok 3 - registers the menu rows, the row-leading mark, and the two overlay seats');

const menuFace = menu.options.inject();
assert.equal(typeof menuFace.requestDeleteSession, 'function');
const dialogFace = dialog.options.inject();
assert.equal(typeof dialogFace.deleteSession, 'function');
assert.equal(typeof dialogFace.settleDeleteRequest, 'function');
assert.ok(dialogFace.hooks.deleteRequest, 'the dialog reads its pending request from a store');
menuFace.requestDeleteSession({ sessionId: 'abc', displayTitle: 'Demo' });
assert.deepEqual(dialogFace.hooks.deleteRequest.getSnapshot(), { sessionId: 'abc', displayTitle: 'Demo' });
dialogFace.settleDeleteRequest();
assert.equal(dialogFace.hooks.deleteRequest.getSnapshot(), null);
console.log('ok 4 - the menu row opens and settles one confirmation request');

const batchMenuFace = batchMenu.options.inject();
assert.equal(typeof batchMenuFace.enterBatchDelete, 'function');
const rowMarkFace = rowMark.options.inject();
assert.equal(typeof rowMarkFace.toggleBatchSelection, 'function');
assert.ok(rowMarkFace.hooks.batch, 'the row mark reads the batch store');
const batchOverlayFace = batchOverlay.options.inject();
assert.equal(typeof batchOverlayFace.setBatchSelection, 'function');
assert.equal(typeof batchOverlayFace.requestBatchRun, 'function');
assert.equal(typeof batchOverlayFace.settleBatchRun, 'function');
assert.equal(typeof batchOverlayFace.exitBatchDelete, 'function');
assert.equal(typeof batchOverlayFace.deleteSession, 'function');
assert.equal(typeof batchOverlayFace.allSessionIds, 'function');
assert.deepEqual(batchOverlayFace.allSessionIds(), []);

batchMenuFace.enterBatchDelete();
assert.deepEqual(rowMarkFace.hooks.batch.getSnapshot(), { selected: {}, run: null });
rowMarkFace.toggleBatchSelection('s1');
rowMarkFace.toggleBatchSelection('s2');
rowMarkFace.toggleBatchSelection('s1');
assert.deepEqual(batchOverlayFace.hooks.batch.getSnapshot().selected, { s2: true });
batchOverlayFace.setBatchSelection(['a', 'b']);
assert.deepEqual(batchOverlayFace.hooks.batch.getSnapshot().selected, { a: true, b: true });
batchOverlayFace.requestBatchRun(['a', 'b']);
assert.deepEqual(batchOverlayFace.hooks.batch.getSnapshot().run, { sessionIds: ['a', 'b'] });
batchOverlayFace.settleBatchRun();
assert.deepEqual(batchOverlayFace.hooks.batch.getSnapshot(), { selected: {}, run: null });
batchOverlayFace.exitBatchDelete();
assert.equal(batchOverlayFace.hooks.batch.getSnapshot(), null);
console.log('ok 4b - the batch seats toggle, select, run, and settle through one store');

assert.equal(dictionaries.length, 1);
assert.equal(dictionaries[0].namespace, 'session-delete');
assert.ok(dictionaries[0].dictionariesByLocale.zh['menu.deleteSession']);
assert.ok(dictionaries[0].dictionariesByLocale.en['menu.deleteSession']);
assert.ok(dictionaries[0].dictionariesByLocale.zh['batch.menu']);
assert.ok(dictionaries[0].dictionariesByLocale.en['batch.menu']);
assert.deepEqual(menu.options.locale, 'session-delete');
console.log('ok 5 - registers zh/en dictionaries under its own locale namespace');

assert.deepEqual(fetches, [['api/session.delete/ready', 'POST']]);
console.log('ok 6 - posts the host-readiness receipt through the document-relative route');

console.log('\nall client-bundle checks passed');
