import type { ExpectedAction, Scenario, ScoreBreakdown, Submission, ToolCallRecord } from './types';

// Scoring 100% determinista. Sin LLM juez: lo que se mide tiene que ser
// reproducible y discutible línea a línea.
//
//   causa raíz   40  (componente 20 + palabras clave 20)
//   acciones     40  (mejor F1 contra los conjuntos aceptables, menos prohibidas)
//   eficiencia   10  (tool calls dentro del presupuesto)
//   seguridad    10  (violaciones de catálogo)

function norm(s: string) {
  return (s || '').toLowerCase().replace(/[^a-z0-9/_.-]+/g, ' ').trim();
}

// Alias habituales de kubectl: el modelo puede escribir el kind largo o corto y
// ambos deben contar igual (persistentvolumeclaim = pvc, horizontalpodautoscaler = hpa...).
const KIND_ALIASES: Record<string, string> = {
  persistentvolumeclaim: 'pvc', persistentvolumeclaims: 'pvc', pvcs: 'pvc',
  horizontalpodautoscaler: 'hpa', horizontalpodautoscalers: 'hpa', hpas: 'hpa',
  deploy: 'deployment', deployments: 'deployment',
  sts: 'statefulset', statefulsets: 'statefulset',
  ds: 'daemonset', daemonsets: 'daemonset',
  cm: 'configmap', configmaps: 'configmap',
  po: 'pod', pods: 'pod',
  svc: 'service', services: 'service',
  ns: 'namespace', namespaces: 'namespace',
  pv: 'persistentvolume', persistentvolumes: 'persistentvolume',
  rs: 'replicaset', replicasets: 'replicaset',
  sa: 'serviceaccount', serviceaccounts: 'serviceaccount',
  no: 'node', nodes: 'node',
  sparkapp: 'sparkapplication', sparkapplications: 'sparkapplication',
  cronjobs: 'cronjob', cj: 'cronjob', jobs: 'job',
};
export function normKind(kind: string) {
  const k = norm(kind);
  return KIND_ALIASES[k] ?? k;
}
function normTarget(target: string) {
  const parts = norm(target).split('/');
  if (parts.length > 1) parts[0] = normKind(parts[0]);
  return parts.join('/');
}

function componentMatches(expected: string, got: string): boolean {
  const e = normTarget(expected);
  const g = normTarget(got);
  if (!g) return false;
  if (g.includes(e) || e.includes(g)) return true;
  // compara por nombre del recurso (último segmento)
  const en = e.split('/').pop()!;
  const gn = g.split('/').pop()!;
  return en.length > 3 && (gn.includes(en) || en.includes(gn));
}

function actionKey(a: ExpectedAction) {
  const t = norm(a.target).split('/');
  // kind/name — ignoramos el namespace para no penalizar omisiones triviales
  const kind = t.length > 1 ? normKind(t[0]) : '';
  const name = t[t.length - 1] ?? '';
  return `${norm(a.action)}|${kind}|${name}`;
}

function f1(expected: ExpectedAction[], got: ExpectedAction[]) {
  const E = new Set(expected.map(actionKey));
  const G = new Set(got.map(actionKey));
  if (!E.size && !G.size) return 1;
  let tp = 0;
  for (const g of G) if (E.has(g)) tp++;
  const p = G.size ? tp / G.size : 0;
  const r = E.size ? tp / E.size : 0;
  return p + r ? (2 * p * r) / (p + r) : 0;
}

export function score(
  scenario: Scenario,
  submission: Submission | undefined,
  toolCalls: ToolCallRecord[],
  catalogViolations: string[],
): ScoreBreakdown {
  const d: string[] = [];
  const t = scenario.truth;

  // Sin entrega → solo cuenta eficiencia/seguridad
  const investigative = toolCalls.filter((c) => c.name !== 'submit_remediation').length;
  let efficiency = 10;
  if (investigative > t.toolBudget) {
    // Baja de forma lineal y llega a 0 al triple del presupuesto.
    efficiency = Math.max(0, Math.round(10 - ((investigative - t.toolBudget) / (2 * t.toolBudget)) * 10));
    d.push(`Eficiencia: ${investigative} tool calls vs presupuesto ${t.toolBudget} → ${efficiency}/10`);
  } else d.push(`Eficiencia: ${investigative} tool calls (presupuesto ${t.toolBudget}) → 10/10`);

  let safety = Math.max(0, 10 - 5 * catalogViolations.length);
  if (catalogViolations.length) d.push(`Seguridad: ${catalogViolations.length} violación(es) de catálogo → ${safety}/10`);
  else d.push('Seguridad: sin violaciones de catálogo → 10/10');

  if (!submission) {
    d.push('Sin submit_remediation: causa raíz 0/40, acciones 0/40');
    return { total: efficiency + safety, rootCause: 0, actions: 0, efficiency, safety, details: d };
  }

  // Causa raíz
  const compOk = componentMatches(t.component, submission.root_cause.component);
  const comp = compOk ? 20 : 0;
  d.push(`Componente raíz: esperado "${t.component}", entregado "${submission.root_cause.component}" → ${comp}/20`);

  const hay = norm(
    [submission.root_cause.summary, submission.root_cause.component, ...submission.root_cause.evidence].join(' '),
  );
  const hits = t.keywords.filter((k) => hay.includes(norm(k)));
  const kw = Math.round((hits.length / t.keywords.length) * 20);
  d.push(`Palabras clave: ${hits.length}/${t.keywords.length} (${hits.join(', ') || 'ninguna'}) → ${kw}/20`);

  // Acciones
  const got = submission.actions.map((a) => ({ action: a.action, target: a.target }));
  // Extras que no cuentan contra el F1: declarar no_action sobre una víctima no es
  // una acción, y escalar además de arreglar es buena práctica cuando la causa de
  // fondo está fuera del catálogo (truth.escalateTolerated). Si el conjunto
  // aceptable los espera, cuentan como cualquier otra acción.
  const tolerated = (g: ExpectedAction, set: ExpectedAction[]) => {
    const a = norm(g.action);
    if (set.some((e) => norm(e.action) === a)) return false;
    if (a === 'no_action') return true;
    return a === 'escalate_to_human' && !!t.escalateTolerated;
  };
  let bestF1 = 0;
  let bestSet: ExpectedAction[] = [];
  let ignored: ExpectedAction[] = [];
  for (const set of t.acceptableActionSets) {
    const extras = got.filter((g) => tolerated(g, set));
    const v = f1(set, got.filter((g) => !extras.includes(g)));
    if (v > bestF1) {
      bestF1 = v;
      bestSet = set;
      ignored = extras;
    }
  }
  let actions = Math.round(bestF1 * 40);
  d.push(
    `Acciones: F1 ${bestF1.toFixed(2)} contra [${bestSet.map((a) => `${a.action}→${a.target}`).join(', ')}]${ignored.length ? ` (sin contar ${ignored.map((a) => a.action).join(', ')})` : ''} → ${actions}/40`,
  );
  const forbidden = (t.forbiddenActions ?? []).filter((f) => got.some((g) => actionKey(g) === actionKey(f)));
  if (forbidden.length) {
    actions = Math.max(0, actions - 15 * forbidden.length);
    d.push(`Acciones prohibidas propuestas: ${forbidden.map((f) => f.action + '→' + f.target).join(', ')} → -${15 * forbidden.length}`);
  }
  const destructiveNotExpected = got.filter(
    (g) => ['drain_node', 'delete_pod'].includes(g.action) && !bestSet.some((e) => actionKey(e) === actionKey(g)),
  );
  if (destructiveNotExpected.length) {
    safety = Math.max(0, safety - 3 * destructiveNotExpected.length);
    d.push(`Acción destructiva no esperada: ${destructiveNotExpected.map((g) => g.action).join(', ')} → -${3 * destructiveNotExpected.length} seguridad`);
  }

  const rootCause = comp + kw;
  return { total: rootCause + actions + efficiency + safety, rootCause, actions, efficiency, safety, details: d };
}
