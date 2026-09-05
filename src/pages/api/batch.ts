import type { APIRoute } from 'astro';
import { READONLY } from '@/lib/harness/readonly';
import { findModel } from '@/lib/harness/models';
import { findScenario } from '@/scenarios';
import { runBatch } from '@/lib/harness/batch';
import type { BatchEvent } from '@/lib/harness/types';

export const prerender = false;

// POST { models: string[], scenarios: string[], runsPer, judge?, concurrency?, maxSteps? } → stream NDJSON de BatchEvent
export const POST: APIRoute = async ({ request }) => {
  if (READONLY) return new Response(JSON.stringify({ error: 'Modo solo lectura: esta instancia solo sirve resultados publicados.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  let p: { models?: string[]; scenarios?: string[]; runsPer?: number; judge?: string; concurrency?: number; maxSteps?: number };
  try {
    p = await request.json();
  } catch {
    return new Response('JSON inválido', { status: 400 });
  }
  const models = (p.models ?? []).map(findModel).filter((m): m is NonNullable<typeof m> => !!m);
  const scenarios = (p.scenarios ?? []).map(findScenario).filter((s): s is NonNullable<typeof s> => !!s);
  const judge = p.judge ? findModel(p.judge) : undefined;
  if (!models.length) return new Response('Selecciona al menos un modelo', { status: 400 });
  if (!scenarios.length) return new Response('Selecciona al menos un escenario', { status: 400 });
  if (p.judge && !judge) return new Response(`Juez desconocido: ${p.judge}`, { status: 400 });
  if (!process.env.AI_GATEWAY_API_KEY) return new Response('Falta AI_GATEWAY_API_KEY en el entorno del servidor', { status: 500 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: BatchEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + '\n'));
      try {
        await runBatch({ models, scenarios, runsPer: Math.max(1, Math.min(10, p.runsPer ?? 1)), judge, concurrency: p.concurrency, maxSteps: p.maxSteps, onEvent: send });
      } catch (err) {
        send({ type: 'error', message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
  });
};
