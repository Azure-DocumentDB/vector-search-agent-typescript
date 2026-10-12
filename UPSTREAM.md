# Upstream provenance

- Source repository: https://github.com/Azure-Samples/documentdb-samples
- Exact source revision: [f5a2675bbf349737234d0391e3ebee24b260e06f](https://github.com/Azure-Samples/documentdb-samples/commit/f5a2675bbf349737234d0391e3ebee24b260e06f)
- Source directory: [ai/vector-search-agent-typescript](https://github.com/Azure-Samples/documentdb-samples/tree/f5a2675bbf349737234d0391e3ebee24b260e06f/ai/vector-search-agent-typescript)
- Extraction date: 2026-09-30
- License: original Microsoft MIT notice preserved verbatim in [LICENSE.md](LICENSE.md)
- History model: independently maintained source snapshot, not a GitHub fork or ownership transfer

## Standalone adaptations

Source is at repository root. The README is rewritten for that layout, and placeholder-only configuration/data setup replaces reliance on the parent checkout.
- Adapted source file: `.env.example`
- Adapted source file: `README.md`
- Adapted source file: `package.json`
- Adapted source file: `tsconfig.json`

The upstream `README.md` is a Learn quickstart article with `:::code:::` transclusions and `ms.*` front matter; it is replaced by repository-local instructions. `package.json` name/description are set to this repository and the monorepo-only `create-env` azd entry point is removed. `tsconfig.json` carried duplicated npm package fields upstream; only compiler configuration is retained. The default `DATA_FILE_WITHOUT_VECTORS` path changes from `../data/Hotels.json` to `data/Hotels.json` for the standalone layout.

Hotel fixtures are not redistributed: [data/README.md](data/README.md) pins the original input locations and checksums. Saved output, Learn-only quickstart pages, and devcontainer automation are omitted. Shared infrastructure and root monorepo CI are not copied.

The original extraction did not change dependency versions or vector/agent algorithms. The October12,2026 downstream safety repair updates dependencies, replaces the adapter with explicit scoped Mongo operations, and preserves a genuine planner/tool/synthesis flow through the current LangChain SDK. The Go agent module namespace and local data/environment-file paths are adjusted where necessary. Invalid monorepo-only npm entry points are removed rather than advertised as working commands.

## Maintenance

There is no automatic synchronization. Review upstream changes against this pinned baseline, apply only relevant fixes, retain notices, and record the imported revision and local adaptations here.
Issue/PR history is not transferred. The maintainers of the repository hosting this extraction own its downstream fixes; contribute reusable fixes upstream under its contribution policy.

## Downstream safety repair — 2026-10-12

Explicit native/Entra authentication, strict destinations/TLS/audiences, consent-gated paid calls and scoped writes, bounded real agent orchestration, idempotent seed/cleanup, permanent SDK/HTTP regressions and read-only offline CI replace the original unsafe entry points. The optional vector algorithms were narrowed to the tested fixed IVF command rather than silently falling back. Independent deployment/API version settings remain. These are downstream changes, not claims that upstream has adopted them.
