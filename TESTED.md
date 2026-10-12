# Verification record

## Offline repair verification — 2026-10-12

- Trusted base: `905ba47efda071f3fce7cd1540fb076356818a55` from owner repository `Azure-DocumentDB/vector-search-agent-typescript`.
- Runtime: Node24.21.0, npm11.19.0, TypeScript7.0.2; real `tsc` compilation.
- Exact dependencies: Azure Identity4.13.3, LangChain Core1.2.17/OpenAI1.6.2, MongoDB7.7.0, Zod4.6.7, Node types24.19.2; lockfile committed.
- `npm ci --ignore-scripts`, `npm run build`, `npm run lint`, `npm test`, `npm audit --audit-level=low`: **PASS** in a lockfile-clean install. Tests: **106 passed, 0 failed, 0 skipped**. Full npm audit: **0 vulnerabilities**.
- Request-contract tests use a real loopback HTTP fixture with the actual LangChain Azure OpenAI SDK. Synthetic key/JWT only; no model billing or Azure connection.
- Planner tests exercise real SDK tool binding, multiple tool calls, full ToolMessage sequencing/artifacts and synthesis; the HTTP model outputs and DB results are deterministic fixtures, not recommendation-quality evidence.
- Data tests use a collection double. They prove command construction, preflight ownership checks and idempotent control flow, not managed-DB compatibility.
- Audit is point-in-time registry evidence, not a guarantee against all vulnerabilities.

## Live acceptance — UNVERIFIED for this revision

Do not mark this sample's full live gate passed based on offline fixtures, an older revision, or standalone model probes.

Required independent gate rows:

| Gate | Status |
|---|---|
| Managed native DB + Azure OpenAI API key; seed/rerun/planner/tool/DB/synthesis/cleanup | UNVERIFIED |
| Managed Entra DB + Azure OpenAI Entra; same full sequence | UNVERIFIED |
| Exact generated scope empty afterward; foreign data safety | Offline safety tests only; live UNVERIFIED |
| Semantic recommendation quality | Not evaluated |

Earlier WestUS2 S0 eligibility was a deployment blocker. Parent later reports successful EastUS2 standalone real embedding/chat requests in both modes; that does not certify this repository's complete agent path. The parent release reviewer owns eligible resources, private credentials, full live execution and publication decision. No Azure operations or paid model calls were made by this repair worker.

## Scope limitations

Fixed COS/IVF, maximum50hotels, single disposable collection, direct managed endpoint, public Azure only. No HNSW/DiskANN claim, failover/SRV support, arbitrary tool execution, production tenant isolation, automatic retries, or dollar-exact budget guarantee. Cleanup leaves collection/index metadata and refuses any unexpected data. Runtime logs contain only safe error codes, structured synthetic evidence and generated answer; callers must keep real user inputs/results private where appropriate.

## Independent-review correction — 2026-10-12

Managed Mongo port10260 is now a constraint, not merely a default. Matching URI/config ports443and27017 are rejected in native and Entra modes before client construction or token acquisition, including direct constructor calls. The live gate additionally asserts nonempty per-tool search hits, consistent tool count, bounded model request count and an answer naming at least one retrieved hotel. This is intentionally not a factuality guarantee; parent review of actual answers remains required. Build/lint/tests and full npm audit repeated:106pass,0fail/skip;0vulnerabilities. Live env/JSON contract unchanged.
