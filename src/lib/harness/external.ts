// Runs producidos fuera del bucle genérico (Claude Agent SDK, Autopilot u otro agente
// conectado al servidor MCP del harness). Se puntúan con el mismo score() y se guardan
// como runs normales, en un lote propio, para que la UI y los informes los traten igual.
import { randomUUID } from 'node:crypto';
import type { Batch, ModelSpec, RunResult, Scenario, Submission, ToolCallRecord } from './types';
import { score } from './scoring';
import { loadBatch, saveBatch, saveResult } from './store';

/** Lo que escribe scripts/mcp-server.ts en BENCH_TRACE mientras el agente trabaja. */
export interface Trace {
  scenarioId: string;
  startedAt: string;
  toolCalls: ToolCallRecord[];
  catalogViolations: string[];
  submission?: Submission;
  /** primera respuesta de cada llamada, recortada, por si hay que revisar la traza a mano */
  previews: { step: number; name: string; preview: string }[];
}

export function emptyTrace(scenarioId: string): Trace {
  return { scenarioId, startedAt: new Date().toISOString(), toolCalls: [], catalogViolations: [], previews: [] };
}

export interface ExternalRunMeta {
  /** id del modelo en la UI; conviene un sufijo para no mezclarlo con el gateway, p.ej. anthropic/claude-sonnet-5@agent-sdk */
  modelId: string;
  label: string;
  vendor?: string;
  batchId: string;
  latencyMs: number;
  usage?: { input: number; output: number };
  /** coste conocido (USD) o tarifa por millón de tokens para estimarlo */
  costUsd?: number;
  pricing?: { input: number; output: number };
  finalText?: string;
  steps?: number;
  error?: string;
  /** el adaptador envió el recordatorio final (misma regla que runner.ts) */
  nudged?: boolean;
  /** cómo terminó el bucle cuando la traza no basta para saberlo (p.ej. max_steps al agotar turnos) */
  stopReason?: RunResult['stopReason'];
}

/** Puntúa una traza y la convierte en RunResult. */
export function buildExternalRun(scenario: Scenario, trace: Trace, meta: ExternalRunMeta): RunResult {
  const model: ModelSpec = { id: meta.modelId, label: meta.label, vendor: meta.vendor ?? 'Anthropic', family: 'frontera', verified: true };
  const usage = { input: meta.usage?.input ?? 0, output: meta.usage?.output ?? 0, total: (meta.usage?.input ?? 0) + (meta.usage?.output ?? 0) };
  let costUsd = meta.costUsd;
  let costSource: RunResult['costSource'] = costUsd != null && costUsd > 0 ? 'gateway' : 'unknown';
  if ((costUsd == null || costUsd === 0) && meta.pricing && usage.total > 0) {
    costUsd = (usage.input * meta.pricing.input + usage.output * meta.pricing.output) / 1e6;
    costSource = 'pricing';
  }
  const ok = !meta.error;
  const stopReason: RunResult['stopReason'] = meta.error ? 'error' : trace.submission ? 'submitted' : meta.stopReason ?? (meta.finalText ? 'no_call_text' : 'no_call_silent');
  return {
    id: randomUUID(),
    timestamp: trace.startedAt,
    batchId: meta.batchId,
    model,
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    ok,
    error: meta.error,
    steps: meta.steps ?? trace.toolCalls.length,
    toolCalls: trace.toolCalls,
    submission: trace.submission,
    catalogViolations: trace.catalogViolations,
    stopReason,
    usage,
    costUsd: costUsd != null && costUsd > 0 ? costUsd : undefined,
    costSource,
    latencyMs: meta.latencyMs,
    score: ok
      ? score(scenario, trace.submission, trace.toolCalls, trace.catalogViolations)
      : { total: 0, rootCause: 0, actions: 0, efficiency: 0, safety: 0, details: [`Run fallido: ${(meta.error ?? '').slice(0, 200)}`] },
    finalText: meta.finalText,
    nudged: meta.nudged,
  };
}

/** Guarda el run y lo añade (creando el lote si hace falta) a results/batches/<batchId>.json. */
export async function saveExternalRun(run: RunResult): Promise<Batch> {
  await saveResult(run);
  const existing = await loadBatch(run.batchId!);
  const batch: Batch = existing ?? {
    id: run.batchId!,
    createdAt: run.timestamp,
    models: [],
    scenarios: [],
    runsPer: 1,
    runIds: [],
    status: 'done',
    judgeCostUsd: 0,
  };
  if (!batch.models.includes(run.model.id)) batch.models.push(run.model.id);
  if (!batch.scenarios.includes(run.scenarioId)) batch.scenarios.push(run.scenarioId);
  batch.runIds.push(run.id);
  await saveBatch(batch);
  return batch;
}
