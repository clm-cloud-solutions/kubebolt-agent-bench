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

/** id con el que se llama al gateway (las variantes llevan sufijo en `id`). */
export const gatewayId = (m: ModelSpec): string => m.gatewayId ?? m.id;

// ---- nivel de razonamiento por run ------------------------------------------
// No se registran variantes en MODELS: el nivel se elige al lanzar (formulario o CLI) y viaja en el id
// del run como sufijo, p.ej. "openai/gpt-6-astra@razonamiento-medio", para que sus runs agreguen aparte.
// El runner lo manda como opción `reasoning` del AI SDK; el gateway lo traduce al formato nativo del
// proveedor que sirva la petición (OpenAI reasoning effort, Claude pensamiento adaptativo, Gemini
// thinkingLevel, presupuesto de thinking en los demás). Sin nivel, `provider-default`: lo que hizo la v1.

export type Razonamiento = NonNullable<ModelSpec['razonamiento']>;
export const NIVELES_RAZONAMIENTO: Razonamiento[] = ['ninguno', 'mínimo', 'bajo', 'medio', 'alto', 'máximo'];
const SLUG: Record<Razonamiento, string> = { ninguno: 'ninguno', mínimo: 'minimo', bajo: 'bajo', medio: 'medio', alto: 'alto', máximo: 'maximo' };
const DESLUG: Record<string, Razonamiento> = Object.fromEntries(Object.entries(SLUG).map(([k, v]) => [v, k as Razonamiento]));
const NIVEL_SDK = { ninguno: 'none', mínimo: 'minimal', bajo: 'low', medio: 'medium', alto: 'high', máximo: 'xhigh' } as const;
const SUFIJO = /^(.+)@razonamiento-([a-z]+)$/;

/** Copia del modelo con un nivel de razonamiento explícito e identidad propia. Sin nivel, el modelo tal cual. */
export function withRazonamiento(spec: ModelSpec, nivel?: Razonamiento): ModelSpec {
  if (!nivel) return spec;
  return { ...spec, id: `${spec.id}@razonamiento-${SLUG[nivel]}`, gatewayId: spec.gatewayId ?? spec.id, razonamiento: nivel, label: `${spec.label} · razonamiento ${nivel}` };
}

/** Valor de la opción `reasoning` del AI SDK para este modelo; undefined = valor por defecto del proveedor. */
export const nivelSdk = (m: ModelSpec): (typeof NIVEL_SDK)[Razonamiento] | undefined => (m.razonamiento ? NIVEL_SDK[m.razonamiento] : undefined);

/** true si el nivel se puede fijar para este modelo: todos los del gateway, que hace la traducción. */
export const razonamientoConfigurable = (_spec: ModelSpec): boolean => true;

/** Resuelve un id del registro o un id con sufijo de razonamiento. */
export function findModel(id: string): ModelSpec | undefined {
  const direct = MODELS.find((m) => m.id === id);
  if (direct) return direct;
  const m = id.match(SUFIJO);
  if (!m) return undefined;
  const base = MODELS.find((x) => x.id === m[1]);
  const nivel = DESLUG[m[2]];
  // sin traducción para ese proveedor, el sufijo sería una etiqueta vacía: se rechaza
  return base && nivel && razonamientoConfigurable(base) ? withRazonamiento(base, nivel) : undefined;
}

const ESFUERZO_OPENAI = { mínimo: 'minimal', bajo: 'low', medio: 'medium', alto: 'high' } as const;
// Claude 5 por el gateway: pensamiento adaptativo con esfuerzo; 'mínimo' lo apaga del todo. Haiku 4.5 no admite el modo adaptativo.
const ESFUERZO_ANTHROPIC = { bajo: 'low', medio: 'medium', alto: 'high' } as const;
const CLAUDE_CON_ESFUERZO = /^anthropic\/claude-(fable|opus|sonnet)-5/;

/** Opciones específicas del proveedor que el gateway reenvía: esfuerzo de razonamiento de OpenAI y pensamiento adaptativo de Claude 5. */
export function providerOptionsFor(m: ModelSpec): Record<string, Record<string, unknown>> {
  if (!m.razonamiento) return {};
  const gid = gatewayId(m);
  if (gid.startsWith('openai/')) return { openai: { reasoningEffort: ESFUERZO_OPENAI[m.razonamiento] } };
  if (CLAUDE_CON_ESFUERZO.test(gid)) {
    if (m.razonamiento === 'mínimo') return { anthropic: { thinking: { type: 'disabled' } } };
    return { anthropic: { thinking: { type: 'adaptive' }, effort: ESFUERZO_ANTHROPIC[m.razonamiento] } };
  }
  return {};
}

// ---- precios ---------------------------------------------------------------

type Pricing = { input: number; output: number; cached?: number }; // USD por token; cached = entrada servida desde caché
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
        map.set(m.id, { input: Number(p.input), output: Number(p.output), ...(p.cachedInputTokens != null ? { cached: Number(p.cachedInputTokens) } : {}) });
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
  const p = (await gatewayPricing()).get(gatewayId(spec));
  if (p) return input * p.input + output * p.output;
  if (spec.fallbackPricing) return (input * spec.fallbackPricing.input + output * spec.fallbackPricing.output) / 1e6;
  return undefined;
}
