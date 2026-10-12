import { AzureChatOpenAI, AzureOpenAIEmbeddings } from '@langchain/openai';
import type { TokenCredential } from '@azure/identity';
import { check, SafeError, loadModels, validateRuntimeEnvironment, type ModelConfig } from './config.js';
import { acquireToken, credential, MODEL_AUDIENCE } from './auth.js';
export function vector(value: unknown, dimensions: number): number[] {
  check(Array.isArray(value) && value.length === dimensions && value.every(v => typeof v === 'number' && Number.isFinite(v)) &&
    value.some(v => v !== 0), 'invalid_embedding_vector');
  return value as number[];
}
export class ModelBudget {
  requests = 0;
  inputChars = 0;
  constructor(readonly config: ModelConfig, readonly signal: AbortSignal) {}
  reserve(body: string): void {
    this.signal.throwIfAborted();
    check(this.config.paidConsent, 'paid_model_consent_required');
    check(this.requests < this.config.maxRequests, 'model_request_budget_exhausted');
    check(this.inputChars + body.length <= this.config.maxInputChars, 'model_input_budget_exhausted');
    this.requests++; this.inputChars += body.length;
  }
}
async function boundedJSON(response: Response): Promise<unknown> {
  check(response.body, 'empty_model_response');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; check(size <= 2_000_000, 'model_response_too_large'); chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (e) { await reader.cancel(); throw e; }
  finally { reader.releaseLock(); }
}
export function modelFetch(c: ModelConfig, budget: ModelBudget, transport: typeof fetch = fetch): typeof fetch {
  const routes = new Map<string, 'embedding' | 'chat'>([
    [`${c.endpoint}/openai/deployments/${c.embedding}/embeddings?api-version=${c.embeddingVersion}`, 'embedding'],
    [`${c.endpoint}/openai/deployments/${c.planner}/chat/completions?api-version=${c.plannerVersion}`, 'chat'],
    [`${c.endpoint}/openai/deployments/${c.synth}/chat/completions?api-version=${c.synthVersion}`, 'chat']
  ]);
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const kind = routes.get(url);
    check(kind && init?.method === 'POST' && typeof init.body === 'string', 'unexpected_model_request_destination');
    const headers = new Headers(init.headers);
    check(c.mode === 'api-key' ? headers.get('api-key') === c.key && !headers.has('authorization') :
      !headers.has('api-key') && /^Bearer [A-Za-z0-9_.-]+$/.test(headers.get('authorization') ?? ''), 'incorrect_model_auth_headers');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    check(body.stream !== true && (body.n === undefined || body.n === 1), 'unsupported_model_request');
    if (kind === 'chat') {
      const cap = body.max_tokens ?? body.max_completion_tokens;
      check(cap === c.maxTokens, 'model_output_cap_missing');
    }
    budget.reserve(init.body);
    const signal = AbortSignal.any([budget.signal, AbortSignal.timeout(c.timeout), ...(init.signal ? [init.signal] : [])]);
    const response = await transport(url, { ...init, signal, redirect: 'manual' });
    if (!response.ok) { await response.body?.cancel(); throw new SafeError(response.status >= 300 && response.status < 400 ? 'model_redirect_refused' : 'model_http_failure'); }
    const data = await boundedJSON(response) as Record<string, unknown>;
    signal.throwIfAborted();
    check(data && typeof data === 'object', 'invalid_model_response');
    if (kind === 'embedding') {
      const count = Array.isArray(body.input) ? body.input.length : 1;
      check(Array.isArray(data.data) && data.data.length === count, 'embedding_count_mismatch');
      const seen = new Set<number>();
      for (const item of data.data as { index: number; embedding: unknown }[]) {
        check(item && Number.isInteger(item.index) && item.index >= 0 && item.index < count && !seen.has(item.index), 'embedding_index_mismatch');
        seen.add(item.index); vector(item.embedding, c.dimensions);
      }
      (data.data as { index: number }[]).sort((a, b) => a.index - b.index);
    } else {
      const choices = data.choices as { finish_reason?: string; message?: { role?: string; content?: unknown; tool_calls?: unknown[] } }[];
      check(Array.isArray(choices) && choices.length === 1, 'chat_choice_count_invalid');
      const choice = choices[0]!;
      check(choice && ['stop', 'tool_calls'].includes(choice.finish_reason ?? '') && choice.message?.role === 'assistant', 'chat_incomplete_or_filtered');
      const calls = choice.message.tool_calls;
      check(calls === undefined || Array.isArray(calls), 'chat_tool_calls_invalid');
      check((choice.finish_reason === 'tool_calls') === !!calls?.length, 'chat_finish_reason_mismatch');
      check(calls?.length || (typeof choice.message.content === 'string' && choice.message.content.trim()), 'empty_chat_output');
    }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
export function makeModels(c: ModelConfig, budget: ModelBudget, deps: { credential?: TokenCredential; transport?: typeof fetch } = {}) {
  validateRuntimeEnvironment();
  const checked = loadModels({ ...process.env, AZURE_OPENAI_AUTH_MODE: c.mode, AZURE_OPENAI_ENDPOINT: c.endpoint,
    AZURE_OPENAI_API_KEY: c.key || undefined, AZURE_OPENAI_EMBEDDING_MODEL: c.embedding,
    AZURE_OPENAI_PLANNER_MODEL: c.planner, AZURE_OPENAI_SYNTH_MODEL: c.synth,
    AZURE_OPENAI_EMBEDDING_API_VERSION: c.embeddingVersion, AZURE_OPENAI_PLANNER_API_VERSION: c.plannerVersion,
    AZURE_OPENAI_SYNTH_API_VERSION: c.synthVersion, EMBEDDING_DIMENSIONS: String(c.dimensions),
    MODEL_TIMEOUT_MS: String(c.timeout), MAX_MODEL_REQUESTS: String(c.maxRequests),
    MAX_MODEL_INPUT_CHARS: String(c.maxInputChars), MAX_OUTPUT_TOKENS: String(c.maxTokens),
    ALLOW_PAID_MODELS: c.paidConsent ? 'I_ACCEPT_MODEL_CHARGES' : undefined });
  check(checked.paidConsent && budget.config === c, 'paid_model_consent_or_budget_mismatch');
  const cred = c.mode === 'entra' ? deps.credential ?? credential(c.timeout) : undefined;
  const auth = c.mode === 'api-key' ? { azureOpenAIApiKey: c.key } : {
    azureOpenAIApiKey: '', azureADTokenProvider: async () => (await acquireToken(cred!, MODEL_AUDIENCE, budget.signal)).accessToken
  };
  const shared = { ...auth, azureOpenAIBasePath: `${c.endpoint}/openai/deployments`,
    azureOpenAIEndpoint: c.endpoint, apiKey: '', maxRetries: 0, maxConcurrency: 1, timeout: c.timeout,
    configuration: { fetch: modelFetch(c, budget, deps.transport), maxRetries: 0, organization: '', project: '' } };
  const embeddings = new AzureOpenAIEmbeddings({ ...shared, model: c.embedding, encodingFormat: 'float',
    azureOpenAIApiEmbeddingsDeploymentName: c.embedding, azureOpenAIApiVersion: c.embeddingVersion, batchSize: 1 });
  const chat = (deployment: string, version: string) => new AzureChatOpenAI({ ...shared,
    model: deployment, azureOpenAIApiDeploymentName: deployment, azureOpenAIApiVersion: version,
    temperature: 0, maxTokens: c.maxTokens, useResponsesApi: false, streaming: false });
  return { embeddings, planner: chat(c.planner, c.plannerVersion), synth: chat(c.synth, c.synthVersion) };
}
