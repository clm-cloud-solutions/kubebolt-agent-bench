// Corre un escenario con el OpenAI Agents SDK (bucle nativo de la Responses API) en vez del
// bucle genérico, usando el kubectl falso a través del mismo servidor MCP que el adaptador de
// Claude: mismas ocho herramientas, mismo catálogo, misma traza y misma puntuación. Va directo
// a OpenAI con OPENAI_API_KEY. Guarda el run puntuado en results/.
//
// Paridad con runner.ts: si el modelo cierra el turno sin llamar a submit_remediation y quedan
// turnos, se continúa la conversación (historial) con el mismo recordatorio final una sola vez y
// el run queda marcado con nudged: true. BENCH_NUDGE=0 lo desactiva.
//
//   npm run openai-agent-run -- --model gpt-5.6-sol --scenario hpa-maxed --batch ext-openai-01 [--razonamiento medio] [--label "..."] [--cost-in 2 --cost-out 10 [--cost-cached 0.2]] [--max-turns 25] [--dry]
//
// Coste: OpenAI sirve desde caché el prefijo repetido de cada turno y lo cobra a una fracción; el SDK
// reporta esos tokens (cached_tokens) y aquí se tarifan con el precio de entrada cacheada del catálogo
// del gateway (misma tarifa de lista) o con --cost-cached. Sin ese dato, la entrada se cobra entera.
//   --first-turns N  (solo pruebas) corta la primera fase a N turnos para forzar el recordatorio
//
import 'dotenv/config';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, MCPServerStdio, MaxTurnsExceededError, run, setDefaultOpenAIKey, setTracingDisabled } from '@openai/agents';
import type { AgentInputItem } from '@openai/agents';
import { findScenario } from '../src/scenarios';
import { SYSTEM, NUDGE, buildPrompt } from '../src/lib/harness/runner';
import { buildExternalRun, emptyTrace, saveExternalRun, type Trace } from '../src/lib/harness/external';
import { gatewayPricing, nivelSdk, NIVELES_RAZONAMIENTO, type Razonamiento } from '../src/lib/harness/models';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const num = (n: string) => (arg(n) != null ? Number(arg(n)) : undefined);
const model = arg('model');
const scenario = findScenario(arg('scenario') ?? '');
const batchId = arg('batch');
const dry = process.argv.includes('--dry');
const razonamiento = arg('razonamiento') as Razonamiento | undefined;
if (!model || !scenario || !batchId || (razonamiento && !NIVELES_RAZONAMIENTO.includes(razonamiento))) {
  console.error(`Uso: --model <id de OpenAI> --scenario <id> --batch <id> [--razonamiento ${NIVELES_RAZONAMIENTO.join('|')}] [--label ...] [--cost-in N --cost-out N] [--max-turns N] [--first-turns N] [--dry]`);
  process.exit(1);
}
const maxTurns = num('max-turns') ?? Number(process.env.BENCH_MAX_STEPS ?? 25);
const firstTurns = num('first-turns');
const nudgeEnabled = process.env.BENCH_NUDGE !== '0';
const effort = razonamiento ? nivelSdk({ id: `openai/${model}`, label: model, vendor: 'OpenAI', family: 'frontera', razonamiento }) : undefined;
const slug = razonamiento ? `razonamiento-${razonamiento.normalize('NFD').replace(/[̀-ͯ]/g, '')}` : '';
// El sufijo del id separa estos runs de los del gateway (y de los del mismo modelo con otro nivel) en las medias por modelo.
const modelId = `openai/${model}@agents-sdk${slug ? `-${slug}` : ''}`;
const label = arg('label') ?? `${model} (Agents SDK${razonamiento ? ` · razonamiento ${razonamiento}` : ''})`;
const flagPricing = num('cost-in') != null && num('cost-out') != null ? { input: num('cost-in')!, output: num('cost-out')!, cached: num('cost-cached') ?? num('cost-in')! } : undefined;

const tracePath = join(mkdtempSync(join(tmpdir(), 'bench-openai-agents-')), 'traza.json');
if (!process.env.OPENAI_API_KEY && !dry) {
  console.error('Sin credenciales: pon OPENAI_API_KEY en .env (clave de OpenAI con saldo; el gateway no interviene en esta vía).');
  process.exit(1);
}
console.log(`OpenAI Agents SDK · modelo: ${model}${effort ? ` · reasoning.effort ${effort}` : ' · esfuerzo por defecto'} · escenario: ${scenario.id} · lote: ${batchId} · maxTurns ${maxTurns}${firstTurns ? ` (primera fase ${firstTurns}, prueba)` : ''}${nudgeEnabled ? '' : ' · sin recordatorio'}`);
console.log(`traza: ${tracePath}`);
if (dry) { console.log('(--dry: no se lanza nada)'); process.exit(0); }

setDefaultOpenAIKey(process.env.OPENAI_API_KEY!);
// Las trazas del SDK irían a la plataforma de OpenAI; el benchmark guarda la suya en BENCH_TRACE.
setTracingDisabled(true);

const readTrace = (): Trace => (existsSync(tracePath) ? JSON.parse(readFileSync(tracePath, 'utf8')) : emptyTrace(scenario.id));

// Mismo servidor MCP que el adaptador de Claude; un solo proceso para las dos fases, así la
// traza sigue numerando las llamadas sin relanzar nada.
const server = new MCPServerStdio({
  name: 'bench',
  command: 'npx',
  args: ['tsx', 'scripts/mcp-server.ts'],
  cwd: process.cwd(),
  env: { ...(process.env as Record<string, string>), BENCH_SCENARIO: scenario.id, BENCH_TRACE: tracePath },
  cacheToolsList: true,
});
await server.connect();
const toolNames = (await server.listTools()).map((t) => t.name);
console.log(`  servidor MCP: bench · herramientas: ${toolNames.length}${toolNames.length !== 8 ? ` (${toolNames.join(', ')})` : ''}`);

const agent = new Agent({
  name: 'agente-sre',
  instructions: SYSTEM,
  model,
  ...(effort ? { modelSettings: { reasoning: { effort } } } : {}),
  mcpServers: [server],
});

type Tokens = { input: number; output: number; cached: number };
interface Phase {
  finalText: string;
  /** peticiones al modelo en la fase (un turno = una petición) */
  turns: number;
  tokens: Tokens;
  history: AgentInputItem[];
  latencyMs: number;
  maxed?: boolean;
  error?: string;
}
// cached_tokens llega en input_tokens_details de cada petición; el SDK lo acumula por petición (requestUsageEntries) y en inputTokensDetails
const cachedOf = (u: any): number => {
  const entries: any[] = u?.requestUsageEntries ?? [];
  if (entries.length) return entries.reduce((a, e) => a + (e?.inputTokensDetails?.cached_tokens ?? 0), 0);
  const details: any[] = Array.isArray(u?.inputTokensDetails) ? u.inputTokensDetails : [];
  return details.reduce((a, d) => a + (d?.cached_tokens ?? 0), 0);
};
const usageOf = (u: any): Tokens => ({ input: u?.inputTokens ?? 0, output: u?.outputTokens ?? 0, cached: cachedOf(u) });

async function ask(input: string | AgentInputItem[], turns: number): Promise<Phase> {
  const phase: Phase = { finalText: '', turns: 0, tokens: { input: 0, output: 0, cached: 0 }, history: [], latencyMs: 0 };
  const t0 = Date.now();
  const seen = readTrace().toolCalls.length;
  try {
    const result = await run(agent, input as any, { maxTurns: turns });
    phase.finalText = typeof result.finalOutput === 'string' ? result.finalOutput.trim() : '';
    phase.history = result.history;
    const u: any = result.state?.usage;
    phase.turns = u?.requests ?? 0;
    phase.tokens = usageOf(u);
  } catch (err) {
    // Agotar maxTurns no es un error del run: se puntúa lo que haya, como max_steps en runner.ts.
    if (err instanceof MaxTurnsExceededError) {
      phase.maxed = true;
      const st: any = (err as any).state;
      const u: any = st?.usage ?? st?._context?.usage;
      if (u) { phase.turns = u.requests ?? turns; phase.tokens = usageOf(u); } else phase.turns = turns;
    } else phase.error = (err as Error).message ?? String(err);
  }
  phase.latencyMs = Date.now() - t0;
  const calls = readTrace().toolCalls.slice(seen);
  // el SDK puede lanzar varias llamadas en un mismo turno; se numeran por orden de llegada a la traza
  calls.forEach((c, i) => console.log(`  #${seen + i + 1} ${c.name}(${JSON.stringify(c.input).slice(0, 110)})${c.ok ? '' : ' [ERROR]'}`));
  return phase;
}

let phases: Phase[] = [];
let nudged = false;
try {
  phases.push(await ask(buildPrompt(scenario), firstTurns ?? maxTurns));
  const first = phases[0];
  const exhausted = !!first.maxed && !firstTurns;
  if (nudgeEnabled && !first.error && !readTrace().submission && !exhausted) {
    const left = Math.max(1, maxTurns - first.turns);
    nudged = true;
    console.log(`  [harness] cerró sin submit_remediation; se continúa la conversación con el recordatorio final (${left} turnos)`);
    phases.push(await ask(first.history.concat({ role: 'user', content: NUDGE }), left));
  }
} finally {
  await server.close();
}

const trace = readTrace();
const last = phases[phases.length - 1];
const error = phases.find((p) => p.error)?.error;
const finalText = [...phases].reverse().find((p) => p.finalText)?.finalText;
const tokens = phases.reduce<Tokens>((a, p) => ({ input: a.input + p.tokens.input, output: a.output + p.tokens.output, cached: a.cached + p.tokens.cached }), { input: 0, output: 0, cached: 0 });
const steps = phases.reduce((n, p) => n + p.turns, 0);
const latencyMs = phases.reduce((n, p) => n + p.latencyMs, 0);
const usage = tokens.input + tokens.output > 0 ? tokens : undefined;
// Tarifa por millón: la lista del gateway para openai/<modelo> (misma tarifa de lista, con precio de entrada cacheada), o los flags.
let pricing = flagPricing;
if (!pricing) { const p = (await gatewayPricing()).get(`openai/${model}`); if (p) pricing = { input: p.input * 1e6, output: p.output * 1e6, cached: (p.cached ?? p.input) * 1e6 }; }
const costUsd = usage && pricing ? ((usage.input - usage.cached) * pricing.input + usage.cached * pricing.cached + usage.output * pricing.output) / 1e6 : undefined;

const run_ = buildExternalRun(scenario, trace, {
  modelId,
  label,
  vendor: 'OpenAI',
  razonamiento,
  batchId,
  latencyMs,
  usage,
  costUsd,
  costSource: 'pricing',
  finalText,
  steps,
  error,
  nudged,
  stopReason: last?.maxed ? 'max_steps' : undefined,
});
const batch = await saveExternalRun(run_);
const cost = run_.costUsd != null ? `$${run_.costUsd.toFixed(4)} (${run_.costSource})` : 'n/d';
console.log(`\n${run_.ok ? '✓' : '✗'} ${label.padEnd(34)} ${scenario.id.padEnd(24)} determ ${String(run_.score.total).padStart(3)}  ${run_.toolCalls.length} calls  ${(run_.latencyMs / 1000).toFixed(1)}s  ${cost}  ${run_.stopReason}${nudged ? ' (con recordatorio)' : ''}${error ? `  ERROR: ${error.slice(0, 160)}` : ''}`);
if (usage) console.log(`  tokens: entrada ${usage.input} (${usage.cached} desde caché, ${usage.input ? Math.round((100 * usage.cached) / usage.input) : 0} %) · salida ${usage.output}${pricing ? ` · tarifa $${pricing.input.toFixed(2)}/$${pricing.cached.toFixed(2)}/$${pricing.output.toFixed(2)} por millón (entrada/caché/salida)` : ''}`);
if (phases.length > 1) console.log(`  fases: ${phases.map((p, i) => `${i + 1}) ${p.turns} turnos, ${p.tokens.input}/${p.tokens.output} tokens`).join(' · ')}`);
for (const d of run_.score.details) console.log('  · ' + d);
console.log(`Guardado en el lote ${batch.id} (${batch.runIds.length} runs). http://localhost:4321/lotes/${batch.id}`);
