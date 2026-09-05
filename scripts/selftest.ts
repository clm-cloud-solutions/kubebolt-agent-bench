// Autotest sin LLM: ejercita el kubectl falso de cada escenario y comprueba
// que el scoring da 100 al plan perfecto y castiga al plan de "culpar a la víctima".
//
//   npm run selftest
//
import { SCENARIOS } from '../src/scenarios';
import { buildTools, type RunState } from '../src/lib/harness/fakeKubectl';
import { score, normKind } from '../src/lib/harness/scoring';

let failures = 0;
const ctx = { toolCallId: 't', messages: [] as any[] };

for (const s of SCENARIOS) {
  const state: RunState = { step: 0, toolCalls: [], catalogViolations: [], emit: () => {} };
  const tools = buildTools(s, state) as any;

  // 1) el kubectl falso responde a las consultas básicas
  for (const c of s.clusters) {
    const pods = await tools.list_pods.execute({ cluster: c.name }, ctx);
    const nodes = await tools.list_nodes.execute({ cluster: c.name }, ctx);
    const events = await tools.get_events.execute({ cluster: c.name }, ctx);
    if (!pods.includes('NAME') || !nodes.includes('NAME') || !events.includes('LAST SEEN')) {
      console.error(`✗ ${s.id}/${c.name}: alguna consulta básica no devuelve tabla`);
      failures++;
    }
    for (const key of Object.keys(c.describe)) {
      const [kind, ns, name] = key.split('/');
      const out = await tools.describe.execute({ cluster: c.name, kind, namespace: ns, name }, ctx);
      if (out.startsWith('Error')) { console.error(`✗ ${s.id}: describe ${key} → ${out.slice(0, 60)}`); failures++; }
    }
    // Un recurso con describe no puede salir como NotFound en get_manifest: un kubectl real no se contradice.
    for (const key of Object.keys(c.describe)) {
      const [kind, ns, name] = key.split('/');
      const out = await tools.get_manifest.execute({ cluster: c.name, kind, namespace: ns, name }, ctx);
      if (out.startsWith('Error from server (NotFound)')) { console.error(`✗ ${s.id}: get_manifest ${key} devuelve NotFound aunque existe en describe`); failures++; }
    }
    for (const key of Object.keys(c.logs)) {
      const [ns, pod, container] = key.split('/');
      const out = await tools.get_logs.execute({ cluster: c.name, namespace: ns, pod, container }, ctx);
      if (out.startsWith('Error')) { console.error(`✗ ${s.id}: logs ${key} → ${out.slice(0, 60)}`); failures++; }
    }
  }
  const investigative = state.toolCalls.length;

  // 2) plan perfecto → 100
  const perfect = {
    root_cause: { component: s.truth.component, summary: s.truth.keywords.join(' '), evidence: s.truth.keywords },
    actions: s.truth.acceptableActionSets[0],
    confidence: 0.9,
  };
  const st2: RunState = { step: 0, toolCalls: [], catalogViolations: [], emit: () => {} };
  const sc = score(s, perfect, st2.toolCalls, []);
  if (sc.total !== 100) { console.error(`✗ ${s.id}: plan perfecto puntúa ${sc.total}`, sc.details); failures++; }

  // 3) plan "culpar a la víctima" → bajo
  const bad = {
    root_cause: { component: 'deployment/x/otro', summary: 'reiniciar', evidence: ['nada'] },
    actions: s.truth.forbiddenActions?.slice(0, 1) ?? [{ action: 'delete_pod', target: 'pod/x/y' }],
    confidence: 0.9,
  };
  const scBad = score(s, bad, [], []);
  if (scBad.total > 30) { console.error(`✗ ${s.id}: plan malo puntúa ${scBad.total}`, scBad.details); failures++; }

  // 4) acción fuera de catálogo se rechaza
  const st3: RunState = { step: 0, toolCalls: [], catalogViolations: [], emit: () => {} };
  const t3 = buildTools(s, st3) as any;
  const rej = await t3.submit_remediation.execute({ ...perfect, actions: [{ action: 'kubectl_delete_namespace', target: 'namespace/-/pagos' }] }, ctx);
  if (!rej.startsWith('RECHAZADO') || st3.catalogViolations.length !== 1) { console.error(`✗ ${s.id}: no rechazó acción fuera de catálogo`); failures++; }

  console.log(`${failures ? '·' : '✓'} ${s.id.padEnd(22)} ${investigative} consultas OK · perfecto ${sc.total} · malo ${scBad.total}`);
}
// 5) Reglas de puntuación transversales
{
  const dep = SCENARIOS.find((s) => s.id === 'dependency-escalate')!;
  const alias = score(dep, { root_cause: { component: 'statefulset/db/pg-primary', summary: dep.truth.keywords.join(' '), evidence: ['x'] }, actions: [{ action: 'escalate_to_human', target: 'persistentvolumeclaim/db/data-pg-primary-0' }], confidence: 0.9 }, [], []);
  if (alias.actions !== 40 || normKind('HorizontalPodAutoscaler') !== 'hpa') { console.error('✗ alias de kind: persistentvolumeclaim debería valer como pvc', alias.details); failures++; }
  const img = SCENARIOS.find((s) => s.id === 'imagepull-tag')!;
  const tol = score(img, { root_cause: { component: img.truth.component, summary: img.truth.keywords.join(' '), evidence: ['x'] }, actions: [...img.truth.acceptableActionSets[0], { action: 'escalate_to_human', target: img.truth.component }], confidence: 0.9 }, [], []);
  if (tol.actions !== 40) { console.error('✗ escalate_to_human tolerado en imagepull-tag debería dar 40', tol.details); failures++; }
  const hpa = SCENARIOS.find((s) => s.id === 'hpa-maxed')!;
  const noact = score(hpa, { root_cause: { component: hpa.truth.component, summary: hpa.truth.keywords.join(' '), evidence: ['x'] }, actions: [...hpa.truth.acceptableActionSets[0], { action: 'no_action', target: 'statefulset/busqueda/opensearch' }], confidence: 0.9 }, [], []);
  if (noact.actions !== 40) { console.error('✗ no_action extra no debería restar', noact.details); failures++; }
  const esc = score(hpa, { root_cause: { component: hpa.truth.component, summary: hpa.truth.keywords.join(' '), evidence: ['x'] }, actions: [...hpa.truth.acceptableActionSets[0], { action: 'escalate_to_human', target: hpa.truth.component }], confidence: 0.9 }, [], []);
  if (esc.actions === 40) { console.error('✗ escalate_to_human no tolerado en hpa-maxed debería restar', esc.details); failures++; }
  const eff = score(hpa, undefined, Array.from({ length: hpa.truth.toolBudget * 2 }, () => ({ step: 0, name: 'describe', input: {}, ok: true, ms: 1 })), []);
  if (eff.efficiency !== 5) { console.error(`✗ eficiencia al doble del presupuesto debería ser 5, es ${eff.efficiency}`); failures++; }
  // grep en get_logs
  const cm = SCENARIOS.find((s) => s.id === 'configmap-crashloop')!;
  const st = { step: 0, toolCalls: [], catalogViolations: [], emit: () => {} } as RunState;
  const t = buildTools(cm, st) as any;
  const g = await t.get_logs.execute({ cluster: 'prod-es', namespace: 'pagos', pod: 'api-pagos-7d9f8c6b5-k2x8w', grep: 'fatal' }, ctx);
  if (!/1 de 3 líneas coinciden/.test(g) || !g.includes('DATABASE_URL')) { console.error('✗ get_logs grep no devuelve la línea fatal:', g.slice(0, 120)); failures++; }
  const g0 = await t.get_logs.execute({ cluster: 'prod-es', namespace: 'pagos', pod: 'api-pagos-7d9f8c6b5-k2x8w', grep: 'inexistente' }, ctx);
  if (!g0.startsWith('(0 de')) { console.error('✗ get_logs grep sin coincidencias:', g0.slice(0, 80)); failures++; }
  console.log(`${failures ? '·' : '✓'} reglas transversales: alias, extras tolerados, eficiencia, grep`);
}
console.log(failures ? `\n${failures} fallos` : '\nTodo correcto.');
process.exit(failures ? 1 : 0);
