// Convierte una traza de scripts/mcp-server.ts (o de cualquier agente conectado a él) en
// un run puntuado dentro de results/, en el lote que indiques.
//
//   npm run import-run -- --trace /tmp/traza.json --scenario hpa-maxed --model autopilot/claude-sonnet-5 \
//     --label "Autopilot (Sonnet 5)" --batch ext-autopilot-01 --latency-ms 42000 --input-tokens 31000 --output-tokens 2900 [--cost-usd 0.12 | --cost-in 2 --cost-out 10]
//
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { findScenario } from '../src/scenarios';
import { buildExternalRun, saveExternalRun, type Trace } from '../src/lib/harness/external';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const num = (n: string) => (arg(n) != null ? Number(arg(n)) : undefined);
const tracePath = arg('trace');
const scenario = findScenario(arg('scenario') ?? '');
if (!tracePath || !scenario || !arg('model') || !arg('batch')) {
  console.error('Uso: --trace <json> --scenario <id> --model <id> --batch <id> [--label ... --latency-ms N --input-tokens N --output-tokens N --cost-usd N | --cost-in N --cost-out N --final-text ...]');
  process.exit(1);
}
const trace = JSON.parse(readFileSync(tracePath, 'utf8')) as Trace;
if (trace.scenarioId !== scenario.id) console.warn(`Aviso: la traza es de ${trace.scenarioId}, no de ${scenario.id}`);
const run = buildExternalRun(scenario, trace, {
  modelId: arg('model')!,
  label: arg('label') ?? arg('model')!,
  vendor: arg('vendor'),
  batchId: arg('batch')!,
  latencyMs: num('latency-ms') ?? 0,
  usage: { input: num('input-tokens') ?? 0, output: num('output-tokens') ?? 0 },
  costUsd: num('cost-usd'),
  pricing: num('cost-in') != null && num('cost-out') != null ? { input: num('cost-in')!, output: num('cost-out')! } : undefined,
  finalText: arg('final-text'),
});
const batch = await saveExternalRun(run);
console.log(`${run.model.label.padEnd(26)} ${scenario.id.padEnd(24)} determ ${String(run.score.total).padStart(3)}  ${run.toolCalls.length} calls  ${run.stopReason}`);
for (const d of run.score.details) console.log('  · ' + d);
console.log(`Guardado en el lote ${batch.id} (${batch.runIds.length} runs). http://localhost:4321/lotes/${batch.id}`);
