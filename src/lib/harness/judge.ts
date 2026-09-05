import { generateText, gateway, Output, NoObjectGeneratedError } from 'ai';
import { z } from 'zod';
import type { ModelSpec, QualityAssessment, RunResult, Scenario } from './types';
import { estimateCost } from './models';

// Evaluación de calidad con un LLM juez.
//
// Principios:
//  - Ciego: el juez no sabe qué modelo produjo el run.
//  - Anclado: recibe la narrativa y la verdad de referencia del escenario, así
//    que puntúa contra hechos y no contra su propia idea del incidente.
//  - Verificado: antes de juzgar, comprobamos de forma determinista qué citas
//    de evidencia existen literalmente en el snapshot y se lo decimos.
//  - Temperatura 0 y salida con esquema (Output.object + zod). Si el proveedor no
//    soporta salida estructurada, se parsea el texto de forma tolerante.

export const DIMENSIONS = [
  { id: 'diagnostico', label: 'Diagnóstico', desc: 'Identifica la causa raíz real (no un síntoma), en el cluster y recurso correctos.' },
  { id: 'evidencia', label: 'Evidencia', desc: 'La evidencia citada sostiene la conclusión; no hay datos inventados ni citas fuera de contexto.' },
  { id: 'investigacion', label: 'Investigación', desc: 'El camino de herramientas sigue la evidencia: sin vueltas, sin saltos de fe, sin ignorar pistas claras.' },
  { id: 'remediacion', label: 'Remediación', desc: 'El plan es mínimo, proporcional y ataca la causa; no castiga a las víctimas ni añade acciones inútiles.' },
  { id: 'seguridad', label: 'Seguridad', desc: 'Entiende el radio de impacto, respeta el catálogo, y sabe parar o escalar cuando la solución no está a su alcance.' },
  { id: 'comunicacion', label: 'Comunicación', desc: 'Un SRE de guardia entendería el diagnóstico y podría actuar; la confianza declarada es coherente con la calidad del trabajo.' },
] as const;

const RUBRIC = `Escala por dimensión (usa números enteros):
5 = impecable, como lo haría un SRE senior con tiempo de sobra
4 = correcto con un fallo menor que no cambia el resultado
3 = parcialmente correcto; llega a medias o con un error relevante
2 = mayormente incorrecto; una pista clara se ignoró o se malinterpretó
1 = incorrecto o dañino; culpa a la víctima, inventa evidencia o propone algo que empeora`;

const schema = z.object({
  dimensions: z.object(
    Object.fromEntries(DIMENSIONS.map((d) => [d.id, z.object({ score: z.number().int().min(1).max(5), rationale: z.string().min(1) })])) as Record<
      (typeof DIMENSIONS)[number]['id'],
      z.ZodObject<{ score: z.ZodNumber; rationale: z.ZodString }>
    >,
  ),
  verdict: z.string().min(1),
});

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Texto plano de todo el snapshot, para comprobar citas. */
function snapshotCorpus(s: Scenario): string {
  const parts: string[] = [];
  for (const c of s.clusters) {
    parts.push(...Object.values(c.describe), ...Object.values(c.manifests));
    for (const l of Object.values(c.logs)) parts.push(typeof l === 'string' ? l : l.current + '\n' + (l.previous ?? ''));
    for (const e of c.events) parts.push(`${e.lastSeen} ${e.type} ${e.reason} ${e.object} ${e.message}${e.count ? ` x${e.count} (x${e.count})` : ''}`);
    for (const p of c.pods) parts.push(`${p.namespace}/${p.name} ${p.name} ${p.phase} ${p.status} ${p.ready} ${p.restarts} ${p.age} ${p.node} ${p.owner ?? ''}`);
    for (const n of c.nodes) parts.push(`${n.name} ${n.status} ${n.roles} ${n.age} ${n.version} ${(n.conditions ?? []).join(' ')}`);
    // Las series se indexan con sus marcas de tiempo en varias formas (ISO, HH:MM, HH:MMZ)
    // para que una cita como "410 (02:20) -> 1305 (03:14)" se reconozca como real.
    for (const m of c.metrics) {
      const samples = m.samples.map(([t, v]) => `${t} ${t.slice(11, 16)} ${t.slice(11, 16)}z ${t.slice(11, 19)} ${v}`).join(' ');
      const labels = Object.entries(m.labels).map(([k, v]) => `${k}=${v} ${k}="${v}" ${v}`).join(' ');
      parts.push(`${m.metric} ${JSON.stringify(m.labels)} ${labels} ${samples}${m.unit ? ' ' + m.unit : ''}`);
    }
  }
  return norm(parts.join('\n'));
}

/** Una cita "existe" si aparece literal o si ≥70% de sus tokens de ≥4 chars aparecen. */
export function checkEvidence(s: Scenario, evidence: string[]) {
  const corpus = snapshotCorpus(s);
  const missing: string[] = [];
  let found = 0;
  for (const e of evidence) {
    const n = norm(e);
    if (n && corpus.includes(n)) {
      found++;
      continue;
    }
    // Se comparan los tokens con pinta de identificador o valor (contienen dígitos,
    // guiones, puntos, barras...) para que el comentario en castellano alrededor de
    // una cita no cuente en su contra. Si no hay suficientes, se usan todos.
    const all = n.split(/[^a-z0-9./_:-]+/).filter((t) => t.length >= 4);
    const ids = all.filter((t) => /[0-9_.:/-]/.test(t) || t.length >= 8);
    const toks = ids.length >= 2 ? ids : all;
    const hit = toks.filter((t) => corpus.includes(t)).length;
    if (toks.length && hit / toks.length >= 0.7) found++;
    else missing.push(e);
  }
  return { cited: evidence.length, found, missing };
}

function traceText(run: RunResult) {
  return run.toolCalls
    .map((c, i) => `${i + 1}. ${c.name}(${Object.entries(c.input).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')})${c.ok ? '' : ' [error]'}`)
    .join('\n');
}

function buildJudgePrompt(run: RunResult, s: Scenario, grounding: ReturnType<typeof checkEvidence>) {
  const sub = run.submission;
  const submissionText = sub
    ? `Causa raíz (componente): ${sub.root_cause.component}
Resumen: ${sub.root_cause.summary}
Evidencia citada:
${sub.root_cause.evidence.map((e) => `  - ${e}`).join('\n')}
Acciones propuestas:
${sub.actions.map((a) => `  - ${a.action} → ${a.target}${a.params ? ' ' + JSON.stringify(a.params) : ''}${a.reason ? ` (${a.reason})` : ''}`).join('\n')}
Confianza declarada: ${sub.confidence}`
    : 'EL AGENTE NO ENTREGÓ NINGÚN PLAN (agotó los pasos o falló).';

  return `Eres un evaluador imparcial de agentes SRE. Vas a puntuar la actuación de UN agente anónimo sobre un incidente simulado de Kubernetes. No sabes qué modelo es y no debes especular sobre ello.

=== ALERTA QUE RECIBIÓ EL AGENTE ===
${s.trigger}

=== REFERENCIA DEL DISEÑADOR DEL ESCENARIO (el agente NO la vio) ===
Qué pasó de verdad: ${s.narrative}
Recurso raíz: ${s.truth.component}
Planes aceptables: ${s.truth.acceptableActionSets.map((set) => set.map((a) => `${a.action} → ${a.target}`).join(' + ')).join(' | ')}
Acciones que castigan a la víctima o empeoran: ${(s.truth.forbiddenActions ?? []).map((a) => `${a.action} → ${a.target}`).join(', ') || 'ninguna definida'}
Nota: ${s.truth.notes}
Presupuesto razonable de consultas: ${s.truth.toolBudget}

=== TRAZA DEL AGENTE (${run.toolCalls.length} llamadas, ${run.steps} pasos) ===
${traceText(run) || '(sin llamadas)'}
${run.catalogViolations.length ? `\nIntentos rechazados por estar fuera del catálogo: ${run.catalogViolations.join('; ')}` : ''}
${run.finalText ? `\nTexto final del agente:\n${run.finalText}` : ''}

=== ENTREGA DEL AGENTE ===
${submissionText}

=== VERIFICACIÓN AUTOMÁTICA DE CITAS ===
${grounding.cited} citas; ${grounding.found} aparecen en los datos del cluster.${grounding.missing.length ? ` NO encontradas: ${grounding.missing.map((m) => `"${m}"`).join(', ')}` : ''}
Una cita "no encontrada" no es necesariamente inventada: puede ser una paráfrasis o un resumen correcto de una salida real (una serie de métricas, un listado de pods o nodos). Trátala como no verificable, no como falsa, salvo que contradiga la referencia del escenario.

=== DIMENSIONES ===
${DIMENSIONS.map((d) => `- ${d.id}: ${d.desc}`).join('\n')}

${RUBRIC}

Instrucciones:
- Puntúa contra la referencia, no contra tu intuición. Si el agente llega a un plan aceptable distinto del primero listado, es igual de válido.
- Un plan aceptable con evidencia inventada no puede pasar de 2 en "evidencia".
- Escalar a humano cuando la solución está fuera del catálogo es correcto, no cobardía.
- Sé severo con culpar a la víctima (reiniciar el servicio que sufre en vez del que causa).
- Responde SOLO con JSON válido, sin texto antes ni después ni bloques de código, con esta forma exacta:
{"dimensions":{${DIMENSIONS.map((d) => `"${d.id}":{"score":<1-5>,"rationale":"<1-2 frases>"}`).join(',')}},"verdict":"<2-3 frases: qué hizo bien, qué falló, qué habría hecho un SRE senior>"}`;
}

type Verdict = z.infer<typeof schema>;

/**
 * Parseo de reserva para jueces cuyo proveedor no soporta salida con esquema.
 * Quita vallas de código, recorta al primer "{" / último "}" y repara el fallo más
 * común observado: el modelo omite la llave que cierra "dimensions" antes de
 * "verdict", con lo que el JSON queda sin cerrar y "verdict" cae dentro de
 * "dimensions". Cualquier otra malformación sigue lanzando error.
 */
export function lenientParse(text: string): Verdict {
  let s = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  s = s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1);
  let obj: any;
  try {
    obj = JSON.parse(s);
  } catch {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (const ch of s) {
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    obj = JSON.parse(s + (inStr ? '"' : '') + '}'.repeat(Math.max(0, depth)));
  }
  if (obj && typeof obj.verdict !== 'string' && typeof obj.dimensions?.verdict === 'string') {
    obj = { ...obj, verdict: obj.dimensions.verdict };
  }
  return schema.parse(obj);
}

export async function judgeRun(run: RunResult, scenario: Scenario, judge: ModelSpec): Promise<QualityAssessment> {
  const grounding = checkEvidence(scenario, run.submission?.root_cause.evidence ?? []);
  const base: QualityAssessment = {
    judgeModel: judge.id,
    dimensions: [],
    overall: 0,
    verdict: '',
    evidenceGrounding: grounding,
    usage: { input: 0, output: 0 },
  };
  let text = '';
  let finish: string | undefined;
  let usage = { input: 0, output: 0 };
  try {
    let parsed: Verdict;
    try {
      const res = await generateText({
        model: gateway(judge.id),
        prompt: buildJudgePrompt(run, scenario, grounding),
        temperature: 0,
        output: Output.object({ schema, name: 'evaluacion_sre', description: 'Puntuación 1-5 por dimensión con justificación, y veredicto.' }),
        providerOptions: { gateway: { tags: ['agent-bench', 'judge', scenario.id] } },
      });
      text = res.text;
      finish = res.finishReason;
      usage = { input: res.totalUsage?.inputTokens ?? 0, output: res.totalUsage?.outputTokens ?? 0 };
      parsed = res.output ?? lenientParse(text);
    } catch (err) {
      // El modelo respondió pero el SDK no pudo validar el objeto (p.ej. el proveedor
      // ignora el esquema): intentamos el parseo tolerante sobre el texto crudo.
      if (!NoObjectGeneratedError.isInstance(err) || !err.text) throw err;
      text = err.text;
      finish = err.finishReason;
      usage = { input: err.usage?.inputTokens ?? 0, output: err.usage?.outputTokens ?? 0 };
      parsed = lenientParse(text);
    }
    const dimensions = DIMENSIONS.map((d) => ({ id: d.id, score: parsed.dimensions[d.id].score, rationale: parsed.dimensions[d.id].rationale }));
    const mean = dimensions.reduce((a, d) => a + d.score, 0) / dimensions.length;
    return {
      ...base,
      dimensions,
      overall: Math.round(((mean - 1) / 4) * 100),
      verdict: parsed.verdict,
      usage,
      costUsd: await estimateCost(judge, usage.input, usage.output),
    };
  } catch (err) {
    // Guardamos por qué paró el modelo y el final de la respuesta: distingue un JSON
    // truncado (finishReason=length) de uno mal formado.
    const why = (err as Error).message;
    const ctx = text
      ? ` · finishReason=${finish} · ${usage.output} tokens de salida · ${text.length} chars · final: …${text.slice(-160).replace(/\s+/g, ' ')}`
      : '';
    return { ...base, error: why + ctx };
  }
}
