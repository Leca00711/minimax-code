import { getModel, getModels, getProviders, type Api, type Model } from '@earendil-works/pi-ai';

const FALLBACK_MODEL_LIMITS = {
  contextWindow: 200_000,
  maxTokens: 128_000,
} as const;

type CatalogLookup = (provider: string, modelId: string) => Model<Api> | undefined;

export function lookupLocalCatalogModel(provider: string, modelId: string): Model<Api> | undefined {
  return (getModel as unknown as CatalogLookup)(provider, modelId);
}

export function lookupLocalModelLimits(
  provider: string,
  modelId: string,
): {
  contextWindow: number;
  maxTokens: number;
  fromCatalog: boolean;
  api?: Api;
  baseUrl?: string;
} {
  const entry = lookupLocalCatalogModel(provider, modelId);
  if (!entry) {
    return { ...FALLBACK_MODEL_LIMITS, fromCatalog: false };
  }
  const contextWindow =
    typeof entry.contextWindow === 'number' && entry.contextWindow > 0
      ? entry.contextWindow
      : FALLBACK_MODEL_LIMITS.contextWindow;
  const maxTokens =
    typeof entry.maxTokens === 'number' && entry.maxTokens > 0
      ? entry.maxTokens
      : FALLBACK_MODEL_LIMITS.maxTokens;
  const api = typeof entry.api === 'string' ? (entry.api as Api) : undefined;
  const baseUrl = typeof entry.baseUrl === 'string' ? entry.baseUrl : undefined;
  return {
    contextWindow,
    maxTokens,
    fromCatalog: true,
    ...(api ? { api } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
}

/**
 * Catalog cost for a resolved model. Matching runs provider + id first (catalog providers), then
 * provider base-URL host + id, so a BYOK/custom provider that points at a known API (for example
 * https://api.deepseek.com) reports real spend instead of a hardcoded $0.
 */
export function lookupLocalCatalogCost(
  provider: string | undefined,
  modelId: string,
  baseUrl?: string,
): Model<Api>['cost'] | undefined {
  if (provider) {
    const exact = lookupLocalCatalogModel(provider, modelId);
    if (exact) return exact.cost;
  }
  const host = catalogHost(baseUrl);
  if (!host) return undefined;
  for (const candidate of getProviders()) {
    for (const model of getModels(candidate)) {
      if (model.id === modelId && catalogHost(model.baseUrl) === host) {
        return model.cost;
      }
    }
  }
  return undefined;
}

function catalogHost(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
