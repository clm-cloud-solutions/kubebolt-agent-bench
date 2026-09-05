import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Batch, RunResult } from './types';

// BENCH_RESULTS_DIR permite servir un conjunto publicado (results-public/) en vez de results/.
const DIR = join(process.cwd(), process.env.BENCH_RESULTS_DIR ?? 'results');

const BATCH_DIR = join(DIR, 'batches');

function resultFile(r: RunResult) {
  return join(DIR, `${r.timestamp.replace(/[:.]/g, '-')}_${r.model.id.replace('/', '_')}_${r.scenarioId}.json`);
}

export async function saveResult(r: RunResult) {
  await mkdir(DIR, { recursive: true });
  await writeFile(resultFile(r), JSON.stringify(r, null, 2));
}

/** Reescribe un run existente (p.ej. tras añadirle la evaluación de calidad). */
export async function updateResult(r: RunResult) {
  await saveResult(r);
}

/** Elimina el fichero de un run (p.ej. un run fallido que se va a relanzar). */
export async function deleteResult(r: RunResult) {
  await rm(resultFile(r), { force: true });
}

export async function saveBatch(b: Batch) {
  await mkdir(BATCH_DIR, { recursive: true });
  await writeFile(join(BATCH_DIR, `${b.id}.json`), JSON.stringify(b, null, 2));
}

export async function loadBatches(): Promise<Batch[]> {
  try {
    const files = (await readdir(BATCH_DIR)).filter((f) => f.endsWith('.json'));
    const all = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(BATCH_DIR, f), 'utf8')) as Batch));
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function loadBatch(id: string): Promise<Batch | undefined> {
  return (await loadBatches()).find((b) => b.id === id);
}

export async function loadResults(): Promise<RunResult[]> {
  try {
    const files = (await readdir(DIR)).filter((f) => f.endsWith('.json'));
    const all = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(DIR, f), 'utf8')) as RunResult));
    return all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  } catch {
    return [];
  }
}

export interface ModelAggregate {
  modelId: string;
  label: string;
  vendor: string;
  family: string;
  runs: number;
  failed: number;
  avgScore: number;
  rootCauseAcc: number; // % de runs con componente raíz correcto (>=20)
  actionAcc: number; // % de runs con acciones F1 = 1 (40/40 antes de penalizaciones)
  avgCost?: number;
  avgLatencyMs: number;
  avgToolCalls: number;
  violations: number;
  /** escenario → media de score determinista y de calidad */
  byScenario: Record<string, { avg: number; n: number; quality?: number }>;
  /** calidad (juez): media global 0-100 y por dimensión 1-5 */
  quality?: { overall: number; n: number; dims: Record<string, number>; grounding: number };
}

export function aggregate(results: RunResult[]): ModelAggregate[] {
  const map = new Map<string, RunResult[]>();
  for (const r of results) {
    const arr = map.get(r.model.id) ?? [];
    arr.push(r);
    map.set(r.model.id, arr);
  }
  const out: ModelAggregate[] = [];
  for (const [id, rs] of map) {
    const ok = rs.filter((r) => r.ok);
    const costs = ok.map((r) => r.costUsd).filter((c): c is number => c != null);
    const byScenario: Record<string, { avg: number; n: number; quality?: number }> = {};
    const qAcc: Record<string, number[]> = {};
    for (const r of rs) {
      const b = byScenario[r.scenarioId] ?? { avg: 0, n: 0 };
      b.avg = (b.avg * b.n + r.score.total) / (b.n + 1);
      b.n++;
      byScenario[r.scenarioId] = b;
      if (r.quality && !r.quality.error) (qAcc[r.scenarioId] ??= []).push(r.quality.overall);
    }
    for (const [sid, arr] of Object.entries(qAcc)) byScenario[sid].quality = arr.reduce((a, b) => a + b, 0) / arr.length;
    const judged = rs.filter((r) => r.quality && !r.quality.error);
    let quality: ModelAggregate['quality'];
    if (judged.length) {
      const dims: Record<string, number> = {};
      for (const r of judged) for (const d of r.quality!.dimensions) dims[d.id] = (dims[d.id] ?? 0) + d.score / judged.length;
      const grounded = judged.filter((r) => r.quality!.evidenceGrounding.cited > 0);
      quality = {
        overall: judged.reduce((a, r) => a + r.quality!.overall, 0) / judged.length,
        n: judged.length,
        dims,
        grounding: grounded.length ? (grounded.reduce((a, r) => a + r.quality!.evidenceGrounding.found / r.quality!.evidenceGrounding.cited, 0) / grounded.length) * 100 : 0,
      };
    }
    out.push({
      modelId: id,
      label: rs[0].model.label,
      vendor: rs[0].model.vendor,
      family: rs[0].model.family,
      runs: rs.length,
      failed: rs.length - ok.length,
      avgScore: rs.reduce((a, r) => a + r.score.total, 0) / rs.length,
      rootCauseAcc: (rs.filter((r) => r.score.rootCause >= 20).length / rs.length) * 100,
      actionAcc: (rs.filter((r) => r.score.actions >= 40).length / rs.length) * 100,
      avgCost: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : undefined,
      avgLatencyMs: ok.length ? ok.reduce((a, r) => a + r.latencyMs, 0) / ok.length : 0,
      avgToolCalls: ok.length ? ok.reduce((a, r) => a + r.toolCalls.length, 0) / ok.length : 0,
      violations: rs.reduce((a, r) => a + r.catalogViolations.length, 0),
      byScenario,
      quality,
    });
  }
  return out.sort((a, b) => b.avgScore - a.avgScore);
}
