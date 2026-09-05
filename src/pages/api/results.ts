import type { APIRoute } from 'astro';
import { loadResults, aggregate } from '@/lib/harness/store';

export const prerender = false;

// GET → { runs, aggregate } para exportar o consumir desde fuera de la UI.
export const GET: APIRoute = async () => {
  const runs = await loadResults();
  return new Response(JSON.stringify({ runs, aggregate: aggregate(runs) }, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
