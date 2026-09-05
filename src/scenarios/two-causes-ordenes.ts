import type { Scenario } from '@/lib/harness/types';
import { noisyLog } from './lib/logs';

// Difícil. Dos causas a la vez, y las dos hay que arreglarlas. (1) inventario tiene
// el HPA topado en maxReplicas=4 con una campaña de tráfico y responde con timeouts
// en ~10 % de llamadas. (2) La revisión 42 de api-ordenes (hace 25 min) cambió el
// cliente HTTP: INVENTARIO_RETRIES 2→0 y INVENTARIO_TIMEOUT_MS 1500→300, así que
// cada timeout se convierte en 5xx en vez de reintentarse. Solo el rollback deja un
// 2 % de errores; solo el HPA deja un 4 %. Las dos acciones juntas vuelven al 0,3 %.

const ACCESS = [
  'INFO  GET /ordenes/{n} 200 {ms}ms upstream=inventario:{ms}ms',
  'INFO  POST /ordenes 201 {ms}ms upstream=inventario:{ms}ms items=3',
  'INFO  GET /ordenes/{n}/estado 200 {ms}ms cache=hit',
  'INFO  GET /health 200 2ms',
  'DEBUG carrito {id} validado items=2 total={n}.00',
];

export const scenario: Scenario = {
  id: 'two-causes-ordenes',
  title: 'api-ordenes con 18 % de 5xx: dos causas que se suman',
  category: 'Dependencias / despliegues',
  difficulty: 'difícil',
  trigger: `[CRITICAL] HighErrorRate
namespace=tienda service=api-ordenes cluster=prod-es
5xx = 18% durante 12 min (SLO 1%). p99 = 2.9s.
Último despliegue de api-ordenes: hace 25 min (revision 42)`,
  narrative:
    'Dos causas simultáneas. El HPA de inventario está topado en 4 réplicas con tráfico ×2 (campaña) y responde con timeouts en un 10 % de llamadas; y la revisión 42 de api-ordenes quitó los reintentos y bajó el timeout a 300 ms, convirtiendo cada timeout en un 5xx. Con solo el rollback quedan un 2 % de errores; con solo el HPA, un 4 %. Hay que hacer las dos cosas: subir maxReplicas de inventario y volver a la revisión 41 de api-ordenes.',
  clusters: [
    {
      name: 'prod-es',
      description: 'AKS producción España. Namespaces: tienda, catalogo, ingress-nginx, monitoring. Cluster autoscaler activo (nodepool 3-6 nodos).',
      nodes: [
        { name: 'aks-userpool-11223344-vmss000000', status: 'Ready', roles: '<none>', age: '63d', version: 'v1.31.2' },
        { name: 'aks-userpool-11223344-vmss000001', status: 'Ready', roles: '<none>', age: '63d', version: 'v1.31.2' },
        { name: 'aks-userpool-11223344-vmss000002', status: 'Ready', roles: '<none>', age: '63d', version: 'v1.31.2' },
        { name: 'aks-userpool-11223344-vmss000003', status: 'Ready', roles: '<none>', age: '38m', version: 'v1.31.2' },
      ],
      pods: [
        { name: 'api-ordenes-8c7d6e5f4-a1b2c', namespace: 'tienda', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '25m', node: 'aks-userpool-11223344-vmss000000', owner: 'deployment/api-ordenes' },
        { name: 'api-ordenes-8c7d6e5f4-d3e4f', namespace: 'tienda', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '24m', node: 'aks-userpool-11223344-vmss000001', owner: 'deployment/api-ordenes' },
        { name: 'api-ordenes-8c7d6e5f4-g5h6i', namespace: 'tienda', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '24m', node: 'aks-userpool-11223344-vmss000002', owner: 'deployment/api-ordenes' },
        { name: 'api-ordenes-8c7d6e5f4-j7k8l', namespace: 'tienda', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '23m', node: 'aks-userpool-11223344-vmss000003', owner: 'deployment/api-ordenes' },
        { name: 'inventario-5f4e3d2c1-m9n0o', namespace: 'tienda', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '12d', node: 'aks-userpool-11223344-vmss000000', owner: 'deployment/inventario' },
        { name: 'inventario-5f4e3d2c1-p1q2r', namespace: 'tienda', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '12d', node: 'aks-userpool-11223344-vmss000001', owner: 'deployment/inventario' },
        { name: 'inventario-5f4e3d2c1-s3t4u', namespace: 'tienda', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '41m', node: 'aks-userpool-11223344-vmss000002', owner: 'deployment/inventario' },
        { name: 'inventario-5f4e3d2c1-v5w6x', namespace: 'tienda', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '39m', node: 'aks-userpool-11223344-vmss000003', owner: 'deployment/inventario' },
        { name: 'redis-ordenes-0', namespace: 'tienda', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '63d', node: 'aks-userpool-11223344-vmss000002', owner: 'statefulset/redis-ordenes' },
        { name: 'catalogo-web-2a3b4c5d6-y7z8a', namespace: 'catalogo', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '5d', node: 'aks-userpool-11223344-vmss000001', owner: 'deployment/catalogo-web' },
      ],
      events: [
        { lastSeen: '25m', type: 'Normal', reason: 'ScalingReplicaSet', object: 'deployment/api-ordenes', namespace: 'tienda', message: 'Scaled up replica set api-ordenes-8c7d6e5f4 to 4' },
        { lastSeen: '23m', type: 'Normal', reason: 'ScalingReplicaSet', object: 'deployment/api-ordenes', namespace: 'tienda', message: 'Scaled down replica set api-ordenes-7b6c5d4e3 to 0' },
        { lastSeen: '41m', type: 'Normal', reason: 'SuccessfulRescale', object: 'horizontalpodautoscaler/inventario', namespace: 'tienda', message: 'New size: 4; reason: cpu resource utilization (percentage of request) above target' },
        { lastSeen: '38m', type: 'Normal', reason: 'TriggeredScaleUp', object: 'pod/inventario-5f4e3d2c1-v5w6x', namespace: 'tienda', message: 'pod triggered scale-up: [{aks-userpool-11223344-vmss 3->4 (max: 6)}]' },
        { lastSeen: '1m', type: 'Warning', reason: 'FailedComputeMetricsReplicas', object: 'horizontalpodautoscaler/inventario', namespace: 'tienda', message: 'invalid metrics (0 invalid out of 1); desired replicas 9 exceeds maxReplicas 4 — capped', count: 38 },
      ],
      describe: {
        'deployment/tienda/api-ordenes': `Name:                   api-ordenes
Namespace:              tienda
Annotations:            deployment.kubernetes.io/revision: 42
                        argocd.argoproj.io/tracking-id: tienda:apps/Deployment:tienda/api-ordenes
Replicas:               4 desired | 4 updated | 4 total | 4 available | 0 unavailable
Pod Template:
  Containers:
   api:
    Image:      acrclm.azurecr.io/tienda/api-ordenes:3.7.0
    Environment:
      INVENTARIO_URL:         http://inventario.tienda.svc:8080
      INVENTARIO_TIMEOUT_MS:  300
      INVENTARIO_RETRIES:     0
      REDIS_ADDR:             redis-ordenes.tienda.svc:6379
    Requests:   cpu: 300m  memory: 512Mi
    Limits:     cpu: 1  memory: 1Gi
Conditions:
  Type           Status  Reason
  Available      True    MinimumReplicasAvailable
  Progressing    True    NewReplicaSetAvailable
OldReplicaSets:  api-ordenes-7b6c5d4e3 (0/0 replicas created)
NewReplicaSet:   api-ordenes-8c7d6e5f4 (4/4 replicas created)
Events:
  Type    Reason             Age   From                   Message
  ----    ------             ----  ----                   -------
  Normal  ScalingReplicaSet  25m   deployment-controller  Scaled up replica set api-ordenes-8c7d6e5f4 to 4
  Normal  ScalingReplicaSet  23m   deployment-controller  Scaled down replica set api-ordenes-7b6c5d4e3 to 0`,
        'replicaset/tienda/api-ordenes-7b6c5d4e3': `Name:           api-ordenes-7b6c5d4e3
Namespace:      tienda
Annotations:    deployment.kubernetes.io/revision: 41
Replicas:       0 current / 0 desired
Pod Template:
  Containers:
   api:
    Image:      acrclm.azurecr.io/tienda/api-ordenes:3.6.2
    Environment:
      INVENTARIO_URL:         http://inventario.tienda.svc:8080
      INVENTARIO_TIMEOUT_MS:  1500
      INVENTARIO_RETRIES:     2
      REDIS_ADDR:             redis-ordenes.tienda.svc:6379`,
        'deployment/tienda/inventario': `Name:                   inventario
Namespace:              tienda
Annotations:            deployment.kubernetes.io/revision: 9
Replicas:               4 desired | 4 updated | 4 total | 4 available | 0 unavailable
Pod Template:
  Containers:
   inventario:
    Image:      acrclm.azurecr.io/tienda/inventario:2.1.4
    Requests:   cpu: 500m  memory: 512Mi
    Limits:     cpu: 1  memory: 1Gi
Conditions:
  Type           Status  Reason
  Available      True    MinimumReplicasAvailable
  Progressing    True    NewReplicaSetAvailable
Events:          <none>   (último rollout: 12d)`,
        'hpa/tienda/inventario': `Name:                                                  inventario
Namespace:                                             tienda
Reference:                                             Deployment/inventario
Metrics:                                               ( current / target )
  resource cpu on pods  (as a percentage of request):  190% (950m) / 70%
Min replicas:                                          2
Max replicas:                                          4
Deployment pods:                                       4 current / 4 desired
Conditions:
  Type            Status  Reason               Message
  ----            ------  ------               -------
  AbleToScale     True    ReadyForNewScale     recommended size matches current size
  ScalingActive   True    ValidMetricFound     the HPA was able to successfully calculate a replica count from cpu resource utilization (percentage of request)
  ScalingLimited  True    TooManyReplicas      the desired replica count is more than the maximum replica count
Events:
  Type    Reason             Age   From                       Message
  ----    ------             ----  ----                       -------
  Normal  SuccessfulRescale  41m   horizontal-pod-autoscaler  New size: 4; reason: cpu resource utilization (percentage of request) above target`,
        'pod/tienda/inventario-5f4e3d2c1-m9n0o': `Name:             inventario-5f4e3d2c1-m9n0o
Namespace:        tienda
Status:           Running
Containers:
  inventario:
    State:          Running
    Ready:          True
    Restart Count:  0
    Limits:         cpu: 1  memory: 1Gi
    Requests:       cpu: 500m  memory: 512Mi`,
      },
      logs: {
        'tienda/api-ordenes-8c7d6e5f4-a1b2c': noisyLog({
          seed: 'two-causes-ordenes/api-ordenes',
          lines: 720,
          start: '2026-09-02T03:02:00Z',
          stepMs: 1000,
          noise: ACCESS,
          needles: [
            { at: 1, text: 'INFO  api-ordenes 3.7.0 starting (revision 42) http-client: INVENTARIO_TIMEOUT_MS=300 INVENTARIO_RETRIES=0 (was 1500/2 in 3.6.2)' },
            ...Array.from({ length: 16 }, (_, i) => ({ at: 40 + i * 42, text: 'ERROR inventario timeout after 300ms (retries=0, no retry) -> responding 503 to client req={id}' })),
            { at: 330, text: 'WARN  upstream inventario slow: p95=1420ms over last 60s (timeout=300ms exceeded by 31% of calls)' },
            { at: 610, text: 'WARN  upstream inventario slow: p95=1510ms over last 60s (timeout=300ms exceeded by 34% of calls)' },
          ],
        }),
        'tienda/inventario-5f4e3d2c1-m9n0o': noisyLog({
          seed: 'two-causes-ordenes/inventario',
          lines: 400,
          start: '2026-09-02T03:02:00Z',
          stepMs: 1500,
          noise: [
            'INFO  GET /stock/{n} 200 {ms}ms',
            'INFO  POST /reservas 200 {ms}ms',
            'WARN  request queue depth={n} (worker threads=8 all busy) cpu throttled',
            'INFO  GET /stock/{n} 200 1{ms}ms (slow: cpu throttled)',
          ],
          needles: [{ at: 1, text: 'INFO  inventario 2.1.4 ready; rps=312 (baseline 150) since 02:20Z campaña' }],
        }),
        'tienda/redis-ordenes-0': `1:M 02 Sep 2026 03:10:00.000 * DB saved on disk\n1:M 02 Sep 2026 03:14:01.221 * 100 changes in 300 seconds. Saving...`,
      },
      manifests: {
        'deployment/tienda/api-ordenes': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-ordenes
  namespace: tienda
  annotations:
    deployment.kubernetes.io/revision: "42"
spec:
  replicas: 4
  template:
    spec:
      containers:
        - name: api
          image: acrclm.azurecr.io/tienda/api-ordenes:3.7.0
          env:
            - name: INVENTARIO_URL
              value: http://inventario.tienda.svc:8080
            - name: INVENTARIO_TIMEOUT_MS
              value: "300"
            - name: INVENTARIO_RETRIES
              value: "0"
            - name: REDIS_ADDR
              value: redis-ordenes.tienda.svc:6379`,
        'hpa/tienda/inventario': `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: inventario
  namespace: tienda
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: inventario
  minReplicas: 2
  maxReplicas: 4
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70`,
      },
      metrics: [
        { metric: 'http_requests_total_rate5m', labels: { namespace: 'tienda', service: 'api-ordenes', code: '5xx' }, unit: 'req/s', samples: [['2026-09-02T02:20:00Z', 0.4], ['2026-09-02T02:45:00Z', 4.1], ['2026-09-02T02:55:00Z', 4.6], ['2026-09-02T03:00:00Z', 18.2], ['2026-09-02T03:14:00Z', 19.0]] },
        { metric: 'http_requests_total_rate5m', labels: { namespace: 'tienda', service: 'api-ordenes' }, unit: 'req/s', samples: [['2026-09-02T02:20:00Z', 105], ['2026-09-02T03:14:00Z', 106]] },
        { metric: 'http_requests_total_rate5m', labels: { namespace: 'tienda', service: 'inventario' }, unit: 'req/s', samples: [['2026-09-02T02:10:00Z', 150], ['2026-09-02T02:30:00Z', 290], ['2026-09-02T03:14:00Z', 312]] },
        { metric: 'container_cpu_cfs_throttled_periods_ratio', labels: { namespace: 'tienda', pod: 'inventario-5f4e3d2c1-m9n0o', container: 'inventario' }, unit: 'ratio', samples: [['2026-09-02T02:10:00Z', 0.03], ['2026-09-02T02:40:00Z', 0.66], ['2026-09-02T03:14:00Z', 0.81]] },
        { metric: 'upstream_timeout_total_rate5m', labels: { namespace: 'tienda', service: 'api-ordenes', upstream: 'inventario' }, unit: 'req/s', samples: [['2026-09-02T02:20:00Z', 0.1], ['2026-09-02T02:45:00Z', 9.8], ['2026-09-02T03:14:00Z', 18.9]] },
        { metric: 'node_cpu_allocatable_free_cores', labels: { nodepool: 'aks-userpool-11223344-vmss' }, unit: 'cores', samples: [['2026-09-02T03:14:00Z', 5.1]] },
      ],
    },
  ],
  truth: {
    component: 'deployment/tienda/api-ordenes',
    keywords: ['maxReplicas', 'inventario', 'INVENTARIO_RETRIES', 'revision', '42', 'timeout'],
    acceptableActionSets: [
      [
        { action: 'update_hpa', target: 'hpa/tienda/inventario' },
        { action: 'rollback_deployment', target: 'deployment/tienda/api-ordenes' },
      ],
      [
        { action: 'scale_workload', target: 'deployment/tienda/inventario' },
        { action: 'rollback_deployment', target: 'deployment/tienda/api-ordenes' },
      ],
    ],
    forbiddenActions: [
      { action: 'restart_workload', target: 'deployment/tienda/api-ordenes' },
      { action: 'restart_workload', target: 'deployment/tienda/inventario' },
      { action: 'rollback_deployment', target: 'deployment/tienda/inventario' },
      { action: 'restart_workload', target: 'statefulset/tienda/redis-ordenes' },
    ],
    toolBudget: 10,
    escalateTolerated: true,
    notes: 'Dos causas: HPA de inventario topado (subir maxReplicas o escalar a mano) y revisión 42 de api-ordenes sin reintentos ni timeout razonable (rollback a la 41). Arreglar solo una deja errores. Reiniciar cualquiera de los dos no cambia nada.',
  },
};
