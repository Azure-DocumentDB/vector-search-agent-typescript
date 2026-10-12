import { DefaultAzureCredential, type TokenCredential, type AccessToken } from '@azure/identity';
import { MongoClient, type OIDCCallbackParams } from 'mongodb';
import { check, loadDB, validateRuntimeEnvironment, type DBConfig } from './config.js';
export const DB_AUDIENCE = 'https://ossrdbms-aad.database.windows.net';
export const MODEL_AUDIENCE = 'https://cognitiveservices.azure.com';
export function validateToken(token: AccessToken | null, audience: string, now = Date.now()): { accessToken: string; expiresInSeconds: number } {
  check(token && typeof token.token === 'string' && token.token.length < 32768 && Number.isFinite(token.expiresOnTimestamp), 'token_missing_or_invalid');
  const parts = token.token.split('.');
  check(parts.length === 3 && parts.every(p => /^[A-Za-z0-9_-]+$/.test(p)), 'token_not_jwt');
  let payload: { aud?: unknown; exp?: unknown; nbf?: unknown };
  try { payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as typeof payload; }
  catch { throw new Error('invalid token'); }
  check(payload && typeof payload === 'object' && payload.aud === audience, 'token_audience_mismatch');
  check(typeof payload.exp === 'number' && Number.isSafeInteger(payload.exp), 'token_expiry_invalid');
  check(payload.nbf === undefined || (typeof payload.nbf === 'number' && payload.nbf * 1000 <= now), 'token_not_yet_valid');
  const seconds = Math.floor((Math.min(token.expiresOnTimestamp, payload.exp * 1000) - now) / 1000);
  check(Number.isSafeInteger(seconds) && seconds >= 30, 'token_expired_or_near_expiry');
  return { accessToken: token.token, expiresInSeconds: seconds };
}
export async function acquireToken(credential: TokenCredential, audience: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const token = await credential.getToken(`${audience}/.default`, { abortSignal: signal });
  signal.throwIfAborted();
  return validateToken(token, audience);
}
export async function oidcCallback(params: OIDCCallbackParams, credential: TokenCredential, signal: AbortSignal) {
  check(params.version === 1, 'unsupported_oidc_version');
  return acquireToken(credential, DB_AUDIENCE, AbortSignal.any([params.timeoutContext, signal]));
}
export function credential(timeout: number): TokenCredential {
  return new DefaultAzureCredential({ processTimeoutInMs: Math.min(timeout, 10000) });
}
export function makeMongo(c: DBConfig, signal: AbortSignal, tokenCredential?: TokenCredential): MongoClient {
  // Public constructors defend against forged config objects as well as validated CLI callers.
  validateRuntimeEnvironment();
  const validated = loadDB({ MONGO_AUTH_MODE: c.mode, MONGO_HOST: c.host, MONGO_PORT: String(c.port),
    MONGO_CONNECTION_STRING: c.uri || undefined, MONGO_OIDC_USERNAME: c.username || undefined,
    MONGO_DATABASE: c.database, MONGO_COLLECTION: c.collection, EMBEDDING_DIMENSIONS: String(c.dimensions),
    RUN_TIMEOUT_MS: String(c.timeout) });
  check(validated.target === c.target && validated.owner === c.owner, 'mongo_scope_mismatch');
  signal.throwIfAborted();
  const common = { tls: true, tlsAllowInvalidCertificates: false, tlsAllowInvalidHostnames: false,
    // Direct mode deliberately forbids automatic topology/SRV redirection of native credentials.
    directConnection: true, retryWrites: false, maxPoolSize: 2, minPoolSize: 0,
    serverSelectionTimeoutMS: Math.min(c.timeout, 15000), connectTimeoutMS: Math.min(c.timeout, 10000),
    socketTimeoutMS: Math.min(c.timeout, 20000), waitQueueTimeoutMS: Math.min(c.timeout, 10000), timeoutMS: c.timeout };
  if (c.mode === 'native') return new MongoClient(c.uri, common);
  const cred = tokenCredential ?? credential(c.timeout);
  return new MongoClient(`mongodb://${c.host}:${c.port}/`, { ...common, authMechanism: 'MONGODB-OIDC',
    ...(c.username ? { auth: { username: c.username, password: '' } } : {}),
    authMechanismProperties: { ALLOWED_HOSTS: [c.host],
      OIDC_CALLBACK: (params: OIDCCallbackParams) => oidcCallback(params, cred, signal) } });
}
