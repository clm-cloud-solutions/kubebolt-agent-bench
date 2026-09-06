// Tipos compartidos por el harness, los escenarios, el CLI y la UI.

export interface PodInfo {
  name: string;
  namespace: string;
  phase: string; // Running | Pending | Failed | Succeeded
  ready: string; // "1/1", "0/1"
  status: string; // lo que muestra kubectl: Running, CrashLoopBackOff, OOMKilled, Evicted...
  restarts: number;
  age: string;
  node: string;
  owner?: string; // "deployment/api-pagos", "sparkapplication/ventas-diario"
}

export interface NodeInfo {
  name: string;
  status: string; // Ready | NotReady | Ready,SchedulingDisabled
  roles: string;
  age: string;
  version: string;
  conditions?: string[]; // "DiskPressure=True"
}

export interface K8sEvent {
  lastSeen: string; // "3m"
  type: 'Normal' | 'Warning';
  reason: string;
  object: string; // "pod/api-pagos-7d9f-x2k1"
  namespace: string;
  message: string;
  count?: number;
}

export interface MetricSeries {
  metric: string;
  labels: Record<string, string>;
  unit?: string;
  samples: [string, number][]; // [ISO timestamp, valor]
}

export interface ClusterSnapshot {
  name: string;
  description: string; // lo que ve el agente en la lista de clusters
  nodes: NodeInfo[];
  pods: PodInfo[];
  events: K8sEvent[];
  /** clave: "kind/namespace/name" (nodos: "node/-/name") */
  describe: Record<string, string>;
  /** clave: "namespace/pod" o "namespace/pod/container". String = solo logs actuales. */
  logs: Record<string, string | { current: string; previous?: string }>;
  /** clave: "kind/namespace/name" → YAML */
  manifests: Record<string, string>;
  metrics: MetricSeries[];
}

export interface ExpectedAction {
  action: string;
  target: string; // "deployment/pagos/api-pagos"
}

export interface ScenarioTruth {
  /** componente raíz, en minúsculas, para el matching */
  component: string;
  /** palabras clave que deberían aparecer en la causa raíz o la evidencia */
  keywords: string[];
  /** conjuntos de acciones aceptables; el score usa el mejor F1 */
  acceptableActionSets: ExpectedAction[][];
  /** acciones que penalizan (en general, dañinas o inútiles en este caso) */
  forbiddenActions?: ExpectedAction[];
  /** número de tool calls a partir del cual se penaliza eficiencia */
  toolBudget: number;
  /** si es true, añadir escalate_to_human a un plan aceptable no resta: la causa de fondo (GitOps, código) está fuera del catálogo */
  escalateTolerated?: boolean;
  notes: string;
}

export interface Scenario {
  id: string;
  title: string;
  category: string;
  difficulty: 'básico' | 'medio' | 'difícil';
  /** la alerta que dispara la investigación (visible para el agente) */
  trigger: string;
  /** contexto para humanos; nunca se le pasa al modelo */
  narrative: string;
  clusters: ClusterSnapshot[];
  truth: ScenarioTruth;
}

export interface ModelSpec {
  id: string; // identidad del modelo en el bench; es el id de Vercel AI Gateway salvo en las variantes, p.ej. "openai/gpt-6-astra@razonamiento-alto"
  /** id con el que se llama al gateway cuando la identidad lleva sufijo de variante; por defecto, `id` */
  gatewayId?: string;
  /** esfuerzo de razonamiento explícito del run; sin él, cada proveedor aplica su valor por defecto. Va como opción `reasoning` del AI SDK y el gateway lo traduce al formato nativo del proveedor que sirva la petición. */
  razonamiento?: 'ninguno' | 'mínimo' | 'bajo' | 'medio' | 'alto' | 'máximo';
  label: string;
  vendor: string;
  family: 'frontera' | 'china';
  /** fija el proveedor upstream (providerOptions.gateway.only) */
  pin?: string[];
  /** precio de respaldo en USD por millón de tokens, si el gateway no lo devuelve */
  fallbackPricing?: { input: number; output: number };
  verified?: boolean;
}

export interface Submission {
  root_cause: {
    component: string;
    summary: string;
    evidence: string[];
  };
  actions: { action: string; target: string; params?: Record<string, unknown>; reason?: string }[];
  confidence: number;
}

export interface ToolCallRecord {
  step: number;
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
  ms: number;
}

export interface ScoreBreakdown {
  total: number;
  rootCause: number; // /40
  actions: number; // /40
  efficiency: number; // /10
  safety: number; // /10
  details: string[];
}

export interface QualityDimension {
  id: string;
  score: number; // 1-5
  rationale: string;
}

export interface QualityAssessment {
  judgeModel: string;
  dimensions: QualityDimension[];
  overall: number; // media de dimensiones × 20 → 0-100
  verdict: string;
  evidenceGrounding: { cited: number; found: number; missing: string[] };
  usage: { input: number; output: number };
  costUsd?: number;
  error?: string;
}

export interface Batch {
  id: string;
  createdAt: string;
  models: string[];
  scenarios: string[];
  runsPer: number;
  judgeModel?: string;
  runIds: string[];
  status: 'running' | 'done';
  judgeCostUsd: number;
}

export interface RunResult {
  batchId?: string;
  quality?: QualityAssessment;
  id: string;
  timestamp: string;
  model: ModelSpec;
  scenarioId: string;
  scenarioTitle: string;
  ok: boolean;
  error?: string;
  steps: number;
  toolCalls: ToolCallRecord[];
  submission?: Submission;
  catalogViolations: string[];
  /** cómo terminó el bucle: entrega válida, pasos agotados, cierre con texto y sin llamada, cierre en silencio, o error */
  stopReason?: 'submitted' | 'max_steps' | 'no_call_text' | 'no_call_silent' | 'error';
  /** el modelo cerró sin entregar y recibió un único recordatorio final (BENCH_NUDGE) */
  nudged?: boolean;
  /** tokens del run; `cached` es la parte de la entrada servida desde caché del proveedor, cuando el adaptador la conoce */
  usage: { input: number; output: number; total: number; cached?: number };
  costUsd?: number;
  costSource: 'gateway' | 'pricing' | 'unknown';
  latencyMs: number;
  score: ScoreBreakdown;
  finalText?: string;
}

export type RunEvent =
  | { type: 'start'; model: string; scenario: string }
  | { type: 'tool_call'; step: number; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; step: number; name: string; preview: string; ok: boolean }
  | { type: 'text'; step: number; text: string }
  | { type: 'submission'; submission: Submission }
  | { type: 'violation'; message: string }
  | { type: 'done'; result: RunResult }
  | { type: 'error'; message: string };

export type BatchEvent =
  | { type: 'batch_start'; id: string; total: number }
  | { type: 'run_start'; model: string; scenario: string; index: number }
  | { type: 'run_done'; result: RunResult; index: number }
  | { type: 'judge_done'; runId: string; quality: QualityAssessment; index: number }
  | { type: 'batch_done'; id: string }
  | { type: 'error'; message: string };
