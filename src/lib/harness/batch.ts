import { randomUUID } from 'node:crypto';
import type { Batch, BatchEvent, ModelSpec, Scenario } from './types';
import { runScenario } from './runner';
import { judgeRun } from './judge';
import { saveResult, saveBatch, updateResult } from './store';

export interface BatchOptions {
  models: ModelSpec[];
  scenarios: Scenario[];
  runsPer: number;
  judge?: ModelSpec;
  concurrency?: number;
  maxSteps?: number;
  onEvent?: (e: BatchEvent) => void;
}

// Ejecuta modelos × escenarios × repeticiones con un pool de concurrencia.
// Cada run se guarda al terminar; el juez (si hay) puntúa justo después.
export async function runBatch(opts: BatchOptions): Promise<Batch> {
  const emit = opts.onEvent ?? (() => {});
  const jobs: { model: ModelSpec; scenario: Scenario; index: number }[] = [];
  let index = 0;
  for (const model of opts.models) for (const scenario of opts.scenarios) for (let i = 0; i < opts.runsPer; i++) jobs.push({ model, scenario, index: index++ });

  const batch: Batch = {
    id: randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    models: opts.models.map((m) => m.id),
    scenarios: opts.scenarios.map((s) => s.id),
    runsPer: opts.runsPer,
    judgeModel: opts.judge?.id,
    runIds: [],
    status: 'running',
    judgeCostUsd: 0,
  };
  await saveBatch(batch);
  emit({ type: 'batch_start', id: batch.id, total: jobs.length });

  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      emit({ type: 'run_start', model: job.model.id, scenario: job.scenario.id, index: job.index });
      const result = await runScenario({ model: job.model, scenario: job.scenario, maxSteps: opts.maxSteps });
      result.batchId = batch.id;
      await saveResult(result);
      batch.runIds.push(result.id);
      emit({ type: 'run_done', result, index: job.index });
      if (opts.judge) {
        const quality = await judgeRun(result, job.scenario, opts.judge);
        result.quality = quality;
        batch.judgeCostUsd += quality.costUsd ?? 0;
        await updateResult(result);
        emit({ type: 'judge_done', runId: result.id, quality, index: job.index });
      }
      await saveBatch(batch);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 3, jobs.length)) }, worker));

  batch.status = 'done';
  await saveBatch(batch);
  emit({ type: 'batch_done', id: batch.id });
  return batch;
}
