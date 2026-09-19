# DeepSeek compatibility patch set

Local patch set for this fork (`Leca00711/minimax-code`, branch `deepseek-compat`). It targets the
gaps found while running the CLI with a BYOK DeepSeek provider (`deepseek-flash`,
`deepseek-v4-pro` via `https://api.deepseek.com`, `openai-completions`). Every item below was
verified against the live API, not inferred.

Baseline: `0.4.12` source preview. The patch set was authored on `e3724a1` and **rebased onto
upstream `main` at `a5639bc`** (13 upstream commits) with no conflicts in the patched files.

## 1. `max_tokens` instead of `max_completion_tokens` (compat)

DeepSeek accepts `max_completion_tokens` but **silently ignores it**, so the configured output
limit never applied (a 16-token cap produced 26 completion tokens, reasoning included).

- `third_party/pi-mono/packages/ai/src/providers/openai-completions.ts` — `detectCompat()`
  now treats DeepSeek as a `max_tokens` provider (`useMaxTokens`), covering any BYOK base URL
  that contains `deepseek.com`.
- `third_party/pi-mono/packages/ai/scripts/generate-models.ts` — `deepseekCompat` declares
  `maxTokensField: "max_tokens"` explicitly.
- `third_party/pi-mono/packages/ai/src/models.generated.ts` — the two `deepseek` entries carry
  the same field. Hand-edited: a full `generate-models` regeneration currently rewrites ~19k
  lines of unrelated models.dev drift, so the data change was applied surgically.

## 2. `low` reasoning level for DeepSeek V4

The catalog marked `low` as unsupported (`null`), but the API accepts it and it measurably
reduces reasoning tokens (3 runs per level on `deepseek-flash`, same prompt: low 216, high 275,
max 306 reasoning tokens on average, same answer).

- `generate-models.ts` — `DEEPSEEK_V4_THINKING_LEVEL_MAP.low` is now `"low"` (minimal/medium
  stay `null`; there is no measurement backing them).
- `models.generated.ts` — same change on the two `deepseek` entries.
- `deepseek-flash` alias entry added (the API exposes both `deepseek-flash` and
  `deepseek-v4-flash`) so catalog lookups by id — including cost — resolve for both names.

## 3. Real spend for BYOK models

Both resolvers hardcoded `cost: { 0, 0, 0, 0 }` for BYOK/custom providers, so DeepSeek sessions
always reported $0. `pi-ai` already converts `model.cost` into `usage.cost`
(`third_party/pi-mono/packages/ai/src/models.ts`).

- `packages/local-runtime/src/runtime/model-catalog.ts` — new `lookupLocalCatalogCost()`
  (provider + id first, then provider base-URL host + id).
- `packages/local-runtime/src/runtime/model-resolver.ts` — uses it for the resolved model.
- `packages/local-runtime-v2/src/service/model-system/resolution/local-model-resolver.ts` —
  same resolution in `resolveModelCost()` (catalog model, then host + id, then zero fallback).

Verified by unit test (`local-model-resolver.test.ts`): `deepseek-flash` resolves to
`{ input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 }`, `deepseek-v4-pro` to
`{ 0.435, 0.87, 0.003625, 0 }`, unknown ids keep the zero fallback. The second half of the loop
is covered too: `calculateCost(model, usage)` on the `deepseek-flash` entry produces
`0.14 / 0.14 / 0.0056 / 0.2856` for a 1M input + 0.5M output + 2M cache-read sample.

## 4. No futile OpenAI Responses token count on DeepSeek

`api.deepseek.com` answers 404 for `/v1/responses/input_tokens`; the runtime issued two such
requests per turn before falling back to local BPE estimation.

- `packages/local-runtime/src/context/token-counter-adapters/responses.ts` — the generic
  Responses counter declines hosts listed as unsupported (`api.deepseek.com`, `deepseek.com`,
  matched on the base URL the same way `detectCompat()` does).

Verified end-to-end: before the patch a headless run produced 4 requests to
`/v1/responses/input_tokens` (all 404); after it, only the single `/chat/completions` call.

## Not patched (documented behavior)

- Custom providers force `thinkingFormat: "openai"` in the runtime, so no explicit
  `thinking: { type: "enabled" }` is sent. DeepSeek still thinks by default and honors
  `reasoning_effort` (including `"none"` for off), so this is cosmetic. Declaring
  `compat.thinkingFormat: deepseek` in `config.yaml` restores the explicit field.
- `tool_choice: "required"` returns 400 in thinking mode (DeepSeek limitation). The TUI does
  not force a tool choice in normal operation, so this is only reachable through MCP sampling.
- The runtime replays `reasoning_content` (required by DeepSeek when a thinking-mode assistant
  message carries tool calls); this already worked and is covered by the regression test.

## Rebase log

- `a5639bc` (upstream `main`, 13 commits ahead of `e3724a1`): rebased cleanly. Only
  `release/public-source.json` and `test/vitest-suites.json` overlap, and both merged without
  conflicts because the additions landed in different regions; `pnpm check:source` passes with
  4187 files after the rebase.
- Upstream `#201` ("import reasoning effort options from provider presets") changed how *declared*
  effort options are imported from models.dev presets. It does **not** replace patch 2:
  `provider-presets.service.ts` now reads `reasoning_options` for presets, while
  `getSupportedThinkingLevels()` in `pi-ai/src/models.ts` still gates the usable levels through
  `model.thinkingLevelMap` — which is exactly what patch 2 edits. Custom providers keep taking
  their options from `config.yaml` (`thinking.effortOptions`), unchanged.

## Validation

```bash
# vendored pi compat
cd third_party/pi-mono/packages/ai
npx vitest run test/openai-completions-deepseek-compat.test.ts
npx vitest run test/openai-completions

# runtime patch set
cd ../../..
npx vitest run --config vitest.oss.config.mjs packages/local-runtime-v2/src/service/model-system/resolution/local-model-resolver.test.ts
npx vitest run --config vitest.oss.config.mjs packages/local-runtime/test/unit/token-counter-adapters.test.ts
pnpm test:capabilities   # full gate (3514/3515; the failing tui-keybindings case fails on a clean checkout too)

# build and run the patched CLI
pnpm build
node dist/cli.js --version
```

## Safety net

The `compat` block in `~/.minimax/config.yaml` stays in place. It is data, not code, so the
installed npm CLI keeps working with DeepSeek even if this fork is not rebuilt or is rebased.

## Rebase note

Only the three pi-mono files plus four runtime files are touched (plus two test files, the source
inventory and the Vitest suite list). Keeping the diff small is deliberate: `generate-models.ts`
carries the intent so a future regeneration reproduces the data changes.
