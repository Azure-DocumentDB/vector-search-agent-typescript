import { pathToFileURL } from 'node:url';
import { loadDB, loadModels, requireWrites, check, integer, safeError, validateRuntimeEnvironment } from './config.js';
import { makeMongo, credential, acquireToken, MODEL_AUDIENCE } from './auth.js';
import { makeModels, ModelBudget } from './models.js';
import { HotelStore } from './store.js';
import { readHotels, parseHotels } from './data.js';
import { runAgent, searchSchema } from './agent.js';
export async function main(command: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  check(['auth', 'upload', 'agent', 'cleanup', 'live'].includes(command), 'unknown_command');
  validateRuntimeEnvironment(env);
  const dbConfig = loadDB(env);
  const modelConfig = command === 'cleanup' ? undefined : loadModels(env);
  const query = env.QUERY ?? 'A quiet hotel near walking trails';
  const neighbors = integer(env.NEAREST_NEIGHBORS, 3, 10);
  if (command === 'agent' || command === 'live') searchSchema.parse({ query, nearestNeighbors: neighbors });
  if (['upload', 'cleanup', 'live'].includes(command)) requireWrites(dbConfig);
  if (command === 'cleanup') check(dbConfig.cleanupConsent, 'exact_target_cleanup_consent_required');
  if (['upload', 'agent', 'live'].includes(command)) check(modelConfig?.paidConsent, 'paid_model_consent_required');
  if (command === 'live') check(env.LIVE_CONFIRM === dbConfig.target && dbConfig.cleanupConsent, 'live_exact_scope_confirmation_required');
  const hotels = command === 'upload' ? await readHotels(env.DATA_FILE_WITHOUT_VECTORS ?? '') : command === 'live' ? parseHotels([
    { HotelId: 'live-a', HotelName: 'Synthetic Trail Lodge', Description: 'A quiet synthetic lodge near walking trails and a park.' },
    { HotelId: 'live-b', HotelName: 'Synthetic City Hotel', Description: 'A synthetic downtown hotel near restaurants and shops.' },
    { HotelId: 'live-c', HotelName: 'Synthetic Lake Inn', Description: 'A synthetic lakeside inn with scenic paths.' }
  ]) : undefined;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), dbConfig.timeout);
  const stop = () => controller.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const signal = controller.signal;
  const client = makeMongo(dbConfig, signal);
  const store = new HotelStore(client.db(dbConfig.database), dbConfig, signal);
  const closeOnAbort = () => { void client.close().catch(() => {}); };
  signal.addEventListener('abort', closeOnAbort, { once: true });
  let liveStarted = false;
  try {
    await client.connect(); signal.throwIfAborted();
    if (command === 'auth') {
      await client.db(dbConfig.database).command({ ping: 1 }, { signal });
      if (modelConfig!.mode === 'entra') await acquireToken(credential(modelConfig!.timeout), MODEL_AUDIENCE, signal);
      console.log(JSON.stringify({ databaseAuthentication: 'passed', databaseMode: dbConfig.mode,
        modelConfiguration: 'validated', modelCredential: modelConfig!.mode === 'entra' ? 'token_audience_and_expiry_validated' : 'api_key_present_unverified',
        modelInference: 'not_called_not_verified' })); return;
    }
    if (command === 'cleanup') { console.log(JSON.stringify(await store.cleanup())); return; }
    const budget = new ModelBudget(modelConfig!, signal);
    const models = makeModels(modelConfig!, budget);
    if (command === 'upload') { console.log(JSON.stringify(await store.seed(hotels!, models.embeddings))); return; }
    if (command === 'live') {
      check((await store.inspect()).length === 0, 'live_requires_empty_scope'); liveStarted = true;
      const first = await store.seed(hotels!, models.embeddings);
      const callsBeforeRepeat = budget.requests;
      const second = await store.seed(hotels!, models.embeddings);
      check(first.inserted === 3 && second.inserted === 0 && second.unchanged === 3 && budget.requests === callsBeforeRepeat, 'live_idempotence_failure');
    }
    const result = await runAgent(models, store, query, neighbors, signal);
    console.log(JSON.stringify({ command, databaseMode: dbConfig.mode, modelMode: modelConfig!.mode, target: dbConfig.target,
      modelRequests: budget.requests, inputChars: budget.inputChars, ...result }));
  } finally {
    try {
      if (liveStarted) {
        const cleaned = await store.cleanup(); check((await store.cleanup()).deleted === 0, 'live_cleanup_not_idempotent');
        console.log(JSON.stringify({ liveCleanup: cleaned }));
      }
    } finally { signal.removeEventListener('abort', closeOnAbort); await client.close(); clearTimeout(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2] ?? '').catch(error => { console.error(JSON.stringify({ error: safeError(error) })); process.exitCode = 1; });
}
