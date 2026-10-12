import test from 'node:test';
import assert from 'node:assert/strict';
import { HotelStore } from '../dist/store.js';
import { owned, parseHotels, validateOwned } from '../dist/data.js';
import { config, hotel } from './helpers.mjs';
function mockStore(initial = [], c = config()) {
  const rows = structuredClone(initial); const calls = { updates: [], commands: [], deletes: [], aggregates: [] };
  const collection = {
    find: () => ({ limit: n => ({ toArray: async () => structuredClone(rows.slice(0, n)) }) }),
    updateOne: async (filter, update, options) => {
      calls.updates.push({ filter, update, options }); const existing = rows.find(r => r._id === filter._id);
      if (existing && existing.hash !== filter.hash) throw Error('duplicate key');
      if (!existing) rows.push(structuredClone(update.$setOnInsert));
      return { acknowledged: true, upsertedCount: existing ? 0 : 1, matchedCount: existing ? 1 : 0 };
    },
    deleteMany: async filter => { calls.deletes.push(filter); let count = 0;
      for (const match of filter.$or) { const i = rows.findIndex(row => Object.entries(match).every(([k, v]) => JSON.stringify(row[k]) === JSON.stringify(v)));
        if (i >= 0) { rows.splice(i, 1); count++; } }
      return { acknowledged: true, deletedCount: count };
    },
    aggregate: (pipeline, options) => { calls.aggregates.push({ pipeline, options }); return { toArray: async () => rows.map(document => ({ document, score: .9 })) }; }
  };
  const db = { collection: name => { assert.equal(name, c.collection); return collection; }, command: async cmd => { calls.commands.push(cmd); return { ok: 1 }; } };
  const store = new HotelStore(db, c, AbortSignal.timeout(10000)); let embeds = 0;
  return { store, rows, calls, collection, db, embeddings: { embedQuery: async () => { embeds++; return [1, 0, 0]; } }, embeds: () => embeds };
}
test('seed is bounded, insert-only and idempotent; unchanged seed makes zero paid calls', async () => {
  const m = mockStore(); assert.deepEqual(await m.store.seed([hotel], m.embeddings), { inserted: 1, unchanged: 0 });
  assert.deepEqual(await m.store.seed([hotel], m.embeddings), { inserted: 0, unchanged: 1 });
  assert.equal(m.embeds(), 1); assert.equal(m.rows.length, 1); assert.equal(m.calls.updates.length, 1);
  assert.ok(m.calls.updates[0].update.$setOnInsert); assert.equal(m.calls.commands[0].indexes[0].cosmosSearchOptions.dimensions, 3);
});
test('changed owned seed refuses overwrite before model/network write', async () => {
  const m = mockStore([owned(hotel, [1, 0, 0], config())]);
  await assert.rejects(m.store.seed([{ ...hotel, Description: 'changed' }], m.embeddings));
  assert.equal(m.embeds(), 0); assert.equal(m.calls.updates.length, 0);
});
for (const foreign of [{ _id: 'foreign', secret: 'unowned data' }, { ...owned(hotel, [1, 0, 0], config()), owner: 'foreign' },
  { ...owned(hotel, [1, 0, 0], config()), extra: 'foreign field' },
  { ...owned(hotel, [1, 0, 0], config()), hotel: { ...hotel, Description: 'modified' } }])
  test('seed and cleanup refuse foreign/modified rows without changes', async () => {
    const m = mockStore([foreign]); await assert.rejects(m.store.seed([hotel], m.embeddings)); await assert.rejects(m.store.cleanup());
    assert.equal(m.embeds(), 0); assert.equal(m.calls.updates.length, 0); assert.equal(m.calls.deletes.length, 0); assert.equal(m.rows.length, 1);
  });
test('scope-exact cleanup uses verified snapshot matches, no drop and idempotent rerun', async () => {
  const row = owned(hotel, [1, 0, 0], config()); const m = mockStore([row]);
  assert.deepEqual(await m.store.cleanup(), { deleted: 1 }); assert.deepEqual(await m.store.cleanup(), { deleted: 0 });
  assert.deepEqual(m.calls.deletes[0], { $or: [{ _id: row._id, owner: row.owner, hash: row.hash, hotel: row.hotel, vector: row.vector }] });
  assert.equal(m.calls.commands.length, 0);
});
test('every embedding validates before any database insert', async () => {
  const m = mockStore(); let n = 0;
  await assert.rejects(m.store.seed([hotel, { ...hotel, HotelId: 'b' }], { embedQuery: async () => ++n === 1 ? [1, 0, 0] : [] }));
  assert.equal(m.calls.updates.length, 0);
});
test('write and cleanup target opt-ins required before collection inspection', async () => {
  const m = mockStore([], { ...config(), writeConsent: false });
  await assert.rejects(m.store.seed([hotel], m.embeddings)); await assert.rejects(m.store.cleanup());
  const other = mockStore([], { ...config(), cleanupConsent: false }); await assert.rejects(other.store.cleanup());
});
test('search submits only fixed cosmosSearch pipeline and validates owned results', async () => {
  const m = mockStore([owned(hotel, [1, 0, 0], config())]);
  const results = await m.store.search([1, 0, 0], 3); assert.equal(results[0].hotel.HotelId, 'a');
  assert.deepEqual(m.calls.aggregates[0].pipeline, [{ $search: { cosmosSearch: { vector: [1, 0, 0], path: 'vector', k: 3 }, returnStoredSource: true } },
    { $project: { _id: 0, document: '$$ROOT', score: { $meta: 'searchScore' } } }]);
});
test('empty collection, malformed vector, invalid k fail before aggregation', async () => {
  const m = mockStore(); await assert.rejects(m.store.search([1, 0, 0], 3)); await assert.rejects(m.store.search([NaN, 0, 0], 3));
  await assert.rejects(m.store.search([1, 0, 0], 0)); assert.equal(m.calls.aggregates.length, 0);
});
test('index failure and partial delete fail rather than report success', async () => {
  const m = mockStore(); m.db.command = async () => { throw Error('unsupported'); };
  await assert.rejects(m.store.seed([hotel], m.embeddings));
  m.collection.deleteMany = async () => ({ acknowledged: true, deletedCount: 0 }); await assert.rejects(m.store.cleanup());
});
test('input parser rejects duplicates, empty descriptions and too many records', () => {
  assert.throws(() => parseHotels([hotel, hotel])); assert.throws(() => parseHotels([{ ...hotel, Description: '' }]));
  assert.throws(() => parseHotels(Array.from({ length: 51 }, (_, i) => ({ ...hotel, HotelId: String(i) }))));
  assert.throws(() => validateOwned({ ...owned(hotel, [1, 0, 0], config()), vector: [0, 0, 0] }, config()));
});
test('managed search wire decoration __cosmos_meta__ is ignored only on aggregate result', async () => {
  const row = owned(hotel, [1, 0, 0], config()); const m = mockStore([row]);
  const decorated = { ...structuredClone(row), __cosmos_meta__: { searchScore: .9, synthetic: 'wire metadata' } };
  m.collection.aggregate = () => ({ toArray: async () => [{ document: decorated, score: .9 }] });
  assert.deepEqual(await m.store.search([1, 0, 0], 3), [{ hotel, score: .9 }]);
  assert.deepEqual(m.rows, [row]); assert.ok('__cosmos_meta__' in decorated);
  assert.deepEqual(await m.store.seed([hotel], m.embeddings), { inserted: 0, unchanged: 1 });
  assert.equal(m.embeds(), 0); assert.deepEqual(await m.store.cleanup(), { deleted: 1 });
});
test('persisted __cosmos_meta__ remains foreign data for inspect, seed, search and cleanup', async () => {
  const m = mockStore([{ ...owned(hotel, [1, 0, 0], config()), __cosmos_meta__: {} }]);
  await assert.rejects(m.store.inspect(), /foreign_or_modified_data/);
  await assert.rejects(m.store.seed([hotel], m.embeddings), /foreign_or_modified_data/);
  await assert.rejects(m.store.search([1, 0, 0], 3), /foreign_or_modified_data/);
  await assert.rejects(m.store.cleanup(), /foreign_or_modified_data/);
  assert.equal(m.calls.updates.length, 0); assert.equal(m.calls.deletes.length, 0);
  assert.equal(m.calls.aggregates.length, 0); assert.equal(m.embeds(), 0);
});
for (const change of [{ unexpected: 'foreign' }, { hotel: { ...hotel, Description: 'changed' } },
  { owner: 'foreign-owner' }, { vector: [0, 1, 0] }, { __cosmos_meta__: 'not-an-object' }, { __cosmos_meta__: [] }])
  test('search metadata exemption cannot hide other unknown or modified fields', async () => {
    const row = owned(hotel, [1, 0, 0], config()); const m = mockStore([row]);
    m.collection.aggregate = () => ({ toArray: async () => [{ document: { ...row, __cosmos_meta__: {}, ...change }, score: .9 }] });
    await assert.rejects(m.store.search([1, 0, 0], 3));
    assert.deepEqual(m.rows, [row]); assert.equal(m.calls.deletes.length, 0);
  });
