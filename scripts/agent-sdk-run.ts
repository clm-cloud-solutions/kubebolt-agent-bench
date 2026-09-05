// Corre un escenario con el Claude Agent SDK (el harness de KubeBolt Autopilot) en vez del
// bucle genérico, usando el kubectl falso a través del servidor MCP del harness. Hereda la
// configuración de proveedor de Claude Code: con ANTHROPIC_API_KEY va directo a Anthropic;
// con CLAUDE_CODE_USE_FOUNDRY=1 y las variables ANTHROPIC_FOUNDRY_* va contra Microsoft
// Foundry. Guarda el run puntuado en results/.
//
// Paridad con runner.ts: si el modelo cierra el turno sin llamar a submit_remediation y
// quedan turnos, se reanuda la sesión (resume) con el mismo recordatorio final una sola vez
// y el run queda marcado con nudged: true. BENCH_NUDGE=0 lo desactiva.
//
//   npm run agent-sdk-run -- --model claude-sonnet-5 --scenario hpa-maxed --batch ext-01 [--label "..."] [--cost-in 2 --cost-out 10] [--max-turns 25] [--dry]
//   --first-turns N  (solo pruebas) corta la primera fase a N turnos para forzar el recordatorio
//
import 'dotenv/config';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { findScenario } from '../src/scenarios';
import { SYSTEM, NUDGE, buildPrompt } from '../src/lib/harness/runner';
import { buildExternalRun, emptyTrace, saveExternalRun, type Trace } from '../src/lib/harness/external';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const num = (n: string) => (arg(n) != null ? Number(arg(n)) : undefined);
const model = arg('model');
const scenario = findScenario(arg('scenario') ?? '');
const batchId = arg('batch');
const dry = process.argv.includes('--dry');
if (!model || !scenario || !batchId) {
  console.error('Uso: --model <despliegue o alias> --scenario <id> --batch <id> [--label ...] [--cost-in N --cost-out N] [--max-turns N] [--first-turns N] [--dry]');
  process.exit(1);
}
const maxTurns = num('max-turns') ?? Number(process.env.BENCH_MAX_STEPS ?? 25);
const firstTurns = num('first-turns');
const nudgeEnabled = process.env.BENCH_NUDGE !== '0';
const label = arg('label') ?? `${model} (Agent SDK${process.env.CLAUDE_CODE_USE_FOUNDRY ? ' · Foundry' : ''})`;
// El sufijo del id separa estos runs de los del gateway en las medias por modelo.
const pricing = num('cost-in') != null && num('cost-out') != null ? { input: num('cost-in')!, output: num('cost-out')! } : undefined;

const SERVER = 'bench';
const TOOLS = ['list_pods', 'list_nodes', 'describe', 'get_logs', 'get_events', 'get_manifest', 'query_metrics', 'submit_remediation'];
const tracePath = join(mkdtempSync(join(tmpdir(), 'bench-agent-sdk-')), 'traza.json');
const provider = process.env.CLAUDE_CODE_USE_FOUNDRY
  ? `Microsoft Foundry (${process.env.ANTHROPIC_FOUNDRY_RESOURCE ?? process.env.ANTHROPIC_FOUNDRY_BASE_URL ?? 'recurso sin definir'})`
  : process.env.CLAUDE_CODE_USE_BEDROCK ? 'Amazon Bedrock'
  : process.env.CLAUDE_CODE_USE_VERTEX ? 'Vertex AI'
  : process.env.ANTHROPIC_API_KEY ? 'Anthropic API (ANTHROPIC_API_KEY)'
  : '';
if (!provider && !dry) {
  console.error('Sin credenciales: pon ANTHROPIC_API_KEY en .env, o configura CLAUDE_CODE_USE_FOUNDRY=1 con ANTHROPIC_FOUNDRY_* (ver docs/agent-sdk-foundry.md).');
  process.exit(1);
}
console.log(`Agent SDK · proveedor: ${provider || 'sin definir'} · modelo: ${model} · escenario: ${scenario.id} · lote: ${batchId} · maxTurns ${maxTurns}${firstTurns ? ` (primera fase ${firstTurns}, prueba)` : ''}${nudgeEnabled ? '' : ' · sin recordatorio'}`);
console.log(`traza: ${tracePath}`);
if (dry) { console.log('(--dry: no se lanza nada)'); process.exit(0); }

const readTrace = (): Trace => (existsSync(tracePath) ? JSON.parse(readFileSync(tracePath, 'utf8')) : emptyTrace(scenario.id));

type Tokens = { input: number; output: number };
interface Phase {
  result: any;
  finalText: string;
  /** mensajes del asistente vistos en el stream */
  steps: number;
  /** tokens sumados mensaje a mensaje (parciales): respaldo si la fase no devuelve result */
  tokens: Tokens;
  sessionId?: string;
  /** agotó maxTurns (el SDK lo devuelve como error_max_turns y además lanza) */
  maxed?: boolean;
  error?: string;
}
const tokensOf = (u: any): Tokens => ({
  input: (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0),
  output: u?.output_tokens ?? 0,
});

// Una consulta al Agent SDK. Con `resume` continúa la sesión anterior: el SDK relanza el
// servidor MCP, que recupera la traza de BENCH_TRACE y sigue numerando las llamadas.
async function ask(prompt: string, turns: number, resume?: string): Promise<Phase> {
  const phase: Phase = { result: null, finalText: '', steps: 0, tokens: { input: 0, output: 0 } };
  try {
    const stream = query({
      prompt,
      options: {
        ...(resume ? { resume } : {}),
        systemPrompt: SYSTEM,
        // Aislamiento: sin settings de usuario ni de proyecto (CLAUDE.md, plugins, conectores) y
        // solo el servidor MCP del harness; si no, el modelo vería el CLAUDE.md del repo y decenas
        // de herramientas ajenas que inflan el contexto de cada turno.
        settingSources: [],
        strictMcpConfig: true,
        model,
        maxTurns: turns,
        cwd: process.cwd(),
        // Solo las herramientas del harness: sin Bash, Read, Write ni el resto de Claude Code.
        tools: [],
        allowedTools: TOOLS.map((t) => `mcp__${SERVER}__${t}`),
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        mcpServers: {
          [SERVER]: { type: 'stdio', command: 'npx', args: ['tsx', 'scripts/mcp-server.ts'], env: { ...(process.env as Record<string, string>), BENCH_SCENARIO: scenario!.id, BENCH_TRACE: tracePath } },
        },
        env: process.env as Record<string, string>,
      },
    } as any);
    for await (const msg of stream as AsyncIterable<any>) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        phase.sessionId = msg.session_id;
        const servers = (msg.mcp_servers ?? []) as { name: string; status: string }[];
        const bad = servers.filter((s) => s.status !== 'connected');
        if (bad.length) console.warn('Aviso: servidores MCP no conectados:', JSON.stringify(bad));
        if (!resume) console.log(`  sesión ${msg.session_id} · servidores MCP: ${servers.map((s) => s.name).join(', ') || 'ninguno'} · herramientas: ${(msg.tools ?? []).length}`);
      }
      if (msg.type === 'assistant') {
        phase.steps += 1;
        const t = tokensOf(msg.message?.usage);
        phase.tokens.input += t.input;
        phase.tokens.output += t.output;
        for (const b of msg.message?.content ?? []) {
          if (b.type === 'text' && b.text?.trim()) phase.finalText = b.text.trim();
          if (b.type === 'tool_use') console.log(`  #${phase.steps} ${String(b.name).replace(`mcp__${SERVER}__`, '')}(${JSON.stringify(b.input).slice(0, 110)})`);
        }
      }
      if (msg.type === 'result') phase.result = msg;
    }
  } catch (err) {
    phase.error = (err as Error).message ?? String(err);
  }
  // Agotar maxTurns no es un error del run: se puntúa lo que haya, como max_steps en runner.ts.
  // El SDK lo devuelve como result error_max_turns y después lanza "Reached maximum number of turns".
  phase.maxed = phase.result?.subtype === 'error_max_turns' || /maximum number of turns/i.test(phase.error ?? '');
  if (phase.maxed) phase.error = undefined;
  else if (phase.result?.is_error && !phase.error) phase.error = (phase.result.errors ?? []).join('; ') || phase.result.subtype || 'error';
  return phase;
}

const t0 = Date.now();
const phases: Phase[] = [await ask(buildPrompt(scenario), firstTurns ?? maxTurns)];
let trace = readTrace();
let nudged = false;
const turnsOf = (p: Phase) => p.result?.num_turns ?? p.steps;
const first = phases[0];
const exhausted = !!first.maxed && !firstTurns;
const sessionId = first.sessionId ?? first.result?.session_id;
if (nudgeEnabled && !first.error && !trace.submission && !exhausted && sessionId) {
  const left = Math.max(1, maxTurns - turnsOf(first));
  nudged = true;
  console.log(`  [harness] cerró sin submit_remediation; se reanuda la sesión con el recordatorio final (${left} turnos)`);
  phases.push(await ask(NUDGE, left, sessionId));
  trace = readTrace();
}

const last = phases[phases.length - 1];
const error = phases.find((p) => p.error)?.error;
const finalText = [...phases].reverse().find((p) => p.finalText)?.finalText;
// Cada fase es un proceso del SDK y reporta solo lo suyo (usage, coste, turnos, duración):
// se suman. El usage por mensaje del stream es parcial (el de message_start) y solo sirve
// de respaldo si una fase termina sin mensaje result.
const phaseTokens = (p: Phase): Tokens => (p.result?.usage ? tokensOf(p.result.usage) : p.tokens);
const tokens = phases.reduce<Tokens>((a, p) => { const t = phaseTokens(p); return { input: a.input + t.input, output: a.output + t.output }; }, { input: 0, output: 0 });
const costs = phases.map((p) => p.result?.total_cost_usd).filter((c): c is number => typeof c === 'number');
const costUsd = costs.length ? costs.reduce((a, b) => a + b, 0) : undefined;
const steps = phases.reduce((n, p) => n + turnsOf(p), 0);
const durations = phases.map((p) => p.result?.duration_ms).filter((d): d is number => typeof d === 'number');
const latencyMs = durations.length === phases.length ? durations.reduce((a, b) => a + b, 0) : Date.now() - t0;
const usage = tokens.input + tokens.output > 0 ? tokens : undefined;

const run = buildExternalRun(scenario, trace, {
  modelId: `anthropic/${model}@agent-sdk`,
  label,
  batchId,
  latencyMs,
  usage,
  costUsd,
  pricing,
  finalText,
  steps,
  error,
  nudged,
  stopReason: last.maxed ? 'max_steps' : undefined,
});
const batch = await saveExternalRun(run);
const cost = run.costUsd != null ? `$${run.costUsd.toFixed(4)} (${run.costSource})` : 'n/d';
console.log(`\n${run.ok ? '✓' : '✗'} ${label.padEnd(30)} ${scenario.id.padEnd(24)} determ ${String(run.score.total).padStart(3)}  ${run.toolCalls.length} calls  ${(run.latencyMs / 1000).toFixed(1)}s  ${cost}  ${run.stopReason}${nudged ? ' (con recordatorio)' : ''}${error ? `  ERROR: ${error.slice(0, 160)}` : ''}`);
if (phases.length > 1) {
  console.log(`  fases: ${phases.map((p, i) => { const t = phaseTokens(p); return `${i + 1}) ${turnsOf(p)} turnos, ${t.input}/${t.output} tokens, $${(p.result?.total_cost_usd ?? 0).toFixed(4)}`; }).join(' · ')}`);
}
for (const d of run.score.details) console.log('  · ' + d);
console.log(`Guardado en el lote ${batch.id} (${batch.runIds.length} runs). http://localhost:4321/lotes/${batch.id}`);
