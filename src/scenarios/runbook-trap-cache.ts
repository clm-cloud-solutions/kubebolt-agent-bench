import type { Scenario } from '@/lib/harness/types';
import { noisyLog } from './lib/logs';

// Medio. El runbook dice "reiniciar redis" y las métricas de redis (memoria al 78 %,
// fragmentación 1.6) parecen darle la razón. Pero redis está sano: 0 evictions y
// responde en 1 ms. La revisión 31 de catalogo-api (hace 22 min) introdujo una
// plantilla de clave de caché que incluye el request_id, así que ninguna clave se
// repite y todo es miss. Rollback a la revisión 30 (o escalar al equipo).

export const scenario: Scenario = {
  id: 'runbook-trap-cache',
  title: 'catalogo-api con 3 % de aciertos de caché: el runbook culpa a redis',
  category: 'Despliegues / señuelos',
  difficulty: 'medio',
  trigger: `[WARNING] CacheHitRatioLow
namespace=catalogo service=catalogo-api cluster=prod-es
Hit ratio 3% (normal 92%) durante 20 min. p95 = 1.9s (normal 0.4s). Carga en postgres ×5.
Runbook: "Reiniciar redis-catalogo (memoria fragmentada)"`,
  narrative:
    'La revisión 31 de catalogo-api cambió la plantilla de la clave de caché e incluye el request_id, así que cada petición genera una clave nueva y nunca acierta. Redis está sano: 78 % de memoria usada pero 0 evictions, p99 de 1 ms. El runbook (reiniciar redis) y la métrica de fragmentación son el señuelo: reiniciar redis vaciaría lo poco que hay y no cambiaría nada. Lo correcto es rollback de catalogo-api a la revisión 30.',
  clusters: [
    {
      name: 'prod-es',
      description: 'AKS producción España. Namespaces: catalogo, pagos, ingress-nginx, monitoring.',
      nodes: [
        { name: 'aks-userpool-11223344-vmss000000', status: 'Ready', roles: '<none>', age: '63d', version: 'v1.31.2' },
        { name: 'aks-userpool-11223344-vmss000001', status: 'Ready', roles: '<none>', age: '63d', version: 'v1.31.2' },
        { name: 'aks-userpool-11223344-vmss000002', status: 'Ready', roles: '<none>', age: '63d', version: 'v1.31.2' },
      ],
      pods: [
        { name: 'catalogo-api-9d8c7b6a5-q1w2e', namespace: 'catalogo', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '22m', node: 'aks-userpool-11223344-vmss000000', owner: 'deployment/catalogo-api' },
        { name: 'catalogo-api-9d8c7b6a5-r3t4y', namespace: 'catalogo', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '21m', node: 'aks-userpool-11223344-vmss000001', owner: 'deployment/catalogo-api' },
        { name: 'catalogo-api-9d8c7b6a5-u5i6o', namespace: 'catalogo', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '21m', node: 'aks-userpool-11223344-vmss000002', owner: 'deployment/catalogo-api' },
        { name: 'redis-catalogo-0', namespace: 'catalogo', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '41d', node: 'aks-userpool-11223344-vmss000001', owner: 'statefulset/redis-catalogo' },
        { name: 'pg-catalogo-0', namespace: 'catalogo', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '41d', node: 'aks-userpool-11223344-vmss000002', owner: 'statefulset/pg-catalogo' },
        { name: 'api-pagos-7d9f8c6b5-k2x8w', namespace: 'pagos', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '3d', node: 'aks-userpool-11223344-vmss000000', owner: 'deployment/api-pagos' },
      ],
      events: [
        { lastSeen: '22m', type: 'Normal', reason: 'ScalingReplicaSet', object: 'deployment/catalogo-api', namespace: 'catalogo', message: 'Scaled up replica set catalogo-api-9d8c7b6a5 to 3' },
        { lastSeen: '20m', type: 'Normal', reason: 'ScalingReplicaSet', object: 'deployment/catalogo-api', namespace: 'catalogo', message: 'Scaled down replica set catalogo-api-8c7b6a5f4 to 0' },
      ],
      describe: {
        'deployment/catalogo/catalogo-api': `Name:                   catalogo-api
Namespace:              catalogo
Annotations:            deployment.kubernetes.io/revision: 31
                        argocd.argoproj.io/tracking-id: catalogo:apps/Deployment:catalogo/catalogo-api
Replicas:               3 desired | 3 updated | 3 total | 3 available | 0 unavailable
Pod Template:
  Containers:
   api:
    Image:      acrclm.azurecr.io/catalogo/api:5.4.0
    Environment:
      REDIS_ADDR:            redis-catalogo.catalogo.svc:6379
      CACHE_KEY_TEMPLATE:    cat:v4:{{request_id}}:producto:{{id}}
      CACHE_TTL_SECONDS:     600
      PG_DSN:                postgres://catalogo@pg-catalogo.catalogo.svc:5432/catalogo
Conditions:
  Type           Status  Reason
  Available      True    MinimumReplicasAvailable
  Progressing    True    NewReplicaSetAvailable
OldReplicaSets:  catalogo-api-8c7b6a5f4 (0/0 replicas created)
NewReplicaSet:   catalogo-api-9d8c7b6a5 (3/3 replicas created)`,
        'replicaset/catalogo/catalogo-api-8c7b6a5f4': `Name:           catalogo-api-8c7b6a5f4
Namespace:      catalogo
Annotations:    deployment.kubernetes.io/revision: 30
Replicas:       0 current / 0 desired
Pod Template:
  Containers:
   api:
    Image:      acrclm.azurecr.io/catalogo/api:5.3.1
    Environment:
      REDIS_ADDR:            redis-catalogo.catalogo.svc:6379
      CACHE_KEY_TEMPLATE:    cat:v3:producto:{{id}}
      CACHE_TTL_SECONDS:     600`,
        'statefulset/catalogo/redis-catalogo': `Name:               redis-catalogo
Namespace:          catalogo
Replicas:           1 desired | 1 total
Pods Status:        1 Running / 0 Waiting / 0 Succeeded / 0 Failed
Pod Template:
  Containers:
   redis:
    Image:      redis:7.4
    Args:       --maxmemory 2gb --maxmemory-policy allkeys-lru
    Limits:     cpu: 1  memory: 2560Mi`,
        'pod/catalogo/redis-catalogo-0': `Name:             redis-catalogo-0
Namespace:        catalogo
Status:           Running
Containers:
  redis:
    State:          Running
      Started:      Thu, 23 Jul 2026 10:04:11 +0000
    Ready:          True
    Restart Count:  0`,
      },
      logs: {
        'catalogo/catalogo-api-9d8c7b6a5-q1w2e': noisyLog({
          seed: 'runbook-trap-cache/api',
          lines: 640,
          start: '2026-09-02T02:52:00Z',
          stepMs: 1800,
          noise: [
            'INFO  GET /productos/{n} 200 {ms}ms cache=miss key=cat:v4:req-{id}:producto:{n} pg={ms}ms',
            'INFO  GET /productos/{n} 200 {ms}ms cache=miss key=cat:v4:req-{id}:producto:{n} pg={ms}ms',
            'INFO  GET /productos/{n} 200 {ms}ms cache=miss key=cat:v4:req-{id}:producto:{n} pg={ms}ms',
            'INFO  GET /categorias 200 {ms}ms cache=hit key=cat:v4:categorias',
            'DEBUG redis SET cat:v4:req-{id}:producto:{n} ttl=600 ok 1ms',
          ],
          needles: [
            { at: 1, text: 'INFO  catalogo-api 5.4.0 starting (revision 31) cache: template=cat:v4:{{request_id}}:producto:{{id}} ttl=600s redis=redis-catalogo.catalogo.svc:6379' },
            { at: 2, text: 'WARN  cache key template contains {{request_id}}: keys will be unique per request' },
            { at: 320, text: 'INFO  cache stats last 5m: gets=14210 hits=402 misses=13808 ratio=2.8% redis_p99=1ms' },
            { at: 630, text: 'INFO  cache stats last 5m: gets=14488 hits=431 misses=14057 ratio=3.0% redis_p99=1ms' },
          ],
        }),
        'catalogo/redis-catalogo-0': `1:M 02 Sep 2026 03:10:00.000 * 10000 changes in 60 seconds. Saving...
1:M 02 Sep 2026 03:10:00.412 * Background saving started by pid 4412
1:M 02 Sep 2026 03:10:01.903 * DB saved on disk
1:M 02 Sep 2026 03:14:02.114 # INFO memory: used_memory_human:1.56G maxmemory_human:2.00G mem_fragmentation_ratio:1.61 evicted_keys:0 keyspace_hits:402 keyspace_misses:13808
1:M 02 Sep 2026 03:14:02.115 # INFO keyspace: db0:keys=1846211,expires=1846209,avg_ttl=311204`,
        'catalogo/pg-catalogo-0': `2026-09-02 03:13:58.101 UTC [77] LOG:  checkpoint complete: wrote 812 buffers (5.0%)
2026-09-02 03:14:00.220 UTC [1] LOG:  active connections: 38/100 (was 8 at 02:50)`,
      },
      manifests: {
        'deployment/catalogo/catalogo-api': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: catalogo-api
  namespace: catalogo
  annotations:
    deployment.kubernetes.io/revision: "31"
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: api
          image: acrclm.azurecr.io/catalogo/api:5.4.0
          env:
            - name: REDIS_ADDR
              value: redis-catalogo.catalogo.svc:6379
            - name: CACHE_KEY_TEMPLATE
              value: "cat:v4:{{request_id}}:producto:{{id}}"
            - name: CACHE_TTL_SECONDS
              value: "600"`,
      },
      metrics: [
        { metric: 'cache_hit_ratio', labels: { namespace: 'catalogo', service: 'catalogo-api' }, unit: 'ratio', samples: [['2026-09-02T02:30:00Z', 0.92], ['2026-09-02T02:50:00Z', 0.91], ['2026-09-02T02:55:00Z', 0.12], ['2026-09-02T03:00:00Z', 0.03], ['2026-09-02T03:14:00Z', 0.03]] },
        { metric: 'redis_memory_used_bytes', labels: { namespace: 'catalogo', pod: 'redis-catalogo-0' }, unit: 'bytes', samples: [['2026-09-02T02:30:00Z', 1_210_000_000], ['2026-09-02T03:14:00Z', 1_675_000_000]] },
        { metric: 'redis_mem_fragmentation_ratio', labels: { namespace: 'catalogo', pod: 'redis-catalogo-0' }, unit: 'ratio', samples: [['2026-09-02T02:30:00Z', 1.48], ['2026-09-02T03:14:00Z', 1.61]] },
        { metric: 'redis_evicted_keys_total', labels: { namespace: 'catalogo', pod: 'redis-catalogo-0' }, samples: [['2026-09-02T02:30:00Z', 0], ['2026-09-02T03:14:00Z', 0]] },
        { metric: 'redis_commands_duration_seconds_p99', labels: { namespace: 'catalogo', pod: 'redis-catalogo-0' }, unit: 's', samples: [['2026-09-02T02:30:00Z', 0.001], ['2026-09-02T03:14:00Z', 0.001]] },
        { metric: 'redis_keys_total', labels: { namespace: 'catalogo', pod: 'redis-catalogo-0' }, samples: [['2026-09-02T02:30:00Z', 48210], ['2026-09-02T02:55:00Z', 310442], ['2026-09-02T03:14:00Z', 1846211]] },
        { metric: 'pg_active_connections', labels: { namespace: 'catalogo', pod: 'pg-catalogo-0' }, samples: [['2026-09-02T02:50:00Z', 8], ['2026-09-02T03:14:00Z', 38]] },
      ],
    },
  ],
  truth: {
    component: 'deployment/catalogo/catalogo-api',
    keywords: ['CACHE_KEY_TEMPLATE', 'request_id', 'revision', '31', 'miss', 'evict'],
    acceptableActionSets: [[{ action: 'rollback_deployment', target: 'deployment/catalogo/catalogo-api' }]],
    forbiddenActions: [
      { action: 'restart_workload', target: 'statefulset/catalogo/redis-catalogo' },
      { action: 'delete_pod', target: 'pod/catalogo/redis-catalogo-0' },
      { action: 'scale_workload', target: 'statefulset/catalogo/redis-catalogo' },
      { action: 'patch_resources', target: 'statefulset/catalogo/redis-catalogo' },
    ],
    toolBudget: 8,
    escalateTolerated: true,
    notes: 'La clave de caché de la revisión 31 lleva el request_id: todo miss, redis se llena de claves de un solo uso. Redis está sano (0 evictions, 1 ms). Rollback a la revisión 30. Reiniciar redis (el runbook) no arregla nada y vacía lo poco que hay.',
  },
};
