import http from 'node:http';
import { loadDB, loadModels } from '../dist/config.js';
export function dbEnv(overrides = {}) { return { MONGO_AUTH_MODE: 'native', MONGO_HOST: 'fixture.global.mongocluster.cosmos.azure.com', MONGO_PORT: '10260',
  MONGO_CONNECTION_STRING: 'mongodb://fixture-user:fixture-password@fixture.global.mongocluster.cosmos.azure.com:10260/?tls=true&authMechanism=SCRAM-SHA-256',
  MONGO_DATABASE: 'agent_disposable_20261012_test', MONGO_COLLECTION: 'hotels', EMBEDDING_DIMENSIONS: '3',
  ALLOW_WRITES: 'agent_disposable_20261012_test.hotels', CONFIRM_CLEANUP: 'agent_disposable_20261012_test.hotels', ...overrides }; }
export function modelEnv(overrides = {}) { return { AZURE_OPENAI_AUTH_MODE: 'api-key', AZURE_OPENAI_API_KEY: 'synthetic-test-key',
  AZURE_OPENAI_ENDPOINT: 'https://fixture.openai.azure.com/', AZURE_OPENAI_EMBEDDING_MODEL: 'embed', AZURE_OPENAI_EMBEDDING_API_VERSION: '2023-05-15',
  AZURE_OPENAI_PLANNER_MODEL: 'planner', AZURE_OPENAI_PLANNER_API_VERSION: '2024-10-21',
  AZURE_OPENAI_SYNTH_MODEL: 'synth', AZURE_OPENAI_SYNTH_API_VERSION: '2024-06-01', EMBEDDING_DIMENSIONS: '3',
  ALLOW_PAID_MODELS: 'I_ACCEPT_MODEL_CHARGES', ...overrides }; }
export const config = () => loadDB(dbEnv());
export const modelsConfig = (overrides = {}) => loadModels(modelEnv(overrides));
export const hotel = { HotelId: 'a', HotelName: 'Synthetic Trail Lodge', Description: 'A quiet synthetic lodge near trails.' };
export const result = [{ hotel, score: 0.99 }];
export const jwt = (aud, exp = Math.floor(Date.now() / 1000) + 3600, other = {}) =>
  [Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ aud, exp, ...other })).toString('base64url'), 'c2ln'].join('.');
export const chat = (content = 'Synthetic model answer', calls) => ({ id: 'chat-test', object: 'chat.completion', created: 1, model: 'fixture',
  choices: [{ index: 0, finish_reason: calls?.length ? 'tool_calls' : 'stop', message: { role: 'assistant', content, ...(calls ? { tool_calls: calls } : {}) } }],
  usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
export const call = (id = 'call1', query = 'quiet hotel', args = {}) => ({ id, type: 'function', function: {
  name: 'search_hotels_collection', arguments: JSON.stringify({ query, nearestNeighbors: 3, ...args }) } });
export const embedding = () => ({ object: 'list', data: [{ object: 'embedding', index: 0, embedding: [1, 0, 0] }], model: 'fixture', usage: { prompt_tokens: 2, total_tokens: 2 } });
export async function fixture(handler) {
  const requests = []; const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const item = { url: req.url, headers: req.headers, method: req.method, body: JSON.parse(body || '{}') }; requests.push(item);
    try { const response = await handler(item, requests.length); res.writeHead(response?.status ?? 200, { 'content-type': 'application/json', ...response?.headers });
      res.end(JSON.stringify(response?.body ?? response)); }
    catch { res.writeHead(500); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  // Only this test transport rewrites a validated Azure request to loopback; never exposed through CLI env.
  const transport = (url, init) => { const u = new URL(url); return fetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, init); };
  return { requests, transport, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
