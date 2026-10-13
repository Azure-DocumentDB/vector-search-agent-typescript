import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLiveEvidence } from '../dist/live-evidence.js';
import { result } from './helpers.mjs';
const valid = () => ({ answer: 'Synthetic Trail Lodge is the retrieved option.', searches: [result], toolCalls: 1 });
test('live gate accepts bounded genuine search evidence and retrieved hotel reference', () => {
  assert.doesNotThrow(() => assertLiveEvidence(valid(), 7, 12, 3));
});
test('live gate rejects invented-only answer, without claiming full factual verification', () => {
  assert.throws(() => assertLiveEvidence({ ...valid(), answer: 'Invented Palace costs $1 and has a private airport.' }, 7, 12, 3),
    /live_answer_missing_retrieved_hotel/);
});
for (const change of [{ toolCalls: 0 }, { toolCalls: 5 }, { searches: [] }, { searches: [[]] },
  { searches: [[{ ...result[0], score: NaN }]] }, { searches: [Array(4).fill(result[0])] }])
  test('live gate rejects absent, inconsistent or malformed tool search hits', () => {
    assert.throws(() => assertLiveEvidence({ ...valid(), ...change }, 7, 12, 3));
  });
for (const requests of [0, 6, 13, 7.5, NaN]) test(`live gate rejects invalid model request count ${requests}`, () => {
  assert.throws(() => assertLiveEvidence(valid(), requests, 12, 3), /live_model_request_count_invalid/);
});
