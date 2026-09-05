import { gateway } from 'ai';
import type { ModelSpec } from './types';

// IDs en formato Vercel AI Gateway ("vendor/model"). Los IDs cambian con cada
// release: ejecuta `npm run models` para listar los disponibles en tu cuenta y
// corrige aquí lo que haga falta. `verified: false` = no confirmado contra el
// gateway en el momento de escribir esto.
//
// `pin` fija el proveedor upstream para modelos de pesos abiertos: sin él, el
// gateway puede enrutar dos runs del "mismo modelo" a hosts distintos con
// distinta calidad de tool calling. Mira los proveedores disponibles por modelo
// en la salida de `npm run models`.

export const MODELS: ModelSpec[] = [
  // Frontera. verified: true = id confirmado con `npm run models` el 2026-09-02.
  { id: 'anthropic/claude-fable-5.1', label: 'Claude Fable 5.1', vendor: 'Anthropic', family: 'frontera', verified: true },
  { id: 'anthropic/claude-opus-5', label: 'Claude Opus 5', vendor: 'Anthropic', family: 'frontera', verified: true },
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', vendor: 'Anthropic', family: 'frontera', verified: true },
  { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5', vendor: 'Anthropic', family: 'frontera', verified: true },
  // GPT-5.6 en sus tres tamaños: Sol (buque insignia, razonamiento y agentes de largo recorrido),
  // Terra (intermedio) y Luna (ligero y barato). Los tres soportan tool calling.
  { id: 'openai/gpt-6-astra', label: 'GPT-6 Astra', vendor: 'OpenAI', family: 'frontera', verified: true },
  { id: 'openai/gpt-5.6-sol', label: 'GPT-5.6 Sol', vendor: 'OpenAI', family: 'frontera', verified: true },
  { id: 'openai/gpt-5.6-terra', label: 'GPT-5.6 Terra', vendor: 'OpenAI', family: 'frontera', verified: true },
  { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna', vendor: 'OpenAI', family: 'frontera', verified: true },
  // El gateway no tiene "gemini-3.1-pro" a secas; el Pro más reciente es el preview.
  // Google no tiene Pro posterior; 3.8 Flash es su modelo más nuevo y el par natural de Luna/Haiku.
  { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview', vendor: 'Google', family: 'frontera', verified: true },
  { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', vendor: 'Google', family: 'frontera', verified: true },

  // China (pesos abiertos, servidos por terceros → fija `pin`).
  // Donde existe, usamos el id con fecha: el alias sin fecha recibe pesos nuevos con el tiempo
  // y dos lotes separados por semanas dejarían de ser comparables.
  { id: 'deepseek/deepseek-v4-pro-0813', label: 'DeepSeek V4 Pro (0813)', vendor: 'DeepSeek', family: 'china', verified: true },
  { id: 'deepseek/deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash (0731)', vendor: 'DeepSeek', family: 'china', verified: true },
  { id: 'zai/glm-5.3', label: 'GLM 5.3', vendor: 'Zhipu (Z.ai)', family: 'china', verified: true },
  { id: 'alibaba/qwen3.8-max-0902', label: 'Qwen 3.8 Max (0902)', vendor: 'Alibaba', family: 'china', verified: true },
  { id: 'moonshotai/kimi-k3', label: 'Kimi K3', vendor: 'Moonshot', family: 'china', verified: true },
];

export function findModel(id: string): ModelSpec | undefined {
  return MODELS.find((m) => m.id === id);
}

// ---- precios ---------------------------------------------------------------

type Pricing = { input: number; output: number }; // USD por token
let cache: Map<string, Pricing> | null = null;
let cacheAt = 0;

/** Precios por token publicados por el gateway (cacheados 1h). */
export async function gatewayPricing(): Promise<Map<string, Pricing>> {
  if (cache && Date.now() - cacheAt < 3600_000) return cache;
  const map = new Map<string, Pricing>();
  try {
    const res = await gateway.getAvailableModels();
    for (const m of res.models as any[]) {
      const p = m.pricing;
      if (p?.input != null && p?.output != null) {
        map.set(m.id, { input: Number(p.input), output: Number(p.output) });
      }
    }
  } catch (err) {
    console.warn('[models] no se pudo leer el catálogo del gateway:', (err as Error).message);
  }
  cache = map;
  cacheAt = Date.now();
  return map;
}

export async function estimateCost(spec: ModelSpec, input: number, output: number): Promise<number | undefined> {
  const p = (await gatewayPricing()).get(spec.id);
  if (p) return input * p.input + output * p.output;
  if (spec.fallbackPricing) return (input * spec.fallbackPricing.input + output * spec.fallbackPricing.output) / 1e6;
  return undefined;
}
