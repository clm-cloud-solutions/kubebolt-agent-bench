import { tool } from 'ai';
import { z } from 'zod';
import type { ClusterSnapshot, Scenario, Submission, RunEvent, ToolCallRecord } from './types';
import { validateAction } from './catalog';

// Estado mutable de un run: se rellena mientras el modelo llama herramientas.
export interface RunState {
  step: number;
  toolCalls: ToolCallRecord[];
  catalogViolations: string[];
  submission?: Submission;
  emit: (e: RunEvent) => void;
}

function pad(s: string, n: number) {
  return s.length >= n ? s + '  ' : s.padEnd(n);
}

function findCluster(scenario: Scenario, name: string): ClusterSnapshot | string {
  const c = scenario.clusters.find((x) => x.name === name);
  if (c) return c;
  return `Cluster "${name}" no existe. Clusters disponibles: ${scenario.clusters.map((x) => x.name).join(', ')}`;
}

function renderPods(c: ClusterSnapshot, namespace?: string) {
  const pods = namespace ? c.pods.filter((p) => p.namespace === namespace) : c.pods;
  if (!pods.length) return `No resources found${namespace ? ` in ${namespace} namespace` : ''}.`;
  const rows = [
    `${pad('NAMESPACE', 14)}${pad('NAME', 44)}${pad('READY', 7)}${pad('STATUS', 20)}${pad('RESTARTS', 10)}${pad('AGE', 7)}NODE`,
    ...pods.map(
      (p) =>
        `${pad(p.namespace, 14)}${pad(p.name, 44)}${pad(p.ready, 7)}${pad(p.status, 20)}${pad(String(p.restarts), 10)}${pad(p.age, 7)}${p.node}`,
    ),
  ];
  return rows.join('\n');
}

function renderNodes(c: ClusterSnapshot) {
  const rows = [
    `${pad('NAME', 34)}${pad('STATUS', 28)}${pad('ROLES', 8)}${pad('AGE', 7)}${pad('VERSION', 10)}CONDITIONS`,
    ...c.nodes.map(
      (n) =>
        `${pad(n.name, 34)}${pad(n.status, 28)}${pad(n.roles, 8)}${pad(n.age, 7)}${pad(n.version, 10)}${(n.conditions ?? []).join(',') || '-'}`,
    ),
  ];
  return rows.join('\n');
}

function renderEvents(c: ClusterSnapshot, namespace?: string, object?: string) {
  let ev = c.events;
  if (namespace) ev = ev.filter((e) => e.namespace === namespace);
  if (object) ev = ev.filter((e) => e.object.toLowerCase().includes(object.toLowerCase()));
  if (!ev.length) return 'No events found.';
  const rows = [
    `${pad('LAST SEEN', 11)}${pad('TYPE', 9)}${pad('REASON', 22)}${pad('OBJECT', 48)}MESSAGE`,
    ...ev.map(
      (e) =>
        `${pad(e.lastSeen, 11)}${pad(e.type, 9)}${pad(e.reason, 22)}${pad(e.object, 48)}${e.message}${e.count && e.count > 1 ? ` (x${e.count})` : ''}`,
    ),
  ];
  return rows.join('\n');
}

const MAX_CHARS = 6000;
/** Sin tail ni grep, un log largo devuelve solo sus últimas líneas, como haría un SRE antes de hacer grep. */
const LOG_DEFAULT_TAIL = 60;
function clip(s: string) {
  return s.length > MAX_CHARS ? s.slice(0, MAX_CHARS) + `\n... [truncado, ${s.length - MAX_CHARS} chars más]` : s;
}

/** Envuelve execute() para registrar la llamada y emitir eventos de traza. */
function tracked<I extends Record<string, unknown>>(
  name: string,
  state: RunState,
  fn: (input: I) => string | Promise<string>,
) {
  return async (input: I) => {
    const t0 = Date.now();
    state.emit({ type: 'tool_call', step: state.step, name, input });
    let out: string;
    let ok = true;
    try {
      out = await fn(input);
    } catch (err) {
      ok = false;
      out = `error: ${(err as Error).message}`;
    }
    if (out.startsWith('Cluster "') || out.startsWith('No ') || out.startsWith('error:')) ok = out.startsWith('No ') ? true : false;
    state.toolCalls.push({ step: state.step, name, input, ok, ms: Date.now() - t0 });
    state.emit({ type: 'tool_result', step: state.step, name, ok, preview: out.slice(0, 240) });
    return clip(out);
  };
}

export function buildTools(scenario: Scenario, state: RunState) {
  const clusterEnum = scenario.clusters.map((c) => c.name);
  const clusterDesc = `Nombre del cluster. Disponibles: ${clusterEnum.join(', ')}`;

  return {
    list_pods: tool({
      description: 'Equivale a `kubectl get pods -o wide`. Sin namespace lista todos los namespaces.',
      inputSchema: z.object({
        cluster: z.string().describe(clusterDesc),
        namespace: z.string().optional(),
      }),
      execute: tracked('list_pods', state, ({ cluster, namespace }) => {
        const c = findCluster(scenario, cluster);
        return typeof c === 'string' ? c : renderPods(c, namespace);
      }),
    }),

    list_nodes: tool({
      description: 'Equivale a `kubectl get nodes` con condiciones relevantes.',
      inputSchema: z.object({ cluster: z.string().describe(clusterDesc) }),
      execute: tracked('list_nodes', state, ({ cluster }) => {
        const c = findCluster(scenario, cluster);
        return typeof c === 'string' ? c : renderNodes(c);
      }),
    }),

    describe: tool({
      description:
        'Equivale a `kubectl describe <kind> <name> -n <namespace>`. Kinds: pod, deployment, statefulset, node, hpa, configmap, pvc, sparkapplication... Para nodos usa namespace "-".',
      inputSchema: z.object({
        cluster: z.string().describe(clusterDesc),
        kind: z.string(),
        namespace: z.string().describe('"-" para recursos sin namespace (node)'),
        name: z.string(),
      }),
      execute: tracked('describe', state, ({ cluster, kind, namespace, name }) => {
        const c = findCluster(scenario, cluster);
        if (typeof c === 'string') return c;
        const key = `${kind.toLowerCase()}/${namespace}/${name}`;
        const hit = c.describe[key];
        if (hit) return hit;
        const near = Object.keys(c.describe).filter((k) => k.startsWith(kind.toLowerCase() + '/'));
        return `Error from server (NotFound): ${kind} "${name}" not found in namespace "${namespace}".${near.length ? ` Recursos de ese kind conocidos: ${near.join(', ')}` : ''}`;
      }),
    }),

    get_logs: tool({
      description:
        'Equivale a `kubectl logs <pod> [-c container] [--previous] --tail N | grep -i -C context <regex>`. Usa previous=true para ver el contenedor anterior tras un crash. Los logs largos devuelven solo sus últimas líneas: usa grep para buscar términos (error, fatal, timeout, un nombre de recurso...) en vez de leerlos enteros.',
      inputSchema: z.object({
        cluster: z.string().describe(clusterDesc),
        namespace: z.string(),
        pod: z.string(),
        container: z.string().optional(),
        previous: z.boolean().optional(),
        tail: z.number().int().min(1).max(500).optional(),
        grep: z.string().optional().describe('expresión regular, sin distinguir mayúsculas, para filtrar líneas (como grep -i)'),
        context: z.number().int().min(0).max(5).optional().describe('líneas de contexto antes y después de cada coincidencia de grep (como -C)'),
      }),
      execute: tracked('get_logs', state, ({ cluster, namespace, pod, container, previous, tail, grep, context }) => {
        const c = findCluster(scenario, cluster);
        if (typeof c === 'string') return c;
        const key = container ? `${namespace}/${pod}/${container}` : `${namespace}/${pod}`;
        const raw = c.logs[key] ?? c.logs[`${namespace}/${pod}`];
        const entry = typeof raw === 'string' ? { current: raw } : raw;
        if (!entry) {
          const podExists = c.pods.some((p) => p.namespace === namespace && p.name === pod);
          return podExists
            ? `(sin logs disponibles para ${key}; el contenedor puede no haber arrancado)`
            : `Error from server (NotFound): pods "${pod}" not found in namespace "${namespace}"`;
        }
        if (previous && !entry.previous) return `Error from server (BadRequest): previous terminated container for "${pod}" not found`;
        const text = previous ? entry.previous! : entry.current;
        const lines = text.split('\n');
        if (grep) {
          let re: RegExp;
          try {
            // Algunos modelos anteponen banderas inline ((?i), (?s)...), que JavaScript rechaza. El grep ya es
            // insensible a mayúsculas: se descartan en vez de fallar la llamada.
            re = new RegExp(grep.replace(/^\(\?[a-z]+\)/, ''), 'i');
          } catch {
            return `error: expresión grep inválida: ${grep}`;
          }
          const hits = lines.map((l, i) => (re.test(l) ? i : -1)).filter((i) => i >= 0);
          if (!hits.length) return `(0 de ${lines.length} líneas coinciden con /${grep}/i)`;
          const ctx = context ?? 0;
          const keep = new Set<number>();
          for (const i of hits) for (let j = Math.max(0, i - ctx); j <= Math.min(lines.length - 1, i + ctx); j++) keep.add(j);
          const out = [...keep].sort((a, b) => a - b).map((i) => `${String(i + 1).padStart(4)}: ${lines[i]}`);
          const shown = tail ? out.slice(-tail) : out;
          return `(${hits.length} de ${lines.length} líneas coinciden con /${grep}/i${shown.length < out.length ? `; mostrando las últimas ${shown.length}` : ''})\n${shown.join('\n')}`;
        }
        const n = tail ?? Math.min(lines.length, LOG_DEFAULT_TAIL);
        const slice = lines.slice(-n);
        const header = lines.length > n ? `(log de ${lines.length} líneas; mostrando las últimas ${n}. Usa grep=<regex> para buscar términos o tail=N para ver más)\n` : '';
        return header + slice.join('\n');
      }),
    }),

    get_events: tool({
      description: 'Equivale a `kubectl get events --sort-by=.lastTimestamp`. Filtra por namespace y/o por nombre de objeto.',
      inputSchema: z.object({
        cluster: z.string().describe(clusterDesc),
        namespace: z.string().optional(),
        object: z.string().optional().describe('subcadena del nombre del objeto, p.ej. "api-pagos"'),
      }),
      execute: tracked('get_events', state, ({ cluster, namespace, object }) => {
        const c = findCluster(scenario, cluster);
        return typeof c === 'string' ? c : renderEvents(c, namespace, object);
      }),
    }),

    get_manifest: tool({
      description: 'Equivale a `kubectl get <kind> <name> -n <namespace> -o yaml` (versión resumida, sin managedFields).',
      inputSchema: z.object({
        cluster: z.string().describe(clusterDesc),
        kind: z.string(),
        namespace: z.string(),
        name: z.string(),
      }),
      execute: tracked('get_manifest', state, ({ cluster, kind, namespace, name }) => {
        const c = findCluster(scenario, cluster);
        if (typeof c === 'string') return c;
        const key = `${kind.toLowerCase()}/${namespace}/${name}`;
        if (c.manifests[key]) return c.manifests[key];
        // Un recurso que existe en describe nunca debe salir como NotFound: un kubectl real
        // devolvería el YAML. Si la foto no lo trae, se dice tal cual y se remite a describe.
        if (c.describe[key]) return `El manifest YAML de ${kind} "${name}" en "${namespace}" no está disponible; el recurso existe. Usa describe para ver spec, estado y eventos.`;
        return `Error from server (NotFound): ${kind} "${name}" not found in namespace "${namespace}"`;
      }),
    }),

    query_metrics: tool({
      description:
        'Consulta series de métricas (estilo Prometheus) por nombre de métrica y filtro de labels. Devuelve las últimas muestras. Métricas típicas: container_memory_working_set_bytes, container_cpu_usage_seconds_total, kube_pod_container_status_restarts_total, http_request_duration_seconds_p99, node_filesystem_avail_bytes.',
      inputSchema: z.object({
        cluster: z.string().describe(clusterDesc),
        metric: z.string(),
        labels: z.record(z.string(), z.string()).optional().describe('subconjunto de labels a igualar, p.ej. {"namespace":"pagos"}'),
      }),
      execute: tracked('query_metrics', state, ({ cluster, metric, labels }) => {
        const c = findCluster(scenario, cluster);
        if (typeof c === 'string') return c;
        const series = c.metrics.filter(
          (s) =>
            s.metric === metric &&
            Object.entries(labels ?? {}).every(([k, v]) => s.labels[k] === v),
        );
        if (!series.length) {
          const known = [...new Set(c.metrics.map((s) => s.metric))];
          return `No series match ${metric}${labels ? ' ' + JSON.stringify(labels) : ''}. Métricas disponibles en este cluster: ${known.join(', ')}`;
        }
        return series
          .map((s) => {
            const lbl = Object.entries(s.labels).map(([k, v]) => `${k}="${v}"`).join(', ');
            const pts = s.samples.map(([t, v]) => `  ${t}  ${v}`).join('\n');
            return `${s.metric}{${lbl}}${s.unit ? ` [${s.unit}]` : ''}\n${pts}`;
          })
          .join('\n\n');
      }),
    }),

    submit_remediation: tool({
      description:
        'Entrega el diagnóstico final y el plan de remediación. Llámala UNA sola vez cuando tengas evidencia suficiente. Las acciones deben ser del catálogo; si no lo son, se rechazan.',
      inputSchema: z.object({
        root_cause: z.object({
          component: z.string().describe('recurso raíz en formato kind/namespace/name'),
          summary: z.string().describe('causa raíz en 1-3 frases, concreta'),
          evidence: z.array(z.string()).min(1).describe('citas literales de logs/eventos/métricas que la sostienen'),
        }),
        actions: z
          .array(
            z.object({
              action: z.string().describe('id del catálogo'),
              target: z.string().describe('kind/namespace/name'),
              params: z.record(z.string(), z.unknown()).optional(),
              reason: z.string().optional(),
            }),
          )
          .min(1),
        confidence: z.number().min(0).max(1),
      }),
      execute: tracked('submit_remediation', state, (input) => {
        const errors: string[] = [];
        for (const a of input.actions) {
          const err = validateAction(a.action, a.target);
          if (err) errors.push(err);
        }
        if (errors.length) {
          for (const e of errors) {
            state.catalogViolations.push(e);
            state.emit({ type: 'violation', message: e });
          }
          return `RECHAZADO. ${errors.join('; ')}. Corrige el plan usando solo acciones del catálogo y vuelve a llamar submit_remediation.`;
        }
        state.submission = input as Submission;
        state.emit({ type: 'submission', submission: input as Submission });
        return 'Plan registrado. Fin de la investigación.';
      }),
    }),
  };
}
