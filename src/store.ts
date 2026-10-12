import type { Collection, Db } from 'mongodb';
import { check, requireWrites, type DBConfig } from './config.js';
import { owned, text, validateOwned, type Hotel, type OwnedHotel } from './data.js';
import { vector } from './models.js';
export interface Embedder { embedQuery(text: string): Promise<number[]>; }
export interface SearchResult { hotel: Hotel; score: number; }
export class HotelStore {
  readonly collection: Collection<OwnedHotel>;
  constructor(readonly db: Db, readonly config: DBConfig, readonly signal: AbortSignal) {
    this.collection = db.collection<OwnedHotel>(config.collection);
  }
  async inspect(): Promise<OwnedHotel[]> {
    this.signal.throwIfAborted();
    const rows = await this.collection.find({}, { signal: this.signal }).limit(51).toArray();
    check(rows.length <= 50, 'foreign_or_excess_data');
    return rows.map(row => validateOwned(row, this.config));
  }
  async seed(hotels: Hotel[], embeddings: Embedder): Promise<{ inserted: number; unchanged: number }> {
    requireWrites(this.config);
    const existing = await this.inspect(); const byId = new Map(existing.map(row => [row.hotel.HotelId, row]));
    // Preflight EVERY existing id/content before any paid call or write. Never replace changed records.
    const input = new Map(hotels.map(h => [h.HotelId, h]));
    for (const row of existing) check(JSON.stringify(input.get(row.hotel.HotelId)) === JSON.stringify(row.hotel), 'seed_data_conflict');
    const pending: OwnedHotel[] = [];
    for (const hotel of hotels) {
      if (byId.has(hotel.HotelId)) continue;
      this.signal.throwIfAborted();
      pending.push(owned(hotel, await embeddings.embedQuery(text(hotel)), this.config));
    }
    // No insert until every requested embedding validates. $setOnInsert never overwrites existing ids.
    let inserted = 0;
    for (const row of pending) {
      this.signal.throwIfAborted();
      const result = await this.collection.updateOne({ _id: row._id, hash: row.hash, owner: row.owner },
        { $setOnInsert: row }, { upsert: true });
      check(result.acknowledged && result.upsertedCount + result.matchedCount === 1, 'seed_write_failed');
      inserted += result.upsertedCount;
    }
    this.signal.throwIfAborted();
    const after = await this.inspect();
    check(after.length === hotels.length, 'seed_count_mismatch');
    // Fixed, bounded IVF sample. Unsupported index creation fails, never silently falls back.
    await this.db.command({ createIndexes: this.config.collection, indexes: [{ name: 'agent_v2_vector_ivf',
      key: { vector: 'cosmosSearch' }, cosmosSearchOptions: { kind: 'vector-ivf', numLists: 1,
        similarity: 'COS', dimensions: this.config.dimensions } }] }, { signal: this.signal });
    return { inserted, unchanged: hotels.length - inserted };
  }
  async search(embedding: number[], nearestNeighbors: number): Promise<SearchResult[]> {
    check(Number.isInteger(nearestNeighbors) && nearestNeighbors >= 1 && nearestNeighbors <= 10, 'invalid_neighbors');
    vector(embedding, this.config.dimensions);
    check((await this.inspect()).length > 0, 'empty_owned_collection');
    const rows = await this.collection.aggregate<{ document: OwnedHotel; score: number }>([
      { $search: { cosmosSearch: { vector: embedding, path: 'vector', k: nearestNeighbors }, returnStoredSource: true } },
      { $project: { _id: 0, document: '$$ROOT', score: { $meta: 'searchScore' } } }
    ], { signal: this.signal, maxTimeMS: Math.min(this.config.timeout, 20000) }).toArray();
    check(rows.length > 0 && rows.length <= nearestNeighbors, 'empty_or_excess_search_results');
    const seen = new Set<string>();
    return rows.map(row => {
      const doc = validateOwned(row.document, this.config);
      check(Number.isFinite(row.score) && !seen.has(doc._id), 'invalid_search_result'); seen.add(doc._id);
      return { hotel: doc.hotel, score: row.score };
    });
  }
  async cleanup(): Promise<{ deleted: number }> {
    requireWrites(this.config); check(this.config.cleanupConsent, 'exact_target_cleanup_consent_required');
    const rows = await this.inspect();
    if (!rows.length) return { deleted: 0 };
    // Only snapshot-exact, hash-verified owned rows; never drop a DB/collection/index.
    this.signal.throwIfAborted();
    const result = await this.collection.deleteMany({ $or: rows.map(row => ({ _id: row._id, owner: row.owner, hash: row.hash,
      hotel: row.hotel, vector: row.vector })) });
    check(result.acknowledged && result.deletedCount === rows.length, 'cleanup_conflict_or_partial_delete');
    check((await this.inspect()).length === 0, 'cleanup_remaining_data');
    return { deleted: result.deletedCount };
  }
}
