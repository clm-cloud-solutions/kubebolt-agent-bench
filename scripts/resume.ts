// Retoma un lote interrumpido (presupuesto agotado, límite de tasa, corte): relanza
// solo las celdas modelo × escenario que no tienen un run correcto, sustituye los
// ficheros de los runs fallidos, y juzga los runs que se quedaron sin calidad.
// Un run que vuelve a fallar se guarda como fallido y un `resume` posterior lo recoge.
//
//   npm run resume -- --batch <id> --dry          # solo el plan
//   npm run resume -- --batch <id>                    # relanza y juzga con el juez del lote
//   npm run resume -- --batch <id> --no-judge     # relanza sin juzgar
//
import 'dotenv/config';
import { findModel } from '../src/lib/harness/models';
import { findScenario } from '../src/scenarios';
import { runScenario } from '../src/lib/harness/runner';
import { judgeRun } from '../src/lib/harness/judge';
import { deleteResult, loadBatch, loadResults, saveBatch, saveResult, updateResult } from '../src/lib/harness/store';
import type { ModelSpec, RunResult, Scenario } from '../src/lib/harness/types';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const batchId = arg('batch');
const dry = process.argv.includes('--dry');
const noJudge = process.argv.includes('--no-judge');
const concurrency = Number(arg('concurrency') ?? 3);
if (!batchId) { console.error('Indica --batch <id>'); process.exit(1); }

const batch = await loadBatch(batchId);
if (!batch) { console.error(`Lote ${batchId} no encontrado en results/batches/`); process.exit(1); }
const runs = (await loadResults()).filter((r) => r.batchId === batch.id);
const judge = batch.judgeModel && !noJudge ? findModel(batch.judgeModel) : undefined;
if (batch.judgeModel && !noJudge && !judge) console.warn(`Aviso: el juez del lote (${batch.judgeModel}) ya no está en MODELS; se relanza sin juzgar.`);

// Celdas pendientes: por cada modelo × escenario faltan (runsPer - runs ok).
const jobs: { model: ModelSpec; scenario: Scenario }[] = [];
for (const m of batch.models) {
  for (const s of batch.scenarios) {
    const model = findModel(m);
    const scenario = findScenario(s);
    if (!model || !scenario) { console.warn(`Aviso: ${m} × ${s} ya no existe en el registro; se omite.`); continue; }
    const okCount = runs.filter((r) => r.model.id === m && r.scenarioId === s && r.ok).length;
    for (let i = okCount; i < batch.runsPer; i++) jobs.push({ model, scenario });
  }
}
const failed = runs.filter((r) => !r.ok);
const unjudged = runs.filter((r) => r.ok && (!r.quality || r.quality.error));

console.log(`Lote ${batch.id}: ${batch.models.length} modelos × ${batch.scenarios.length} escenarios × ${batch.runsPer} · ${runs.length} runs en disco (${runs.length - failed.length} ok, ${failed.length} fallidos)`);
console.log(`Plan: relanzar ${jobs.length} celda(s), retirar ${failed.length} run(s) fallido(s), juzgar ${judge ? jobs.length + unjudged.length : 0} run(s) con ${judge?.label ?? 'nadie'}\n`);
for (const j of jobs) console.log(`  ▶ ${j.model.label.padEnd(26)} ${j.scenario.id}`);
for (const r of unjudged) console.log(`  ⚖ ${r.model.label.padEnd(26)} ${r.scenarioId}  (ok, sin calidad válida)`);
if (!jobs.length && !unjudged.length) { console.log('\nNada que retomar: todas las celdas tienen run correcto y calidad.'); process.exit(0); }
if (dry) process.exit(0);
if (!process.env.AI_GATEWAY_API_KEY) { console.error('Falta AI_GATEWAY_API_KEY (copia .env.example a .env).'); process.exit(1); }

// 1) Retirar los runs fallidos que se van a sustituir.
for (const r of failed) {
  await deleteResult(r);
  batch.runIds = batch.runIds.filter((id) => id !== r.id);
}
batch.status = 'running';
await saveBatch(batch);

// 2) Relanzar con un pool de concurrencia, guardando cada run al terminar.
const fresh: RunResult[] = [];
let cursor = 0;
const worker = async () => {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    console.log(`\n▶ ${job.model.label.padEnd(26)} ${job.scenario.id}`);
    const result = await runScenario({ model: job.model, scenario: job.scenario });
    result.batchId = batch.id;
    await saveResult(result);
    batch.runIds.push(result.id);
    await saveBatch(batch);
    fresh.push(result);
    const cost = result.costUsd != null ? `${result.costUsd.toFixed(4)}` : 'n/d';
    console.log(`  ${result.ok ? '✓' : '✗'} determ ${String(result.score.total).padStart(3)}  ${result.toolCalls.length} calls  ${(result.latencyMs / 1000).toFixed(1)}s  ${cost}${result.error ? `  ERROR: ${result.error}` : ''}`);
    // El juez evalúa cada run en cuanto termina, sin esperar al más lento.
    if (judge && result.ok) {
      const q = await judgeRun(result, job.scenario, judge);
      result.quality = q;
      batch.judgeCostUsd = (batch.judgeCostUsd ?? 0) + (q.costUsd ?? 0);
      await updateResult(result);
      await saveBatch(batch);
      console.log(`  ⚖ ${job.model.label.padEnd(26)} ${job.scenario.id.padEnd(22)} calidad ${q.error ? 'n/d (' + q.error.slice(0, 80) + ')' : q.overall}`);
    }
  }
};
await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, worker));

// 3) Juzgar los runs que ya estaban en disco sin calidad válida (los nuevos se juzgaron al terminar).
if (judge) {
  const pending = unjudged;
  console.log(`\nJuez ${judge.label}: ${pending.length} run(s)`);
  for (const r of pending) {
    const q = await judgeRun(r, findScenario(r.scenarioId)!, judge);
    r.quality = q;
    batch.judgeCostUsd = (batch.judgeCostUsd ?? 0) + (q.costUsd ?? 0);
    await updateResult(r);
    await saveBatch(batch);
    console.log(`  ${r.model.label.padEnd(26)} ${r.scenarioId.padEnd(22)} calidad ${q.error ? 'n/d (' + q.error.slice(0, 80) + ')' : q.overall}`);
  }
}

batch.status = 'done';
await saveBatch(batch);
const stillFailed = fresh.filter((r) => !r.ok).length;
console.log(`\nLote ${batch.id} actualizado: ${fresh.length} run(s) relanzado(s), ${stillFailed} siguen fallidos${stillFailed ? ' (vuelve a ejecutar resume cuando haya crédito)' : ''}. Ábrelo en http://localhost:4321/lotes/${batch.id}`);
