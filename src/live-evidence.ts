import { check } from './config.js';
import type { SearchResult } from './store.js';

// A narrow live acceptance check, not a factuality or citation verifier.
export function assertLiveEvidence(
  result: { answer: string; searches: SearchResult[][]; toolCalls: number },
  modelRequests: number,
  maxRequests: number,
  nearestNeighbors: number
): void {
  check(Number.isInteger(result.toolCalls) && result.toolCalls >= 1 && result.toolCalls <= 4 &&
    result.searches.length === result.toolCalls, 'live_tool_evidence_missing');
  check(result.searches.every(hits => hits.length >= 1 && hits.length <= nearestNeighbors &&
    hits.every(hit => Number.isFinite(hit.score) && hit.hotel.HotelName.trim())), 'live_search_hits_invalid');
  // Three seed embeddings; each tool has a query embedding; at least two planner
  // requests and one synthesis. No request count can exceed the configured cap.
  check(Number.isInteger(modelRequests) && modelRequests >= 6 + result.toolCalls &&
    modelRequests <= maxRequests, 'live_model_request_count_invalid');
  check(result.answer.trim() && result.searches.flat().some(hit =>
    result.answer.includes(hit.hotel.HotelName)), 'live_answer_missing_retrieved_hotel');
}
