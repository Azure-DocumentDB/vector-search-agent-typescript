export class SafeError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'SafeError'; }
}
export function check(value: unknown, code: string): asserts value {
  if (!value) throw new SafeError(code);
}
export function safeError(e: unknown): string {
  return e instanceof SafeError ? e.code : 'operation_failed_details_withheld';
}
export function integer(raw: string | undefined, fallback: number, max: number, min = 1): number {
  const s = raw ?? String(fallback);
  check(/^\d+$/.test(s), 'invalid_integer');
  const n = Number(s);
  check(Number.isSafeInteger(n) && n >= min && n <= max, 'integer_out_of_range');
  return n;
}
const managedHost = /^[a-z0-9](?:[a-z0-9-]{0,120}[a-z0-9])?\.(?:global\.)?mongocluster\.cosmos\.azure\.com$/;
export interface DBConfig {
  mode: 'native' | 'entra'; host: string; port: number; uri: string; username: string;
  database: string; collection: string; target: string; owner: string; dimensions: number;
  timeout: number; writeConsent: boolean; cleanupConsent: boolean;
}
export function loadDB(env: NodeJS.ProcessEnv = process.env): DBConfig {
  check(env.USE_PASSWORDLESS === undefined, 'use_explicit_independent_auth_modes_not_USE_PASSWORDLESS');
  const mode = env.MONGO_AUTH_MODE;
  check(mode === 'native' || mode === 'entra', 'explicit_mongo_auth_mode_required');
  const host = env.MONGO_HOST ?? '';
  check(managedHost.test(host), 'invalid_managed_mongo_host');
  const port = integer(env.MONGO_PORT, 10260, 65535);
  check(port === 10260, 'managed_mongo_port_must_be_10260');
  const database = env.MONGO_DATABASE ?? '';
  check(/^agent_disposable_[a-z0-9_]{8,45}$/.test(database) && database.length <= 63, 'explicit_disposable_database_required');
  const collection = env.MONGO_COLLECTION ?? '';
  check(/^[a-z][a-z0-9_]{0,39}$/.test(collection), 'explicit_collection_required');
  const target = `${database}.${collection}`;
  const uri = env.MONGO_CONNECTION_STRING ?? '';
  const username = env.MONGO_OIDC_USERNAME ?? '';
  if (mode === 'native') {
    check(!username, 'oidc_username_in_native_mode');
    let u: URL;
    try { u = new URL(uri); } catch { throw new SafeError('invalid_mongo_uri'); }
    check(u.protocol === 'mongodb:' && u.hostname === host && Number(u.port || 27017) === port &&
      !u.hash && !uri.includes('#') && (u.pathname === '' || u.pathname === '/'), 'mongo_destination_mismatch');
    try { check(decodeURIComponent(u.username).trim() && decodeURIComponent(u.password).trim(), 'native_credentials_required'); }
    catch { throw new SafeError('invalid_native_credentials'); }
    const seen = new Set<string>();
    for (const [key, value] of u.searchParams) {
      const k = key.toLowerCase();
      check(!seen.has(k), 'duplicate_mongo_option'); seen.add(k);
      check((['tls', 'ssl', 'directconnection'].includes(k) && value === 'true') ||
        (k === 'retrywrites' && value === 'false') || (k === 'authsource' && value === 'admin') ||
        (k === 'authmechanism' && value === 'SCRAM-SHA-256'), 'unsafe_mongo_option');
    }
  } else {
    check(!uri, 'native_uri_in_entra_mode');
    check(username.length <= 256 && !/[\s<>]/.test(username), 'invalid_oidc_username');
  }
  return Object.freeze({ mode, host, port, uri, username, database, collection, target,
    owner: `vector-search-agent-typescript/v2/${target}`,
    dimensions: integer(env.EMBEDDING_DIMENSIONS, 1536, 3072),
    timeout: integer(env.RUN_TIMEOUT_MS, 90000, 300000, 1000),
    writeConsent: env.ALLOW_WRITES === target, cleanupConsent: env.CONFIRM_CLEANUP === target });
}
export interface ModelConfig {
  mode: 'api-key' | 'entra'; endpoint: string; key: string;
  embedding: string; planner: string; synth: string;
  embeddingVersion: string; plannerVersion: string; synthVersion: string;
  dimensions: number; timeout: number; maxRequests: number; maxInputChars: number; maxTokens: number;
  paidConsent: boolean;
}
export function loadModels(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  // Prevent SDK environment fallback destinations and third-party tracing of prompts/credentials.
  for (const key of ['AZURE_OPENAI_BASE_PATH', 'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_ORGANIZATION',
    'LANGCHAIN_TRACING', 'LANGCHAIN_TRACING_V2', 'LANGSMITH_TRACING', 'LANGSMITH_API_KEY', 'LANGCHAIN_API_KEY']) {
    check(!env[key], 'unsupported_sdk_environment_override');
  }
  const mode = env.AZURE_OPENAI_AUTH_MODE;
  check(mode === 'api-key' || mode === 'entra', 'explicit_openai_auth_mode_required');
  const endpoint = env.AZURE_OPENAI_ENDPOINT ?? '';
  check(/^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.openai\.azure\.com\/?$/.test(endpoint), 'invalid_openai_endpoint');
  const key = env.AZURE_OPENAI_API_KEY ?? '';
  check(mode === 'api-key' ? !!key.trim() && !/[\r\n]/.test(key) : !key, 'invalid_or_mixed_openai_credentials');
  const deployment = (k: string) => {
    const value = env[k] ?? '';
    check(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value), 'invalid_model_deployment'); return value;
  };
  const version = (k: string) => {
    const value = env[k] ?? '';
    check(/^20\d{2}-\d{2}-\d{2}(?:-preview)?$/.test(value), 'invalid_api_version'); return value;
  };
  return Object.freeze({ mode, endpoint: endpoint.replace(/\/$/, ''), key,
    embedding: deployment('AZURE_OPENAI_EMBEDDING_MODEL'), planner: deployment('AZURE_OPENAI_PLANNER_MODEL'),
    synth: deployment('AZURE_OPENAI_SYNTH_MODEL'), embeddingVersion: version('AZURE_OPENAI_EMBEDDING_API_VERSION'),
    plannerVersion: version('AZURE_OPENAI_PLANNER_API_VERSION'), synthVersion: version('AZURE_OPENAI_SYNTH_API_VERSION'),
    dimensions: integer(env.EMBEDDING_DIMENSIONS, 1536, 3072), timeout: integer(env.MODEL_TIMEOUT_MS, 20000, 60000, 1000),
    maxRequests: integer(env.MAX_MODEL_REQUESTS, 12, 64), maxInputChars: integer(env.MAX_MODEL_INPUT_CHARS, 60000, 300000),
    maxTokens: integer(env.MAX_OUTPUT_TOKENS, 512, 2048), paidConsent: env.ALLOW_PAID_MODELS === 'I_ACCEPT_MODEL_CHARGES' });
}
export function requireWrites(c: DBConfig): void { check(c.writeConsent, 'exact_target_write_consent_required'); }

export function validateRuntimeEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  check(env.NODE_TLS_REJECT_UNAUTHORIZED === undefined || env.NODE_TLS_REJECT_UNAUTHORIZED === '1', 'tls_verification_must_be_enabled');
  // No unexpected identity federation endpoints, custom authorities, or ambient proxy transports.
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy',
    'AZURE_AUTHORITY_HOST', 'AZURE_REGIONAL_AUTHORITY_NAME', 'IDENTITY_ENDPOINT', 'IMDS_ENDPOINT', 'MSI_ENDPOINT',
    'AZURE_FEDERATED_TOKEN_FILE', 'AZURE_CLIENT_CERTIFICATE_PATH']) {
    check(!env[key], 'unsupported_identity_or_proxy_override');
  }
}
