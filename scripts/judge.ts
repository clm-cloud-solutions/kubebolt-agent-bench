// Evalúa con un juez ciego los runs que aún no tienen calidad (o todos con --force).
//
//   npm run judge -- --judge anthropic/claude-opus-5
//   npm run judge -- --judge google/gemini-3.1-pro-preview --batch 1a2b3c4d --force
//
import 'dotenv/config';
import { MODELS } from '../src/lib/harness/models';
import { findScenario } from '../src/scenarios';
import { judgeRun } from '../src/lib/harness/judge';
import { loadResults, loadBatch, saveBatch, updateResult } from '../src/lib/harness/store';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const judge = MODELS.find((m) => m.id === arg('judge'));
if (!judge) { console.error('Indica --judge <id de MODELS>'); process.exit(1); }
const batchId = arg('batch');
const force = process.argv.includes('--force');

const batch = batchId ? await loadBatch(batchId) : undefined;
let runs = await loadResults();
if (batchId) runs = runs.filter((r) => r.batchId === batchId);
if (!force) runs = runs.filter((r) => !r.quality || r.quality.error);
console.log(`${runs.length} runs a evaluar con ${judge.label}\n`);

let cost = 0;
for (const r of runs) {
  const s = findScenario(r.scenarioId);
  if (!s) continue;
  const q = await judgeRun(r, s, judge);
  r.quality = q;
  cost += q.costUsd ?? 0;
  await updateResult(r);
  console.log(`${r.model.label.padEnd(20)} ${r.scenarioId.padEnd(24)} determ ${String(r.score.total).padStart(3)}  calidad ${q.error ? 'n/d' : q.overall}`);
}
if (batch) { batch.judgeModel = judge.id; batch.judgeCostUsd = (batch.judgeCostUsd ?? 0) + cost; await saveBatch(batch); }
console.log(`\nCoste del juez: $${cost.toFixed(4)}`);
