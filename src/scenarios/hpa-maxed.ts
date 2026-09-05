import type { Scenario } from '@/lib/harness/types';

// Medio. p99 disparado en api-busqueda. No hay despliegue reciente ni errores:
// es tráfico legítimo (campaña) y el HPA lleva 25 min en maxReplicas=6 con
// CPU al 96% y throttling. Subir maxReplicas (o escalar a mano) es la acción.
// Rollback es la trampa: no ha cambiado nada en el código.

export const scenario: Scenario = {
  id: 'hpa-maxed',
  title: 'api-busqueda: p99 x8, HPA saturado en maxReplicas',
  category: 'Capacidad / autoscaling',
  difficulty: 'medio',
  trigger: `[WARNING] HighLatencyP99
namespace=busqueda service=api-busqueda cluster=prod-mx
p99 = 4.1s (SLO 500ms) durante 15 min. Error rate 0.3%.
Alerta asociada: KubeHpaMaxedOut hpa=api-busqueda (25 min)`,
  narrative:
    'Campaña de marketing lanzada a las 02:30 UTC (18:30 hora CDMX). El tráfico se triplicó. El HPA llegó a 6 (su máximo) en 5 minutos y ahí se quedó; los pods están CPU-throttled. No hay despliegue desde hace 9 días. Solución: subir maxReplicas del HPA (hay nodos con capacidad) o scale_workload directo. El rollback es la trampa.',
  clusters: [
    {
      name: 'prod-mx',
      description: 'AKS producción México. Namespaces: busqueda, catalogo, ingress-nginx, monitoring. Cluster autoscaler activo (nodepool 3-8 nodos).',
      nodes: [
        { name: 'aks-userpool-99887766-vmss000000', status: 'Ready', roles: '<none>', age: '30d', version: 'v1.31.2' },
        { name: 'aks-userpool-99887766-vmss000001', status: 'Ready', roles: '<none>', age: '30d', version: 'v1.31.2' },
        { name: 'aks-userpool-99887766-vmss000002', status: 'Ready', roles: '<none>', age: '30d', version: 'v1.31.2' },
        { name: 'aks-userpool-99887766-vmss000003', status: 'Ready', roles: '<none>', age: '22m', version: 'v1.31.2' },
      ],
      pods: [
        { name: 'api-busqueda-4d5e6f7a8-b1cde', namespace: 'busqueda', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '9d', node: 'aks-userpool-99887766-vmss000000', owner: 'deployment/api-busqueda' },
        { name: 'api-busqueda-4d5e6f7a8-f2ghi', namespace: 'busqueda', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '9d', node: 'aks-userpool-99887766-vmss000001', owner: 'deployment/api-busqueda' },
        { name: 'api-busqueda-4d5e6f7a8-j3klm', namespace: 'busqueda', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '24m', node: 'aks-userpool-99887766-vmss000002', owner: 'deployment/api-busqueda' },
        { name: 'api-busqueda-4d5e6f7a8-n4opq', namespace: 'busqueda', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '23m', node: 'aks-userpool-99887766-vmss000002', owner: 'deployment/api-busqueda' },
        { name: 'api-busqueda-4d5e6f7a8-r5stu', namespace: 'busqueda', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '22m', node: 'aks-userpool-99887766-vmss000003', owner: 'deployment/api-busqueda' },
        { name: 'api-busqueda-4d5e6f7a8-v6wxy', namespace: 'busqueda', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '21m', node: 'aks-userpool-99887766-vmss000003', owner: 'deployment/api-busqueda' },
        { name: 'opensearch-0', namespace: 'busqueda', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '30d', node: 'aks-userpool-99887766-vmss000000', owner: 'statefulset/opensearch' },
        { name: 'opensearch-1', namespace: 'busqueda', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '30d', node: 'aks-userpool-99887766-vmss000001', owner: 'statefulset/opensearch' },
      ],
      events: [
        { lastSeen: '25m', type: 'Normal', reason: 'SuccessfulRescale', object: 'horizontalpodautoscaler/api-busqueda', namespace: 'busqueda', message: 'New size: 4; reason: cpu resource utilization (percentage of request) above target' },
        { lastSeen: '23m', type: 'Normal', reason: 'SuccessfulRescale', object: 'horizontalpodautoscaler/api-busqueda', namespace: 'busqueda', message: 'New size: 6; reason: cpu resource utilization (percentage of request) above target' },
        { lastSeen: '22m', type: 'Normal', reason: 'TriggeredScaleUp', object: 'pod/api-busqueda-4d5e6f7a8-r5stu', namespace: 'busqueda', message: 'pod triggered scale-up: [{aks-userpool-99887766-vmss 3->4 (max: 8)}]' },
        { lastSeen: '1m', type: 'Warning', reason: 'FailedComputeMetricsReplicas', object: 'horizontalpodautoscaler/api-busqueda', namespace: 'busqueda', message: 'invalid metrics (0 invalid out of 1); desired replicas 11 exceeds maxReplicas 6 — capped', count: 24 },
      ],
      describe: {
        'hpa/busqueda/api-busqueda': `Name:                                                  api-busqueda
Namespace:                                             busqueda
Reference:                                             Deployment/api-busqueda
Metrics:                                               ( current / target )
  resource cpu on pods  (as a percentage of request):  187% (935m) / 70%
Min replicas:                                          2
Max replicas:                                          6
Deployment pods:                                       6 current / 6 desired
Conditions:
  Type            Status  Reason               Message
  ----            ------  ------               -------
  AbleToScale     True    ReadyForNewScale     recommended size matches current size
  ScalingActive   True    ValidMetricFound     the HPA was able to successfully calculate a replica count from cpu resource utilization (percentage of request)
  ScalingLimited  True    TooManyReplicas      the desired replica count is more than the maximum replica count
Events:
  Type    Reason             Age   From                       Message
  ----    ------             ----  ----                       -------
  Normal  SuccessfulRescale  25m   horizontal-pod-autoscaler  New size: 4; reason: cpu resource utilization (percentage of request) above target
  Normal  SuccessfulRescale  23m   horizontal-pod-autoscaler  New size: 6; reason: cpu resource utilization (percentage of request) above target`,
        'deployment/busqueda/api-busqueda': `Name:                   api-busqueda
Namespace:              busqueda
Annotations:            deployment.kubernetes.io/revision: 17
Replicas:               6 desired | 6 updated | 6 total | 6 available | 0 unavailable
Pod Template:
  Containers:
   api:
    Image:      acrclm.azurecr.io/busqueda/api:5.2.0
    Requests:   cpu: 500m  memory: 512Mi
    Limits:     cpu: 1  memory: 1Gi
Conditions:
  Type           Status  Reason
  Available      True    MinimumReplicasAvailable
  Progressing    True    NewReplicaSetAvailable
NewReplicaSet:   api-busqueda-4d5e6f7a8 (6/6 replicas created)
Events:          <none>   (último rollout: 9d)`,
        'pod/busqueda/api-busqueda-4d5e6f7a8-b1cde': `Name:             api-busqueda-4d5e6f7a8-b1cde
Namespace:        busqueda
Status:           Running
Containers:
  api:
    Image:          acrclm.azurecr.io/busqueda/api:5.2.0
    State:          Running
      Started:      Sun, 24 Aug 2026 10:02:11 +0000
    Ready:          True
    Restart Count:  0
    Limits:         cpu: 1  memory: 1Gi
    Requests:       cpu: 500m  memory: 512Mi`,
        'statefulset/busqueda/opensearch': `Name:               opensearch
Namespace:          busqueda
Replicas:           2 desired | 2 total
Pods Status:        2 Running / 0 Waiting / 0 Succeeded / 0 Failed`,
      },
      logs: {
        'busqueda/api-busqueda-4d5e6f7a8-b1cde': `2026-09-02T03:14:01Z INFO  GET /buscar?q=zapatillas+running 200 3812ms upstream=opensearch:118ms
2026-09-02T03:14:01Z INFO  GET /buscar?q=chamarra 200 4102ms upstream=opensearch:97ms
2026-09-02T03:14:02Z WARN  request queue depth=212 (worker threads=8 all busy)
2026-09-02T03:14:02Z INFO  GET /buscar?q=tenis+nike 200 3990ms upstream=opensearch:121ms
2026-09-02T03:14:03Z WARN  request queue depth=219 (worker threads=8 all busy)`,
        'busqueda/opensearch-0': `[2026-09-02T03:14:00,512][INFO ][o.o.i.i.IndexingPressure] no backpressure; search thread pool queue=3 active=6/8
[2026-09-02T03:14:05,514][INFO ][o.o.m.j.JvmGcMonitorService] [opensearch-0] [gc][young][81234] duration [41ms]`,
      },
      manifests: {
        'hpa/busqueda/api-busqueda': `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-busqueda
  namespace: busqueda
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-busqueda
  minReplicas: 2
  maxReplicas: 6
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70`,
      },
      metrics: [
        { metric: 'http_request_duration_seconds_p99', labels: { namespace: 'busqueda', service: 'api-busqueda' }, unit: 's', samples: [['2026-09-02T02:20:00Z', 0.31], ['2026-09-02T02:35:00Z', 0.9], ['2026-09-02T02:45:00Z', 2.4], ['2026-09-02T03:00:00Z', 3.8], ['2026-09-02T03:14:00Z', 4.1]] },
        { metric: 'http_requests_total_rate5m', labels: { namespace: 'busqueda', service: 'api-busqueda' }, unit: 'req/s', samples: [['2026-09-02T02:20:00Z', 410], ['2026-09-02T02:35:00Z', 890], ['2026-09-02T02:45:00Z', 1210], ['2026-09-02T03:00:00Z', 1290], ['2026-09-02T03:14:00Z', 1305]] },
        { metric: 'container_cpu_cfs_throttled_periods_ratio', labels: { namespace: 'busqueda', pod: 'api-busqueda-4d5e6f7a8-b1cde', container: 'api' }, unit: 'ratio', samples: [['2026-09-02T02:20:00Z', 0.02], ['2026-09-02T02:45:00Z', 0.61], ['2026-09-02T03:14:00Z', 0.78]] },
        { metric: 'kube_horizontalpodautoscaler_status_current_replicas', labels: { namespace: 'busqueda', horizontalpodautoscaler: 'api-busqueda' }, samples: [['2026-09-02T02:20:00Z', 2], ['2026-09-02T02:35:00Z', 4], ['2026-09-02T02:50:00Z', 6], ['2026-09-02T03:14:00Z', 6]] },
        { metric: 'kube_horizontalpodautoscaler_status_desired_replicas', labels: { namespace: 'busqueda', horizontalpodautoscaler: 'api-busqueda' }, samples: [['2026-09-02T02:50:00Z', 6], ['2026-09-02T03:14:00Z', 6]] },
        { metric: 'node_cpu_allocatable_free_cores', labels: { nodepool: 'aks-userpool-99887766-vmss' }, unit: 'cores', samples: [['2026-09-02T03:14:00Z', 6.4]] },
        { metric: 'http_requests_total_rate5m', labels: { namespace: 'busqueda', service: 'api-busqueda', code: '5xx' }, unit: 'req/s', samples: [['2026-09-02T02:20:00Z', 0.1], ['2026-09-02T03:14:00Z', 3.9]] },
      ],
    },
  ],
  truth: {
    component: 'hpa/busqueda/api-busqueda',
    keywords: ['maxReplicas', 'HPA', 'throttl', 'CPU', 'tráfico', '6'],
    acceptableActionSets: [
      [{ action: 'update_hpa', target: 'hpa/busqueda/api-busqueda' }],
      [{ action: 'scale_workload', target: 'deployment/busqueda/api-busqueda' }],
      [
        { action: 'update_hpa', target: 'hpa/busqueda/api-busqueda' },
        { action: 'patch_resources', target: 'deployment/busqueda/api-busqueda' },
      ],
    ],
    forbiddenActions: [
      { action: 'rollback_deployment', target: 'deployment/busqueda/api-busqueda' },
      { action: 'restart_workload', target: 'deployment/busqueda/api-busqueda' },
      { action: 'restart_workload', target: 'statefulset/busqueda/opensearch' },
    ],
    toolBudget: 7,
    notes: 'OpenSearch responde en ~100ms; la latencia es cola en la API por CPU. Subir maxReplicas (hay 6.4 cores libres y autoscaler hasta 8 nodos). Rollback/restart empeoran.',
  },
};
