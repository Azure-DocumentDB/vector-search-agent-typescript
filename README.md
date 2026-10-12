# Vector-search hotel agent — TypeScript

A real Azure OpenAI **planner → validated LangChain tool → Azure DocumentDB vector search → planner → synthesizer** demo. It does not substitute deterministic answers when a model, tool or database fails.

**Status:** offline regression gates pass; this revision's managed native/Entra and real model end-to-end gates remain **unverified** until recorded in [TESTED.md](TESTED.md). Model availability depends on region, subscription eligibility, deployment and quota. Offline mocks are not evidence of live service readiness or recommendation quality.

## Requirements

- Node **24.21.0+ within Node24**, npm; real TypeScript compilation (no experimental type stripping).
- Public-Azure DocumentDB Mongo API with vector-IVF support, trusted TLS certificate, network permission and a **dedicated disposable database/collection**.
- Azure OpenAI embedding deployment (for example `text-embedding-3-small`, default1536 dimensions) and two tool-capable chat deployment names (for example `gpt-4.1-mini`). Separate planner/synthesis deployments may use the same underlying model. Configure three independent API versions; `2024-10-21` is the example, not a universal compatibility promise.
- Native Mongo credentials or Entra principal with DB permissions. Azure OpenAI API key or Entra role granting inference (typically Cognitive Services OpenAI User). Entra uses `DefaultAzureCredential`; locally `az login` is an option. No credentials are stored by this program.

```sh
npm ci --ignore-scripts
npm run lint
npm test
npm audit --audit-level=low
cp .env.example .env
```

Edit `.env`; it is ignored by Git. Never commit keys, tokens, connection strings, or real endpoint/account records. The placeholder file intentionally **cannot run unchanged**. Existing process environment wins over `.env`; unset stale variables before changing auth modes.

## Safe target and authentication

Use a fresh name such as `agent_disposable_20261012_a1b2c3d4` and explicit `MONGO_COLLECTION=hotels`. Database names must start `agent_disposable_` and have an8–45character lowercase/digit/underscore suffix; collection names are strict lowercase identifiers.

`MONGO_AUTH_MODE=native` requires a percent-encoded `mongodb://user:password@EXACT_HOST:PORT/` connection string. `MONGO_HOST` must be the exact managed `*.mongocluster.cosmos.azure.com` endpoint; port must be10260 (omission selects10260; every other value is rejected). **Get the supported direct hostname from your service; this sample does not discover it.** Entra uses `MONGO_AUTH_MODE=entra`, the same explicit host/port and optional `MONGO_OIDC_USERNAME`; unset the native URI.

This demo deliberately uses **direct connections**, mandatory certificate/hostname-verified TLS, no SRV discovery/topology redirects, no arbitrary URI options, no loopback bypass, and an exact OIDC allowed host. It prioritizes credential destination constraints over topology discovery/failover; it is **not a production high-availability client**. Other clouds/endpoints require reviewed code changes, not a disable-validation flag. Native and model auth modes are independent; mixed credentials in one service's mode fail closed.

Tokens are acquired for fixed DB (`https://ossrdbms-aad.database.windows.net/.default`) and model (`https://cognitiveservices.azure.com/.default`) scopes, not server-supplied audiences. JWT audience, expiry, not-before and SDK expiry are checked before use; lifetime is seconds, not milliseconds. This is defensive claim checking on a token acquired from the trusted Azure Identity provider, **not local cryptographic JWT signature verification**; the receiving service verifies tokens. Near-expiry/null tokens fail. Custom identity endpoints/authorities, proxy overrides, unverified TLS and SDK tracing overrides are refused.

## Commands and cost

All runtime commands use the single compiled `dist/cli.js` entry point. The old per-model/direct-cleanup scripts were removed so they cannot bypass safety gates.

- `npm run auth`: validates configuration, pings only the configured DB and, in model-Entra mode, obtains/checks an audience/expiry-valid token. **No embedding/chat inference, no writes, no database enumeration.** API-key presence is reported as **unverified**, not authenticated; a token does not prove model deployment/RBAC readiness.
- `npm run upload`: validates1–50hotel records, embeds missing records and inserts with deterministic IDs. Supply `DATA_FILE_WITHOUT_VECTORS` using [pinned data instructions](data/README.md), or a small JSON array with `HotelId`, `HotelName`, `Description`. Extra upstream fields are intentionally omitted. Creates fixed COS/IVF index (`numLists=1`); unsupported index creation fails explicitly.
- `npm start`: planner uses validated natural-language search arguments; tool embeds queries and runs a fixed DB pipeline; synthesis receives **all successful structured search results**. Unknown tools, malformed arguments, duplicate IDs, no tool evidence, empty results, truncated/filtered model output and transport errors fail with exit1. No user/model Mongo query object is ever executed. Prompt injection can still affect generated prose; do not treat recommendations as authorization or verified facts.
- `npm run cleanup`: requires both exact-target consents; validates every record before deleting only exact snapshot-matched owned IDs/content. **Never drops a database, collection or index.** Refuses foreign/modified data; repeat cleanup deletes0. Empty collection/index metadata remains for the resource owner to retire separately.
- `npm run test:live`: explicit, billable end-to-end gate described below; never run by CI.

**Writes require** `ALLOW_WRITES=EXACT_DATABASE.EXACT_COLLECTION`. Cleanup additionally requires `CONFIRM_CLEANUP` equal to that exact target. There are no default writes or broad cleanup commands. Seed reruns are insert-only/idempotent and skip embeddings for unchanged rows. Changed input/foreign records are refused; partial network failures may leave owned rows. Re-run safely after checking the cause, or clean the exact scope. Dedicated scope and no concurrent writers are required; hash markers are safety checks, not tenant authorization. A concurrent foreign insert is never deliberately deleted; cleanup detects remaining/changed rows and fails rather than claiming complete success.

**All paid operations require** `ALLOW_PAID_MODELS=I_ACCEPT_MODEL_CHARGES`. Defaults per process:12HTTP model requests,60000total request-body characters,512maximum output tokens per chat,20s/request and90s/run. At most4tool calls; no automatic model retries or streaming. Caps have finite maximums; raise `MAX_MODEL_REQUESTS` deliberately for a50record upload (at most64). Request/character caps are conservative engineering bounds, **not a dollar/token billing guarantee**. Failed calls may still incur charges; review Azure prices/quotas. SIGINT/SIGTERM cancels model work and closes DB; an interrupted live cleanup may need explicit rerun.

Only a fixed Azure endpoint, exact deployment path and requested API version are allowed per request. API keys use `api-key`; Entra uses `Authorization: Bearer`. Redirects are refused. Provider error bodies, SDK exceptions and connection strings are not printed. CLI error codes are intentionally terse. Do not add raw error/debug dumps to public reports.

## Opt-in live gate

Run once with DB native + model API key, and again with DB Entra + model Entra, using **different fresh databases**. Supply credentials privately in environment or a mode0600environment file outside the repository; never on shell command lines/history.

```sh
# After securely configuring host, credentials, deployments and API versions:
export MONGO_DATABASE="agent_disposable_$(date -u +%Y%m%d)_$(openssl rand -hex 4)"
export MONGO_COLLECTION=hotels
export ALLOW_WRITES="$MONGO_DATABASE.$MONGO_COLLECTION"
export CONFIRM_CLEANUP="$ALLOW_WRITES"
export LIVE_CONFIRM="$ALLOW_WRITES"
export ALLOW_PAID_MODELS=I_ACCEPT_MODEL_CHARGES
npm run auth
npm run test:live
```

The live gate requires an empty collection; seeds3synthetic hotels with real embeddings, repeats seed and checks zero additional embeddings/inserts, creates IVF, runs the real planner/tool/DB/synthesis path, asserts nonempty tool search hits and bounded model requests, requires the answer to name at least one retrieved hotel, cleans exact owned rows in `finally`, and proves repeated cleanup deletes0. Nonzero failure is never a pass. Cleanup uses the run deadline: cancellation can leave owned rows requiring `npm run cleanup` under fresh explicit consent. The hotel-name reference check is not factuality certification; the parent must independently inspect the answer against returned evidence. A successful model-only HTTP probe is **not** this gate. Record mode, revision, API/deployment versions, command, exits, model requests, tool evidence and cleanup; omit credentials and identifying endpoint details.

## Tests and design

`npm test` compiles TypeScript and uses Node's test runner. HTTP loopback fixtures exercise the **actual installed LangChain Azure OpenAI SDK and structured tool protocol**, not mocks of every layer. Fixtures rewrite destinations only inside test-injected transport; there is no production test URL env flag. DB lifecycle tests use an in-memory collection double and inspect exact Mongo commands; only the live gate proves actual DB behavior. `npm run lint` is strict compiler/no-unused checking, not a separate stylistic linter.

CI has read-only repository permissions, SHA-pinned GitHub-owned actions, no secrets or cloud calls. Dependency install/audit and GitHub setup require network; tests need only loopback HTTP. See [TESTED.md](TESTED.md), [UPSTREAM.md](UPSTREAM.md) and [MIT license](LICENSE.md).
