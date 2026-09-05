import type { APIRoute } from 'astro';
import { READONLY } from '@/lib/harness/readonly';
import { findModel } from '@/lib/harness/models';
import { findScenario } from '@/scenarios';
import { runScenario } from '@/lib/harness/runner';
import { saveResult } from '@/lib/harness/store';
import type { RunEvent } from '@/lib/harness/types';

export const prerender = false;

// POST { model, scenario, maxSteps? } → stream NDJSON de RunEvent
export const POST: APIRoute = async ({ request }) => {
  if (READONLY) return new Response(JSON.stringify({ error: 'Modo solo lectura: esta instancia solo sirve resultados publicados.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  let payload: { model?: string; scenario?: string; maxSteps?: number };
  try {
    payload = await request.json();
  } catch {
    return new Response('JSON inválido', { status: 400 });
  }
  const model = findModel(payload.model ?? '');
  const scenario = findScenario(payload.scenario ?? '');
  if (!model) return new Response(`Modelo desconocido: ${payload.model}`, { status: 400 });
  if (!scenario) return new Response(`Escenario desconocido: ${payload.scenario}`, { status: 400 });
  if (!process.env.AI_GATEWAY_API_KEY) return new Response('Falta AI_GATEWAY_API_KEY en el entorno del servidor', { status: 500 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: RunEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + '\n'));
      try {
        const result = await runScenario({ model, scenario, maxSteps: payload.maxSteps, onEvent: send });
        await saveResult(result);
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
