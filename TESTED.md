# Verification record

## Offline repair verification — 2026-10-12

- Trusted base: `905ba47efda071f3fce7cd1540fb076356818a55` from owner repository `Azure-DocumentDB/vector-search-agent-typescript`.
- Runtime: Node24.21.0, npm11.19.0, TypeScript7.0.2; real `tsc` compilation.
- Exact dependencies: Azure Identity4.13.3, LangChain Core1.2.17/OpenAI1.6.2, MongoDB7.7.0, Zod4.6.7, Node types24.19.2; lockfile committed.
- `npm ci --ignore-scripts`, `npm run build`, `npm run lint`, `npm test`, `npm audit --audit-level=low`: **PASS** in a lockfile-clean install. Tests: **114 passed, 0 failed, 0 skipped**. Full npm audit: **0 vulnerabilities**.
- Request-contract tests use a real loopback HTTP fixture with the actual LangChain Azure OpenAI SDK. Synthetic key/JWT only; no model billing or Azure connection.
- Planner tests exercise real SDK tool binding, multiple tool calls, full ToolMessage sequencing/artifacts and synthesis; the HTTP model outputs and DB results are deterministic fixtures, not recommendation-quality evidence.
- Data tests use a collection double. They prove command construction, preflight ownership checks and idempotent control flow, not managed-DB compatibility.
- Audit is point-in-time registry evidence, not a guarantee against all vulnerabilities.

## Genuine managed end-to-end validation — 2026-10-12

Passed on an isolated Azure DocumentDB M30 in West US2 (one shard,128GiB, MongoDB8.0 compatibility, no HA) and an Azure OpenAI account in East US2. Both resources were restricted to the test client IP. Three synthetic hotels only; no customer data. TLS certificates/hostnames remained verified.

Models: `text-embedding-3-small`, version1,1536dimensions; planner and synthesizer `gpt-4.1-mini`, version2025-04-14. Independently configured deployments used API2024-10-21. Both native database/API-key model authentication and Entra database/Entra model authentication passed. These were genuine model requests and real database writes/queries—not a mock or precomputed fallback.

Tested implementation: `ea8c68ed21129a57c5d4013937c09f35cb96d13b`. **Both complete auth-mode gates passed**, each with seven real model HTTP requests and one validated tool call: three seed embeddings, planner request, query embedding, planner completion and synthesis. Repeat seed inserted0/unchanged3 and made no additional model requests. Returned hotel IDs/names and finite scores were inspected; each answer referenced actual retrieved hotel names. Scoped cleanup deleted3owned rows and a second cleanup deleted0. The direct Azure service DNS endpoint was resolved from the managed SRV record and independently verified on port10260 with TLS1.3. This direct-connection mode does not promise SRV failover.

Actual `auth` commands passed native/API-key and Entra/Entra without paid inference. Wrong password, disabled write consent, disabled model consent and unsafe database scope failed nonzero. Cleanup refused a real foreign sentinel and preserved it unchanged. All owned test collections were independently verified empty after live gates.

The generated recommendations were based on the supplied three-hotel evidence and named retrieved hotels. Some prose inferred likely quietness from urban/lakeside descriptions; this is not evidence of verified hotel facts or a general factuality/grounding guarantee. Users must review generated prose. Offline tests exercise invalid tools, empty/failed retrieval and malformed output; they do not establish universal prompt-injection resistance.

The earlier WestUS2 OpenAI provisioning error was regional; the supported EastUS2 resource and both real authentication modes succeeded. No claim of universal subscription ineligibility is retained.

## Scope limitations

Fixed COS/IVF, maximum50hotels, single disposable collection, direct managed endpoint, public Azure only. No HNSW/DiskANN claim, failover/SRV support, arbitrary tool execution, production tenant isolation, automatic retries, or dollar-exact budget guarantee. Cleanup leaves collection/index metadata and refuses any unexpected data. Runtime logs contain only safe error codes, structured synthetic evidence and generated answer; callers must keep real user inputs/results private where appropriate.

## Independent-review correction — 2026-10-12

Managed Mongo port10260 is now a constraint, not merely a default. Matching URI/config ports443and27017 are rejected in native and Entra modes before client construction or token acquisition, including direct constructor calls. The live gate additionally asserts nonempty per-tool search hits, consistent tool count, bounded model request count and an answer naming at least one retrieved hotel. This is intentionally not a factuality guarantee; parent review of actual answers remains required. Build/lint/tests and full npm audit repeated:106pass,0fail/skip;0vulnerabilities. Live env/JSON contract unchanged.

## Managed-search response correction — 2026-10-12

Parent live native auth passed; the initial real agent run failed ownership validation because managed Azure adds an object named `__cosmos_meta__` to `$search`/`returnStoredSource` results. Parent verified original stored fields unchanged and cleaned all3owned records. This revision strips only that known object from aggregate-result validation, not from stored reads. Persisted metadata, other extra fields, modified hotel/owner/vector/hash and malformed search metadata remain errors; inspect/seed/cleanup validation is unchanged. Eight new regressions bring the suite to114pass,0fail/skip; build/lint and full npm audit pass with0vulnerabilities. Both full live gates were rerun successfully after this fix, as recorded above.
