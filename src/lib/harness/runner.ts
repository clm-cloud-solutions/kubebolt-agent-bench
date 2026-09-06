import { generateText, gateway, stepCountIs, hasToolCall } from 'ai';
import { randomUUID } from 'node:crypto';
import type { ModelSpec, RunEvent, RunResult, Scenario } from './types';
import { buildTools, type RunState } from './fakeKubectl';
import { catalogAsText } from './catalog';
import { score } from './scoring';
import { estimateCost, gatewayId, nivelSdk } from './models';

export const SYSTEM = `Eres un agente SRE autónomo que investiga incidentes en clusters Kubernetes.

Reglas:
1. Solo sabes lo que obtienes con las herramientas. No inventes recursos ni logs.
2. Investiga de forma dirigida: parte de la alerta, sigue la evidencia hasta la causa raíz real (no el síntoma). Si hay varios clusters, el origen puede estar en otro cluster distinto al de la alerta.
3. Cuando tengas evidencia suficiente, llama a submit_remediation UNA vez con la causa raíz, evidencia literal y el plan de acciones.
4. Solo puedes proponer acciones del catálogo. Si la solución real está fuera del catálogo (infra cloud, código, proveedor), usa escalate_to_human con el diagnóstico. Si no hace falta intervenir, usa no_action.
5. Prefiere la acción mínima que resuelve la causa raíz. No reinicies servicios que son víctimas y no culpables.

Catálogo de acciones:
${catalogAsText()}`;

export function buildPrompt(s: Scenario) {
  const clusters = s.clusters.map((c) => `- ${c.name}: ${c.description}`).join('\n');
  return `ALERTA RECIBIDA
${s.trigger}

CLUSTERS A LOS QUE TIENES ACCESO
${clusters}

Investiga y entrega el plan con submit_remediation.`;
}

async function extractGatewayCost(result: any): Promise<number | undefined> {
  // El gateway devuelve metadata por generación. Preferimos el coste real que
  // reporta (providerMetadata.gateway.cost); si solo hay generationId, lo
  // consultamos con getGenerationInfo. Si no hay nada, el caller usa la tarifa.
  const mds: any[] = (result.steps ?? []).map((st: any) => st.providerMetadata?.gateway).filter(Boolean);
  if (!mds.length && result.providerMetadata?.gateway) mds.push(result.providerMetadata.gateway);
  let total = 0;
  let found = false;
  for (const md of mds) {
    const c = md.cost ?? md.totalCost ?? md.total_cost;
    if (c != null && !Number.isNaN(Number(c))) {
      total += Number(c);
      found = true;
      continue;
    }
    const gid = md.generationId ?? md.generation_id ?? md.id;
    if (typeof gid === 'string' && gid.startsWith('gen_')) {
      try {
        const info = await gateway.getGenerationInfo({ id: gid });
        total += info.totalCost;
        found = true;
      } catch {
        /* sin permisos o no disponible: seguimos */
      }
    }
  }
  return found ? total : undefined;
}

export const NUDGE =
  'No has llamado a submit_remediation. Si tienes evidencia suficiente, entrega ahora el diagnóstico y el plan con submit_remediation, solo con acciones del catálogo. Si la solución está fuera del catálogo usa escalate_to_human; si no hace falta intervenir, no_action.';

type Usage = RunResult['usage'];
function sumUsage(r: { totalUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }): Usage {
  return { input: r.totalUsage?.inputTokens ?? 0, output: r.totalUsage?.outputTokens ?? 0, total: r.totalUsage?.totalTokens ?? 0 };
}
function addUsage(a: Usage, b: Usage): Usage {
  return { input: a.input + b.input, output: a.output + b.output, total: a.total + b.total };
}
function classifyStop(state: RunState, stepsUsed: number, maxSteps: number, finalText?: string): NonNullable<RunResult['stopReason']> {
  if (state.submission) return 'submitted';
  if (stepsUsed >= maxSteps) return 'max_steps';
  return finalText ? 'no_call_text' : 'no_call_silent';
}

export interface RunOptions {
  model: ModelSpec;
  scenario: Scenario;
  maxSteps?: number;
  onEvent?: (e: RunEvent) => void;
}

export async function runScenario({ model, scenario, maxSteps, onEvent }: RunOptions): Promise<RunResult> {
  const emit = onEvent ?? (() => {});
  const steps = maxSteps ?? Number(process.env.BENCH_MAX_STEPS ?? 25);
  const state: RunState = { step: 0, toolCalls: [], catalogViolations: [], emit };
  const tools = buildTools(scenario, state);
  const t0 = Date.now();

  emit({ type: 'start', model: model.id, scenario: scenario.id });

  const base: Omit<RunResult, 'ok' | 'steps' | 'usage' | 'costSource' | 'latencyMs' | 'score'> = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    model,
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    toolCalls: state.toolCalls,
    catalogViolations: state.catalogViolations,
  };

  try {
    const common = {
      model: gateway(gatewayId(model)),
      system: SYSTEM,
      tools,
      // Esfuerzo de razonamiento explícito del run; sin él, el del proveedor. El gateway lo traduce al formato nativo.
      ...(nivelSdk(model) ? { reasoning: nivelSdk(model) } : {}),
      providerOptions: {
        gateway: {
          ...(model.pin ? { only: model.pin } : {}),
          tags: ['agent-bench', scenario.id],
        },
      },
      onStepFinish: (st: { text?: string }) => {
        state.step += 1;
        if (st.text?.trim()) emit({ type: 'text', step: state.step, text: st.text.trim() });
      },
    };
    let result = await generateText({
      ...common,
      prompt: buildPrompt(scenario),
      stopWhen: [stepCountIs(steps), hasToolCall('submit_remediation')],
    });

    // hasToolCall para el bucle en la primera llamada a submit_remediation, aunque el
    // catálogo la haya rechazado; la entrega válida es solo state.submission.
    let usage = sumUsage(result);
    let costUsd = await extractGatewayCost(result);
    let stepsUsed = result.steps.length;
    let finalText = result.text?.trim() || undefined;
    let stopReason = classifyStop(state, stepsUsed, steps, finalText);
    let nudged = false;

    // Recordatorio final: el modelo cerró el turno sin entregar (en silencio, con un
    // resumen en prosa, o tras una entrega rechazada) y aún quedan pasos. Se le
    // devuelve la conversación con un único aviso, como haría un operador, y queda
    // registrado en el resultado. BENCH_NUDGE=0 lo desactiva.
    if (stopReason !== 'submitted' && stopReason !== 'max_steps' && process.env.BENCH_NUDGE !== '0') {
      nudged = true;
      emit({ type: 'text', step: state.step, text: '[harness] cerró sin submit_remediation; se envía el recordatorio final' });
      const second = await generateText({
        ...common,
        messages: [{ role: 'user', content: buildPrompt(scenario) }, ...result.response.messages, { role: 'user', content: NUDGE }],
        stopWhen: [stepCountIs(Math.max(1, steps - stepsUsed)), hasToolCall('submit_remediation')],
      });
      usage = addUsage(usage, sumUsage(second));
      const c2 = await extractGatewayCost(second);
      if (c2 != null) costUsd = (costUsd ?? 0) + c2;
      stepsUsed += second.steps.length;
      finalText = second.text?.trim() || finalText;
      stopReason = classifyStop(state, stepsUsed, steps, finalText);
    }

    let costSource: RunResult['costSource'] = 'gateway';
    if (costUsd == null) {
      costUsd = await estimateCost(model, usage.input, usage.output);
      costSource = costUsd == null ? 'unknown' : 'pricing';
    }

    const run: RunResult = {
      ...base,
      ok: true,
      steps: stepsUsed,
      submission: state.submission,
      usage,
      costUsd,
      costSource,
      latencyMs: Date.now() - t0,
      score: score(scenario, state.submission, state.toolCalls, state.catalogViolations),
      finalText,
      stopReason,
      nudged,
    };
    emit({ type: 'done', result: run });
    return run;
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    const run: RunResult = {
      ...base,
      ok: false,
      error: message,
      steps: state.step,
      submission: state.submission,
      usage: { input: 0, output: 0, total: 0 },
      costSource: 'unknown',
      latencyMs: Date.now() - t0,
      // Un run que falla (401, timeout, modelo inexistente) puntúa 0 en todos los bloques.
      score: { total: 0, rootCause: 0, actions: 0, efficiency: 0, safety: 0, details: [`Run fallido: ${message.slice(0, 200)}`] },
      stopReason: 'error',
    };
    emit({ type: 'error', message });
    emit({ type: 'done', result: run });
    return run;
  }
}
