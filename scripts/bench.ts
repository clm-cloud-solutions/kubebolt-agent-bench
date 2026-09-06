// CLI: corre modelos × escenarios × repeticiones y guarda cada run en results/.
//
//   npm run bench -- --models anthropic/claude-sonnet-5,deepseek/deepseek-v4-pro-0813 --scenarios configmap-crashloop --runs 3
//   npm run bench                      # todos los modelos, todos los escenarios, 1 run
//   npm run bench -- --judge anthropic/claude-opus-5   # evalúa cada run con un juez ciego
//   npm run bench -- --models openai/gpt-6-astra@razonamiento-medio --scenarios hpa-maxed   # nivel de razonamiento explícito (sufijo del id)
//   npm run bench -- --dry             # solo lista lo que haría
//
import 'dotenv/config';
import { MODELS, findModel } from '../src/lib/harness/models';
import { SCENARIOS } from '../src/scenarios';
import { runBatch } from '../src/lib/harness/batch';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const dry = process.argv.includes('--dry');
const modelIds = arg('models')?.split(',').map((s) => s.trim());
const scenarioIds = arg('scenarios')?.split(',').map((s) => s.trim());
const runs = Number(arg('runs') ?? 1);
const judgeId = arg('judge');
const concurrency = Number(arg('concurrency') ?? 3);

const models = modelIds ? modelIds.map(findModel).filter((m): m is NonNullable<typeof m> => !!m) : MODELS;
const judge = judgeId ? MODELS.find((m) => m.id === judgeId) : undefined;
if (judgeId && !judge) {
  console.error(`Juez desconocido: ${judgeId}`);
  process.exit(1);
}
const scenarios = scenarioIds ? SCENARIOS.filter((s) => scenarioIds.includes(s.id)) : SCENARIOS;

if (!models.length || !scenarios.length) {
  console.error('Ningún modelo o escenario coincide. Modelos:', MODELS.map((m) => m.id).join(', '));
  console.error('Escenarios:', SCENARIOS.map((s) => s.id).join(', '));
  process.exit(1);
}
if (!process.env.AI_GATEWAY_API_KEY && !dry) {
  console.error('Falta AI_GATEWAY_API_KEY (copia .env.example a .env).');
  process.exit(1);
}

console.log(`Plan: ${models.length} modelos × ${scenarios.length} escenarios × ${runs} runs = ${models.length * scenarios.length * runs} ejecuciones\n`);
if (dry) process.exit(0);

const rows: string[] = [];
const label = (id: string) => findModel(id)?.label ?? id;
const batch = await runBatch({
  models,
  scenarios,
  runsPer: runs,
  judge,
  concurrency,
  onEvent: (e) => {
    if (e.type === 'run_start') console.log(`▶ ${label(e.model).padEnd(20)} ${e.scenario}`);
    if (e.type === 'run_done') {
      const r = e.result;
      const cost = r.costUsd != null ? `$${r.costUsd.toFixed(4)}` : 'n/d';
      const line = `${r.ok ? '✓' : '✗'} determ ${String(r.score.total).padStart(3)}  causa ${r.score.rootCause}/40  acciones ${r.score.actions}/40  ${r.toolCalls.length} calls  ${(r.latencyMs / 1000).toFixed(1)}s  ${cost}${r.error ? `  ERROR: ${r.error.slice(0, 80)}` : ''}`;
      console.log(`  ${r.model.label.padEnd(20)} ${r.scenarioId.padEnd(24)} ${line}`);
      rows.push(`${r.model.label} | ${r.scenarioId} | ${line}`);
    }
    if (e.type === 'judge_done') console.log(`  ${''.padEnd(45)} calidad ${e.quality.error ? 'n/d (' + e.quality.error.slice(0, 40) + ')' : e.quality.overall + '/100'}`);
  },
});
console.log('\nResumen:\n' + rows.join('\n'));
console.log(`\nLote ${batch.id} guardado. Ábrelo en http://localhost:4321/lotes/${batch.id}`);
