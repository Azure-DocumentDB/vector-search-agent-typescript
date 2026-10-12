import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { loadDB, loadModels, safeError, SafeError } from '../dist/config.js';
import { validateToken, oidcCallback, makeMongo, DB_AUDIENCE, MODEL_AUDIENCE } from '../dist/auth.js';
import { makeModels, ModelBudget, modelFetch } from '../dist/models.js';
import { dbEnv, modelEnv, modelsConfig, jwt, fixture, embedding, chat } from './helpers.mjs';
const signal = () => AbortSignal.timeout(10000);
for (const mode of ['native', 'entra']) test(`managed ${mode}: exact destination, TLS and direct topology`, async () => {
  const c = loadDB(dbEnv(mode === 'entra' ? { MONGO_AUTH_MODE: mode, MONGO_CONNECTION_STRING: undefined } : {}));
  const client = makeMongo(c, signal(), { getToken: async () => { throw new Error('must not acquire during construction'); } });
  assert.equal(client.options.tls, true); assert.equal(client.options.directConnection, true);
  assert.equal(client.options.rejectUnauthorized, true); assert.equal(client.options.checkServerIdentity, undefined); assert.equal(client.options.hosts[0].host, c.host);
  assert.equal(client.options.hosts[0].port, c.port);
  if (mode === 'entra') assert.deepEqual(client.options.credentials.mechanismProperties.ALLOWED_HOSTS, [c.host]);
  await client.close();
});
for (const override of [
  { MONGO_HOST: 'evil.test' }, { MONGO_HOST: 'fixture.global.mongocluster.cosmos.azure.com.evil.test' },
  { MONGO_DATABASE: 'Hotels' }, { MONGO_COLLECTION: '' }, { MONGO_AUTH_MODE: 'automatic' },
  { MONGO_CONNECTION_STRING: dbEnv().MONGO_CONNECTION_STRING.replace('tls=true', 'tls=false') },
  { MONGO_CONNECTION_STRING: dbEnv().MONGO_CONNECTION_STRING + '&tlsAllowInvalidCertificates=true' },
  { MONGO_CONNECTION_STRING: dbEnv().MONGO_CONNECTION_STRING + '&tls=false' },
  { MONGO_CONNECTION_STRING: dbEnv().MONGO_CONNECTION_STRING.replace('mongodb:', 'mongodb+srv:') },
  { MONGO_CONNECTION_STRING: dbEnv().MONGO_CONNECTION_STRING.replace('fixture.global', 'foreign.global') },
  { MONGO_AUTH_MODE: 'entra' }, { MONGO_PORT: 'NaN' }, { EMBEDDING_DIMENSIONS: '0' }, { USE_PASSWORDLESS: 'true' }
]) test(`reject unsafe DB config ${JSON.stringify(override)}`, () => assert.throws(() => loadDB(dbEnv(override))));
for (const override of [
  { AZURE_OPENAI_ENDPOINT: 'http://fixture.openai.azure.com' }, { AZURE_OPENAI_ENDPOINT: 'https://fixture.openai.azure.com.evil.test' },
  { AZURE_OPENAI_ENDPOINT: 'https://user:key@fixture.openai.azure.com' }, { AZURE_OPENAI_ENDPOINT: 'https://fixture.openai.azure.com/path' },
  { AZURE_OPENAI_BASE_PATH: 'https://evil.test' }, { AZURE_OPENAI_AUTH_MODE: 'entra' },
  { AZURE_OPENAI_EMBEDDING_MODEL: '../outside' }, { AZURE_OPENAI_SYNTH_API_VERSION: '' },
  { LANGSMITH_TRACING: 'true' }, { MAX_MODEL_REQUESTS: '999' }, { MAX_OUTPUT_TOKENS: '0' }
]) test(`reject unsafe model config ${Object.keys(override)[0]}`, () => assert.throws(() => loadModels(modelEnv(override))));
test('OIDC lifetime converts epoch milliseconds to seconds and fixes audience', async () => {
  const now = Date.now(); const token = { token: jwt(DB_AUDIENCE), expiresOnTimestamp: now + 3600000 };
  const parsed = validateToken(token, DB_AUDIENCE, now); assert.ok(parsed.expiresInSeconds >= 3598 && parsed.expiresInSeconds <= 3600);
  let scope;
  await oidcCallback({ version: 1, timeoutContext: signal(), idpInfo: { issuer: 'https://evil.test', clientId: 'evil' } },
    { getToken: async s => { scope = s; return token; } }, signal());
  assert.equal(scope, DB_AUDIENCE + '/.default');
});
for (const token of [null, { token: '', expiresOnTimestamp: Date.now() + 3600000 },
  { token: jwt('https://evil.test'), expiresOnTimestamp: Date.now() + 3600000 },
  { token: jwt(DB_AUDIENCE, 1), expiresOnTimestamp: Date.now() + 3600000 },
  { token: jwt(DB_AUDIENCE), expiresOnTimestamp: Date.now() - 1 },
  { token: jwt(DB_AUDIENCE, undefined, { nbf: 9999999999 }), expiresOnTimestamp: Date.now() + 3600000 }
]) test('reject missing, expired, future or wrong-audience token', () => assert.throws(() => validateToken(token, DB_AUDIENCE)));
test('OIDC cancellation and unsupported version do not acquire credentials', async () => {
  let calls = 0; const cred = { getToken: async () => { calls++; return null; } };
  await assert.rejects(oidcCallback({ version: 2, timeoutContext: signal() }, cred, signal()));
  await assert.rejects(oidcCallback({ version: 1, timeoutContext: AbortSignal.abort() }, cred, signal())); assert.equal(calls, 0);
});
for (const mode of ['api-key', 'entra']) test(`actual Azure LangChain SDK ${mode} request URL, auth and independent versions`, async () => {
  const f = await fixture(r => r.url.includes('/embeddings') ? embedding() : chat());
  try {
    const c = modelsConfig(mode === 'entra' ? { AZURE_OPENAI_AUTH_MODE: mode, AZURE_OPENAI_API_KEY: undefined } : {});
    const scopes = [];
    const m = makeModels(c, new ModelBudget(c, signal()), { transport: f.transport,
      credential: { getToken: async scope => { scopes.push(scope); return { token: jwt(MODEL_AUDIENCE), expiresOnTimestamp: Date.now() + 3600000 }; } } });
    assert.deepEqual(await m.embeddings.embedQuery('synthetic'), [1, 0, 0]);
    assert.equal((await m.planner.invoke('synthetic')).content, 'Synthetic model answer'); await m.synth.invoke('synthetic');
    assert.deepEqual(f.requests.map(r => r.url), ['/openai/deployments/embed/embeddings?api-version=2023-05-15',
      '/openai/deployments/planner/chat/completions?api-version=2024-10-21', '/openai/deployments/synth/chat/completions?api-version=2024-06-01']);
    for (const r of f.requests) { assert.equal(r.method, 'POST');
      if (mode === 'api-key') { assert.equal(r.headers['api-key'], c.key); assert.equal(r.headers.authorization, undefined); }
      else { assert.match(r.headers.authorization, /^Bearer /); assert.equal(r.headers['api-key'], undefined); }
    }
    if (mode === 'entra') assert.ok(scopes.every(s => s === MODEL_AUDIENCE + '/.default'));
    assert.equal(f.requests[1].body.max_tokens, 512); assert.equal(f.requests[0].body.encoding_format, 'float');
  } finally { await f.close(); }
});
for (const response of [{ status: 302, headers: { location: 'https://evil.test' }, body: {} }, { status: 401, body: { error: 'synthetic-secret' } },
  { body: { data: [] } }, { body: { data: [{ index: 1, embedding: [1, 0, 0] }] } }, { body: { data: [{ index: 0, embedding: [1] }] } }])
  test('model transport rejects redirects, failures and malformed vectors without retries', async () => {
    const f = await fixture(() => response); try { const c = modelsConfig(); const m = makeModels(c, new ModelBudget(c, signal()), { transport: f.transport });
      await assert.rejects(m.embeddings.embedQuery('x')); assert.equal(f.requests.length, 1);
    } finally { await f.close(); }
  });
test('wrong destination and exhausted budgets prevent network', async () => {
  const c = modelsConfig({ MAX_MODEL_REQUESTS: '1' }); const b = new ModelBudget(c, signal()); let calls = 0;
  const transport = modelFetch(c, b, async () => { calls++; return new Response(JSON.stringify(embedding())); });
  const init = { method: 'POST', headers: { 'api-key': c.key }, body: JSON.stringify({ input: 'x' }) };
  await assert.rejects(transport('https://evil.test', init));
  const u = `${c.endpoint}/openai/deployments/embed/embeddings?api-version=2023-05-15`;
  await transport(u, init); await assert.rejects(transport(u, init)); assert.equal(calls, 1);
});
test('paid opt-in required even for model construction', () => {
  const c = modelsConfig({ ALLOW_PAID_MODELS: undefined }); assert.throws(() => makeModels(c, new ModelBudget(c, signal())));
});
test('errors never reflect arbitrary server details or credential values', () => {
  assert.equal(safeError(new Error('mongodb://user:supersecret@host')), 'operation_failed_details_withheld');
  assert.equal(safeError(new SafeError('model_http_failure')), 'model_http_failure');
});
for (const command of ['auth', 'upload', 'agent', 'cleanup', 'live']) test(`${command} missing config exits nonzero without secrets`, () => {
  const p = spawnSync(process.execPath, ['dist/cli.js', command], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(p.status, 1); assert.match(p.stderr, /explicit_mongo_auth_mode_required/); assert.equal(p.stdout, '');
});
test('default auth exercises real CLI but never calls paid models or inspects other databases', () => {
  const p = spawnSync(process.execPath, ['--import', './test/cli-fixture-loader.mjs', 'dist/cli.js', 'auth'], {
    encoding: 'utf8', env: { PATH: process.env.PATH, ...dbEnv(), ...modelEnv({ ALLOW_PAID_MODELS: undefined }) }
  });
  assert.equal(p.status, 0, p.stderr); const report = JSON.parse(p.stdout);
  assert.equal(report.databaseAuthentication, 'passed'); assert.equal(report.modelInference, 'not_called_not_verified');
  assert.equal(report.modelCredential, 'api_key_present_unverified');
});
test('cleanup requires no OpenAI configuration and rejects absent target consent before network', () => {
  const p = spawnSync(process.execPath, ['dist/cli.js', 'cleanup'], { encoding: 'utf8',
    env: { PATH: process.env.PATH, ...dbEnv({ CONFIRM_CLEANUP: undefined }) } });
  assert.equal(p.status, 1); assert.match(p.stderr, /exact_target_cleanup_consent_required/);
});
test('invalid token prevents model network, even through actual SDK token provider', async () => {
  const c = modelsConfig({ AZURE_OPENAI_AUTH_MODE: 'entra', AZURE_OPENAI_API_KEY: undefined }); let calls = 0;
  const m = makeModels(c, new ModelBudget(c, signal()), { transport: async () => { calls++; throw Error('unexpected network'); },
    credential: { getToken: async () => ({ token: jwt(DB_AUDIENCE), expiresOnTimestamp: Date.now() + 3600000 }) } });
  await assert.rejects(m.embeddings.embedQuery('x')); assert.equal(calls, 0);
});
test('input character cap rejects before sending request', async () => {
  const c = modelsConfig({ MAX_MODEL_INPUT_CHARS: '1' }); let calls = 0;
  const m = makeModels(c, new ModelBudget(c, signal()), { transport: async () => { calls++; throw Error('unexpected network'); } });
  await assert.rejects(m.embeddings.embedQuery('too long')); assert.equal(calls, 0);
});
test('TLS bypass and credential endpoint override are rejected before connection', () => {
  for (const override of [{ NODE_TLS_REJECT_UNAUTHORIZED: '0' }, { AZURE_AUTHORITY_HOST: 'https://evil.test' }, { HTTPS_PROXY: 'https://evil.test' }]) {
    const p = spawnSync(process.execPath, ['dist/cli.js', 'auth'], { encoding: 'utf8', env: { PATH: process.env.PATH, ...dbEnv(), ...modelEnv(), ...override } });
    assert.equal(p.status, 1); assert.doesNotMatch(p.stderr, /evil\.test/);
  }
});
test('direct constructors reject forged endpoint config before token acquisition', () => {
  const c = loadDB(dbEnv()); let calls = 0; const cred = { getToken: async () => { calls++; return null; } };
  assert.throws(() => makeMongo({ ...c, mode: 'entra', uri: '', host: 'evil.test' }, signal(), cred));
  const m = { ...modelsConfig(), endpoint: 'https://evil.test', mode: 'entra', key: '' };
  assert.throws(() => makeModels(m, new ModelBudget(m, signal()), { credential: cred })); assert.equal(calls, 0);
});
