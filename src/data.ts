import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { check, type DBConfig } from './config.js';
import { vector } from './models.js';
export const hotelSchema = z.object({
  HotelId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  HotelName: z.string().trim().min(1).max(200), Description: z.string().trim().min(1).max(4000)
});
export type Hotel = z.infer<typeof hotelSchema>;
export function parseHotels(input: unknown): Hotel[] {
  const hotels = z.array(hotelSchema).min(1).max(50).parse(input);
  check(new Set(hotels.map(h => h.HotelId)).size === hotels.length, 'duplicate_hotel_id'); return hotels;
}
export async function readHotels(file: string): Promise<Hotel[]> {
  check(!!file, 'explicit_data_file_required');
  const bytes = await readFile(file); check(bytes.length <= 1_000_000, 'data_file_too_large');
  return parseHotels(JSON.parse(bytes.toString('utf8')) as unknown);
}
export function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function text(h: Hotel): string { return `Hotel: ${h.HotelName}\n${h.Description}`; }
export interface OwnedHotel { _id: string; owner: string; hotel: Hotel; vector: number[]; hash: string; }
export function owned(hotel: Hotel, embedding: number[], c: DBConfig): OwnedHotel {
  const record = { _id: `agent-v2-${hotel.HotelId}`, owner: c.owner, hotel, vector: vector(embedding, c.dimensions) };
  return { ...record, hash: digest(record) };
}
export function validateOwned(input: unknown, c: DBConfig): OwnedHotel {
  check(input && typeof input === 'object', 'foreign_or_modified_data');
  const row = input as OwnedHotel;
  check(Object.keys(row).sort().join(',') === '_id,hash,hotel,owner,vector', 'foreign_or_modified_data');
  const parsed = hotelSchema.strict().safeParse(row.hotel);
  check(parsed.success && row.owner === c.owner && row._id === `agent-v2-${parsed.data.HotelId}`, 'foreign_or_modified_data');
  check(row.hash === owned(parsed.data, row.vector, c).hash, 'foreign_or_modified_data');
  return row;
}
