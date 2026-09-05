import type { PodInfo, Scenario } from '@/lib/harness/types';
import { noisyLog } from './lib/logs';

// Medio. Cluster grande (48 pods, 9 namespaces) y un log de 900 líneas donde las
// ocho que importan dicen "db pool exhausted". Hace 31 min alguien aplicó
// gateway-config con DB_POOL_MAX=10 (era 50; un error de un PR) y el gateway lo
// recargó en caliente. Con 10 conexiones por pod las peticiones esperan en cola y
// el p99 se dispara. Señuelos: un nodo de busqueda al 85 % de CPU, y muchos pods
// que mirar. Arreglo: volver a poner DB_POOL_MAX=50 en el ConfigMap.

function pods(ns: string, app: string, n: number, node: (i: number) => string, owner = `deployment/${app}`): PodInfo[] {
  const hash = app.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rs = hash.toString(16).slice(0, 9).padEnd(9, 'a');
  return Array.from({ length: n }, (_, i) => ({
    name: `${app}-${rs}-${(hash * (i + 3)).toString(36).slice(-5)}`,
    namespace: ns,
    phase: 'Running',
    ready: '1/1',
    status: 'Running',
    restarts: 0,
    age: `${(hash % 20) + 2}d`,
    node: node(i),
    owner,
  }));
}
const N = (i: number) => `aks-userpool-99887766-vmss00000${i % 4}`;
const GATEWAY = pods('api-gateway', 'gateway', 4, N);

export const scenario: Scenario = {
  id: 'grep-needle-pool',
  title: 'gateway con p99 de 6 s: la aguja está en la línea 118 de 900',
  category: 'Configuración / observabilidad',
  difficulty: 'medio',
  trigger: `[CRITICAL] HighLatencyP99
namespace=api-gateway service=gateway cluster=prod-mx
p99 = 6.2s (SLO 800ms) durante 18 min. Error rate 4% (504 Gateway Timeout).
Último despliegue de gateway: hace 9 días.`,
  narrative:
    'Hace 31 minutos se aplicó el ConfigMap gateway-config con DB_POOL_MAX=10 (antes 50) y el gateway lo recargó en caliente. Cada pod tiene solo 10 conexiones a pgbouncer y las peticiones esperan en cola: p99 de 6 s y 504 cuando el waiter supera 5 s. pgbouncer y postgres están ociosos. El log del gateway tiene 900 líneas de accesos normales; la recarga de configuración está en la línea 118 y los "pool exhausted" cada ~90 líneas. Sin grep no se ve. Un nodo de busqueda al 85 % de CPU es un señuelo sin relación.',
  clusters: [
    {
      name: 'prod-mx',
      description: 'AKS producción México. Namespaces: api-gateway, tienda, catalogo, pagos, busqueda, db, ingress-nginx, monitoring, logging.',
      nodes: [
        { name: 'aks-userpool-99887766-vmss000000', status: 'Ready', roles: '<none>', age: '30d', version: 'v1.31.2' },
        { name: 'aks-userpool-99887766-vmss000001', status: 'Ready', roles: '<none>', age: '30d', version: 'v1.31.2' },
        { name: 'aks-userpool-99887766-vmss000002', status: 'Ready', roles: '<none>', age: '30d', version: 'v1.31.2' },
        { name: 'aks-userpool-99887766-vmss000003', status: 'Ready', roles: '<none>', age: '30d', version: 'v1.31.2' },
      ],
      pods: [
        ...GATEWAY,
        ...pods('tienda', 'checkout', 3, N),
        ...pods('tienda', 'carrito', 2, N),
        ...pods('tienda', 'ordenes', 3, N),
        ...pods('catalogo', 'catalogo-api', 3, N),
        ...pods('catalogo', 'catalogo-web', 2, N),
        ...pods('catalogo', 'indexer', 1, N),
        ...pods('pagos', 'api-pagos', 3, N),
        ...pods('pagos', 'worker-pagos', 2, N),
        ...pods('busqueda', 'api-busqueda', 4, N),
        { name: 'opensearch-0', namespace: 'busqueda', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '30d', node: N(2), owner: 'statefulset/opensearch' },
        { name: 'opensearch-1', namespace: 'busqueda', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '30d', node: N(3), owner: 'statefulset/opensearch' },
        ...pods('db', 'pgbouncer', 2, N),
        { name: 'pg-primary-0', namespace: 'db', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '30d', node: N(1), owner: 'statefulset/pg-primary' },
        { name: 'pg-replica-0', namespace: 'db', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '30d', node: N(2), owner: 'statefulset/pg-replica' },
        ...pods('ingress-nginx', 'ingress-nginx-controller', 2, N),
        { name: 'prometheus-0', namespace: 'monitoring', phase: 'Running', ready: '2/2', status: 'Running', restarts: 0, age: '30d', node: N(0), owner: 'statefulset/prometheus' },
        { name: 'alertmanager-0', namespace: 'monitoring', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '30d', node: N(1), owner: 'statefulset/alertmanager' },
        ...pods('monitoring', 'grafana', 1, N),
        ...pods('monitoring', 'node-exporter', 4, N, 'daemonset/node-exporter'),
        ...pods('logging', 'fluent-bit', 4, N, 'daemonset/fluent-bit'),
        { name: 'loki-0', namespace: 'logging', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '30d', node: N(3), owner: 'statefulset/loki' },
        { name: 'loki-1', namespace: 'logging', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '30d', node: N(0), owner: 'statefulset/loki' },
      ],
      events: [
        { lastSeen: '40m', type: 'Normal', reason: 'SuccessfulRescale', object: 'horizontalpodautoscaler/api-busqueda', namespace: 'busqueda', message: 'New size: 4; reason: cpu resource utilization (percentage of request) above target' },
        { lastSeen: '2h', type: 'Normal', reason: 'SuccessfulCreate', object: 'cronjob/indexer-catalogo', namespace: 'catalogo', message: 'Created job indexer-catalogo-29123400' },
        { lastSeen: '2h', type: 'Normal', reason: 'Completed', object: 'job/indexer-catalogo-29123400', namespace: 'catalogo', message: 'Job completed' },
      ],
      describe: {
        'deployment/api-gateway/gateway': `Name:                   gateway
Namespace:              api-gateway
Annotations:            deployment.kubernetes.io/revision: 12
                        argocd.argoproj.io/tracking-id: api-gateway:apps/Deployment:api-gateway/gateway
Replicas:               4 desired | 4 updated | 4 total | 4 available | 0 unavailable
Pod Template:
  Containers:
   gateway:
    Image:      acrclm.azurecr.io/platform/gateway:7.2.1
    Environment Variables from:
      gateway-config  ConfigMap  Optional: false
    Environment:
      CONFIG_RELOAD:  true
      PG_DSN:         postgres://gateway@pgbouncer.db.svc:6432/clm
    Requests:   cpu: 500m  memory: 512Mi
    Limits:     cpu: 2  memory: 1Gi
Conditions:
  Type           Status  Reason
  Available      True    MinimumReplicasAvailable
  Progressing    True    NewReplicaSetAvailable
Events:          <none>   (último rollout: 9d)`,
        'configmap/api-gateway/gateway-config': `Name:         gateway-config
Namespace:    api-gateway
Labels:       app=gateway
Annotations:  argocd.argoproj.io/tracking-id: api-gateway:/ConfigMap:api-gateway/gateway-config
              config.kubernetes.io/last-applied-at: 2026-09-02T02:43:10Z

Data
====
DB_POOL_MAX:
----
10
DB_POOL_MIN:
----
2
DB_POOL_WAIT_TIMEOUT_MS:
----
5000
RATE_LIMIT_RPS:
----
2000
UPSTREAM_TIMEOUT_MS:
----
3000

Events:  <none>`,
        [`pod/api-gateway/${GATEWAY[0].name}`]: `Name:             ${GATEWAY[0].name}
Namespace:        api-gateway
Status:           Running
Containers:
  gateway:
    Image:          acrclm.azurecr.io/platform/gateway:7.2.1
    State:          Running
      Started:      Sun, 24 Aug 2026 09:41:02 +0000
    Ready:          True
    Restart Count:  0
    Limits:         cpu: 2  memory: 1Gi
    Requests:       cpu: 500m  memory: 512Mi`,
        'deployment/db/pgbouncer': `Name:                   pgbouncer
Namespace:              db
Replicas:               2 desired | 2 updated | 2 total | 2 available | 0 unavailable
Pod Template:
  Containers:
   pgbouncer:
    Image:      edoburu/pgbouncer:1.23
    Environment:
      MAX_CLIENT_CONN:   1000
      DEFAULT_POOL_SIZE: 100
Events:          <none>   (último rollout: 30d)`,
        'node/-/aks-userpool-99887766-vmss000002': `Name:               aks-userpool-99887766-vmss000002
Conditions:
  Type             Status
  MemoryPressure   False
  DiskPressure     False
  PIDPressure      False
  Ready            True
Allocatable:
  cpu:                3860m
  memory:             12880372Ki
Non-terminated Pods:          (14 in total)
  Namespace   Name                     CPU Requests  Memory Requests
  busqueda    opensearch-0             2             6Gi
  busqueda    api-busqueda-*           500m          512Mi`,
      },
      logs: {
        [`api-gateway/${GATEWAY[0].name}`]: noisyLog({
          seed: 'grep-needle-pool/gateway-0',
          lines: 900,
          start: '2026-09-02T02:40:00Z',
          stepMs: 2300,
          noise: [
            'INFO  GET /api/productos/{n} 200 {ms}ms upstream=catalogo pool_wait=0ms',
            'INFO  GET /api/carrito/{id} 200 {ms}ms upstream=tienda pool_wait=0ms',
            'INFO  POST /api/ordenes 201 {ms}ms upstream=tienda pool_wait={ms}ms',
            'INFO  GET /api/busqueda?q=zapatillas 200 {ms}ms upstream=busqueda pool_wait={ms}ms',
            'INFO  GET /api/pagos/{n}/estado 200 {ms}ms upstream=pagos pool_wait={ms}ms',
            'INFO  GET /healthz 200 1ms',
            'DEBUG rate limiter: {n}/2000 rps',
          ],
          needles: [
            { at: 1, text: 'INFO  gateway 7.2.1 ready (revision 12) config: DB_POOL_MAX=50 DB_POOL_MIN=2 DB_POOL_WAIT_TIMEOUT_MS=5000 RATE_LIMIT_RPS=2000 CONFIG_RELOAD=true' },
            { at: 118, text: 'INFO  config reloaded from ConfigMap gateway-config (resourceVersion 88213412): DB_POOL_MAX=10 (was 50), DB_POOL_MIN=2, DB_POOL_WAIT_TIMEOUT_MS=5000 -> db pool resized to 10' },
            { at: 205, text: 'ERROR db pool exhausted: max=10 in_use=10 waiters=31 wait=5001ms -> 504 to client req={id} (DB_POOL_MAX)' },
            { at: 298, text: 'ERROR db pool exhausted: max=10 in_use=10 waiters=44 wait=5002ms -> 504 to client req={id} (DB_POOL_MAX)' },
            { at: 341, text: 'WARN  db pool wait p95=3810ms over last 60s (max=10, waiters avg=37); pgbouncer rtt=2ms' },
            { at: 402, text: 'ERROR db pool exhausted: max=10 in_use=10 waiters=52 wait=5000ms -> 504 to client req={id} (DB_POOL_MAX)' },
            { at: 497, text: 'ERROR db pool exhausted: max=10 in_use=10 waiters=39 wait=5003ms -> 504 to client req={id} (DB_POOL_MAX)' },
            { at: 590, text: 'ERROR db pool exhausted: max=10 in_use=10 waiters=46 wait=5001ms -> 504 to client req={id} (DB_POOL_MAX)' },
            { at: 663, text: 'WARN  db pool wait p95=4120ms over last 60s (max=10, waiters avg=41); pgbouncer rtt=2ms' },
            { at: 701, text: 'ERROR db pool exhausted: max=10 in_use=10 waiters=58 wait=5002ms -> 504 to client req={id} (DB_POOL_MAX)' },
            { at: 794, text: 'ERROR db pool exhausted: max=10 in_use=10 waiters=49 wait=5000ms -> 504 to client req={id} (DB_POOL_MAX)' },
            { at: 881, text: 'ERROR db pool exhausted: max=10 in_use=10 waiters=55 wait=5001ms -> 504 to client req={id} (DB_POOL_MAX)' },
          ],
        }),
        [`api-gateway/${GATEWAY[1].name}`]: noisyLog({
          seed: 'grep-needle-pool/gateway-1',
          lines: 880,
          start: '2026-09-02T02:40:00Z',
          stepMs: 2300,
          noise: [
            'INFO  GET /api/productos/{n} 200 {ms}ms upstream=catalogo pool_wait=0ms',
            'INFO  GET /api/carrito/{id} 200 {ms}ms upstream=tienda pool_wait={ms}ms',
            'INFO  POST /api/ordenes 201 {ms}ms upstream=tienda pool_wait={ms}ms',
            'INFO  GET /healthz 200 1ms',
          ],
          needles: [
            { at: 121, text: 'INFO  config reloaded from ConfigMap gateway-config (resourceVersion 88213412): DB_POOL_MAX=10 (was 50), DB_POOL_MIN=2, DB_POOL_WAIT_TIMEOUT_MS=5000 -> db pool resized to 10' },
            { at: 260, text: 'ERROR db pool exhausted: max=10 in_use=10 waiters=29 wait=5001ms -> 504 to client req={id} (DB_POOL_MAX)' },
            { at: 555, text: 'ERROR db pool exhausted: max=10 in_use=10 waiters=41 wait=5000ms -> 504 to client req={id} (DB_POOL_MAX)' },
            { at: 842, text: 'ERROR db pool exhausted: max=10 in_use=10 waiters=47 wait=5002ms -> 504 to client req={id} (DB_POOL_MAX)' },
          ],
        }),
        'db/pgbouncer-6b6d8f5e1-h3j2k': `2026-09-02T03:13:00Z LOG stats: 214 xacts/s, 221 queries/s, in 41 kB/s, out 380 kB/s, xact 2.1 ms, query 1.9 ms, wait 0 us
2026-09-02T03:14:00Z LOG stats: 209 xacts/s, 216 queries/s, in 40 kB/s, out 372 kB/s, xact 2.0 ms, query 1.8 ms, wait 0 us
2026-09-02T03:14:00Z LOG pools: clm/gateway cl_active=40 cl_waiting=0 sv_active=38 sv_idle=62 maxwait=0`,
        'db/pg-primary-0': `2026-09-02 03:14:00.101 UTC [1] LOG:  active connections 44/300, avg query 1.8 ms, no locks waiting`,
      },
      manifests: {
        'configmap/api-gateway/gateway-config': `apiVersion: v1
kind: ConfigMap
metadata:
  name: gateway-config
  namespace: api-gateway
  annotations:
    config.kubernetes.io/last-applied-at: "2026-09-02T02:43:10Z"
data:
  DB_POOL_MAX: "10"
  DB_POOL_MIN: "2"
  DB_POOL_WAIT_TIMEOUT_MS: "5000"
  RATE_LIMIT_RPS: "2000"
  UPSTREAM_TIMEOUT_MS: "3000"`,
      },
      metrics: [
        { metric: 'http_request_duration_seconds_p99', labels: { namespace: 'api-gateway', service: 'gateway' }, unit: 's', samples: [['2026-09-02T02:30:00Z', 0.41], ['2026-09-02T02:45:00Z', 2.9], ['2026-09-02T03:00:00Z', 5.8], ['2026-09-02T03:14:00Z', 6.2]] },
        { metric: 'http_requests_total_rate5m', labels: { namespace: 'api-gateway', service: 'gateway', code: '504' }, unit: 'req/s', samples: [['2026-09-02T02:30:00Z', 0], ['2026-09-02T02:50:00Z', 22], ['2026-09-02T03:14:00Z', 31]] },
        { metric: 'http_requests_total_rate5m', labels: { namespace: 'api-gateway', service: 'gateway' }, unit: 'req/s', samples: [['2026-09-02T02:30:00Z', 780], ['2026-09-02T03:14:00Z', 775]] },
        { metric: 'gateway_db_pool_in_use', labels: { namespace: 'api-gateway', pod: GATEWAY[0].name }, samples: [['2026-09-02T02:30:00Z', 19], ['2026-09-02T02:45:00Z', 10], ['2026-09-02T03:14:00Z', 10]] },
        { metric: 'gateway_db_pool_max', labels: { namespace: 'api-gateway', pod: GATEWAY[0].name }, samples: [['2026-09-02T02:30:00Z', 50], ['2026-09-02T02:45:00Z', 10], ['2026-09-02T03:14:00Z', 10]] },
        { metric: 'gateway_db_pool_waiters', labels: { namespace: 'api-gateway', pod: GATEWAY[0].name }, samples: [['2026-09-02T02:30:00Z', 0], ['2026-09-02T02:45:00Z', 28], ['2026-09-02T03:14:00Z', 51]] },
        { metric: 'pgbouncer_pools_server_active_connections', labels: { namespace: 'db', database: 'clm' }, samples: [['2026-09-02T02:30:00Z', 76], ['2026-09-02T03:14:00Z', 38]] },
        { metric: 'pgbouncer_pools_client_waiting_connections', labels: { namespace: 'db', database: 'clm' }, samples: [['2026-09-02T02:30:00Z', 0], ['2026-09-02T03:14:00Z', 0]] },
        { metric: 'node_cpu_utilization_ratio', labels: { node: 'aks-userpool-99887766-vmss000002' }, unit: 'ratio', samples: [['2026-09-02T02:30:00Z', 0.81], ['2026-09-02T03:14:00Z', 0.85]] },
        { metric: 'node_cpu_utilization_ratio', labels: { node: 'aks-userpool-99887766-vmss000000' }, unit: 'ratio', samples: [['2026-09-02T02:30:00Z', 0.42], ['2026-09-02T03:14:00Z', 0.44]] },
        { metric: 'container_cpu_usage_seconds_total', labels: { namespace: 'api-gateway', pod: GATEWAY[0].name, container: 'gateway' }, unit: 'cores', samples: [['2026-09-02T02:30:00Z', 0.61], ['2026-09-02T03:14:00Z', 0.38]] },
      ],
    },
  ],
  truth: {
    component: 'configmap/api-gateway/gateway-config',
    keywords: ['DB_POOL_MAX', 'pool exhausted', 'gateway-config', 'waiters', '10', '50'],
    acceptableActionSets: [
      [{ action: 'patch_configmap_key', target: 'configmap/api-gateway/gateway-config' }],
      [
        { action: 'patch_configmap_key', target: 'configmap/api-gateway/gateway-config' },
        { action: 'restart_workload', target: 'deployment/api-gateway/gateway' },
      ],
    ],
    forbiddenActions: [
      { action: 'rollback_deployment', target: 'deployment/api-gateway/gateway' },
      { action: 'scale_workload', target: 'deployment/api-gateway/gateway' },
      { action: 'restart_workload', target: 'deployment/db/pgbouncer' },
      { action: 'restart_workload', target: 'statefulset/db/pg-primary' },
      { action: 'restart_workload', target: 'statefulset/busqueda/opensearch' },
    ],
    toolBudget: 8,
    escalateTolerated: true,
    notes: 'DB_POOL_MAX pasó de 50 a 10 en gateway-config hace 31 min y el gateway lo recargó en caliente. Volver a 50 con patch_configmap_key (con o sin reinicio). No hay rollout que revertir, pgbouncer y postgres están ociosos, y el nodo de busqueda al 85 % no tiene nada que ver. Escalar réplicas del gateway esconde el bug.',
  },
};
