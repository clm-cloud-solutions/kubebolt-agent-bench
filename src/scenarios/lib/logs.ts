// Generador determinista de logs largos: ruido plausible con líneas plantadas en
// posiciones fijas. Sirve para que los escenarios tengan 400-1000 líneas sin
// escribirlas a mano, y para que el agente tenga que buscar (grep) en vez de leer.
// Misma semilla → mismo log en cada run: el snapshot sigue congelado.

export interface NoisyLogOptions {
  /** semilla, normalmente el id del escenario más el nombre del pod */
  seed: string;
  /** número total de líneas */
  lines: number;
  /** marca de tiempo ISO de la primera línea */
  start: string;
  /** milisegundos medios entre líneas (se aleatoriza ±80 %) */
  stepMs?: number;
  /** plantillas de ruido; admiten {n} (1-9999), {ms} (latencia 3-900), {id} (hex de 6), {ip} (10.x.x.x), {pct} (1-99) */
  noise: string[];
  /** líneas plantadas: posición 1-based y texto literal (sin marca de tiempo) */
  needles: { at: number; text: string }[];
  /** formato de línea; por defecto "ISO nivel texto" */
  format?: (ts: string, text: string) => string;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function noisyLog(o: NoisyLogOptions): string {
  const rnd = mulberry32(hash(o.seed));
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
  const fill = (t: string) =>
    t
      .replace(/\{n\}/g, () => String(int(1, 9999)))
      .replace(/\{ms\}/g, () => String(int(3, 900)))
      .replace(/\{id\}/g, () => int(0, 0xffffff).toString(16).padStart(6, '0'))
      .replace(/\{ip\}/g, () => `10.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`)
      .replace(/\{pct\}/g, () => String(int(1, 99)));
  const needles = new Map(o.needles.map((x) => [x.at, x.text]));
  const step = o.stepMs ?? 400;
  let t = Date.parse(o.start);
  const out: string[] = [];
  for (let i = 1; i <= o.lines; i++) {
    t += Math.round(step * (0.2 + rnd() * 1.6));
    const ts = new Date(t).toISOString().replace(/\.\d{3}Z$/, (m) => m); // conserva milisegundos
    const text = needles.get(i) ?? fill(pick(o.noise));
    out.push(o.format ? o.format(ts, text) : `${ts} ${text}`);
  }
  return out.join('\n');
}
