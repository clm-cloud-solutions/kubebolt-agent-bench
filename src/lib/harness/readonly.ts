// Modo solo lectura de la UI: sirve resultados publicados (BENCH_RESULTS_DIR=results-public) sin
// lanzar nada. PUBLIC_READONLY=1 quita las páginas de lanzamiento, el duelo en vivo y las APIs de
// escritura; es el modo con el que scripts/export-site.ts genera el sitio estático.
export const READONLY =
  (typeof process !== 'undefined' && process.env.PUBLIC_READONLY === '1') ||
  ((import.meta as { env?: Record<string, string> }).env?.PUBLIC_READONLY === '1');
