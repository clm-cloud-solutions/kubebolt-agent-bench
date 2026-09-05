import type { Scenario } from '@/lib/harness/types';

// Básico. Un rollout renombró la clave del ConfigMap (DATABASE_URL → DB_URL)
// pero el binario nuevo sigue esperando DATABASE_URL. Rollback o parchear la
// clave; ambas valen.

export const scenario: Scenario = {
  id: 'configmap-crashloop',
  title: 'api-pagos en CrashLoopBackOff tras un despliegue',
  category: 'Configuración / despliegues',
  difficulty: 'básico',
  trigger: `[CRITICAL] KubePodCrashLooping
namespace=pagos pod=api-pagos-7d9f8c6b5-* cluster=prod-es
Pods reiniciándose: 3/3. Desde: 2026-09-02T02:47:00Z (11 min)
Servicio afectado: api-pagos (checkout y reembolsos)`,
  narrative:
    'El desarrollador cambió el nombre de la variable en el ConfigMap del chart pero el código que se desplegó todavía lee la antigua. Caso de entrada: debería resolverse en 3-4 tool calls.',
  clusters: [
    {
      name: 'prod-es',
      description: 'AKS producción España. Namespaces: pagos, catalogo, ingress-nginx, monitoring.',
      nodes: [
        { name: 'aks-userpool-11223344-vmss000000', status: 'Ready', roles: '<none>', age: '63d', version: 'v1.31.2' },
        { name: 'aks-userpool-11223344-vmss000001', status: 'Ready', roles: '<none>', age: '63d', version: 'v1.31.2' },
        { name: 'aks-userpool-11223344-vmss000002', status: 'Ready', roles: '<none>', age: '63d', version: 'v1.31.2' },
      ],
      pods: [
        { name: 'api-pagos-7d9f8c6b5-k2x8w', namespace: 'pagos', phase: 'Running', ready: '0/1', status: 'CrashLoopBackOff', restarts: 7, age: '11m', node: 'aks-userpool-11223344-vmss000000', owner: 'deployment/api-pagos' },
        { name: 'api-pagos-7d9f8c6b5-mq4hn', namespace: 'pagos', phase: 'Running', ready: '0/1', status: 'CrashLoopBackOff', restarts: 7, age: '11m', node: 'aks-userpool-11223344-vmss000001', owner: 'deployment/api-pagos' },
        { name: 'api-pagos-7d9f8c6b5-z9vlt', namespace: 'pagos', phase: 'Running', ready: '0/1', status: 'CrashLoopBackOff', restarts: 6, age: '11m', node: 'aks-userpool-11223344-vmss000002', owner: 'deployment/api-pagos' },
        { name: 'worker-reembolsos-5c6d7e8f9-t3nbp', namespace: 'pagos', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '6d', node: 'aks-userpool-11223344-vmss000001', owner: 'deployment/worker-reembolsos' },
        { name: 'redis-pagos-0', namespace: 'pagos', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '63d', node: 'aks-userpool-11223344-vmss000002', owner: 'statefulset/redis-pagos' },
        { name: 'catalogo-api-6b7c8d9e0-p8kzr', namespace: 'catalogo', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '2d', node: 'aks-userpool-11223344-vmss000000', owner: 'deployment/catalogo-api' },
      ],
      events: [
        { lastSeen: '11m', type: 'Normal', reason: 'ScalingReplicaSet', object: 'deployment/api-pagos', namespace: 'pagos', message: 'Scaled up replica set api-pagos-7d9f8c6b5 to 3' },
        { lastSeen: '10m', type: 'Normal', reason: 'ScalingReplicaSet', object: 'deployment/api-pagos', namespace: 'pagos', message: 'Scaled down replica set api-pagos-5b8a7c9d4 to 0' },
        { lastSeen: '32s', type: 'Warning', reason: 'BackOff', object: 'pod/api-pagos-7d9f8c6b5-k2x8w', namespace: 'pagos', message: 'Back-off restarting failed container api in pod api-pagos-7d9f8c6b5-k2x8w', count: 41 },
        { lastSeen: '40s', type: 'Warning', reason: 'BackOff', object: 'pod/api-pagos-7d9f8c6b5-mq4hn', namespace: 'pagos', message: 'Back-off restarting failed container api in pod api-pagos-7d9f8c6b5-mq4hn', count: 39 },
        { lastSeen: '55s', type: 'Warning', reason: 'BackOff', object: 'pod/api-pagos-7d9f8c6b5-z9vlt', namespace: 'pagos', message: 'Back-off restarting failed container api in pod api-pagos-7d9f8c6b5-z9vlt', count: 37 },
      ],
      describe: {
        'pod/pagos/api-pagos-7d9f8c6b5-k2x8w': `Name:             api-pagos-7d9f8c6b5-k2x8w
Namespace:        pagos
Node:             aks-userpool-11223344-vmss000000/10.240.0.4
Labels:           app=api-pagos
                  pod-template-hash=7d9f8c6b5
Status:           Running
Controlled By:    ReplicaSet/api-pagos-7d9f8c6b5
Containers:
  api:
    Image:          acrclm.azurecr.io/pagos/api-pagos:1.14.0
    State:          Waiting
      Reason:       CrashLoopBackOff
    Last State:     Terminated
      Reason:       Error
      Exit Code:    1
      Started:      Tue, 02 Sep 2026 02:56:40 +0000
      Finished:     Tue, 02 Sep 2026 02:56:41 +0000
    Ready:          False
    Restart Count:  7
    Limits:         cpu: 500m  memory: 512Mi
    Requests:       cpu: 200m  memory: 256Mi
    Liveness:       http-get http://:8080/healthz delay=10s timeout=1s period=10s
    Readiness:      http-get http://:8080/ready delay=5s timeout=1s period=5s
    Environment Variables from:
      api-pagos-config  ConfigMap  Optional: false
    Environment:
      PORT:            8080
      REDIS_ADDR:      redis-pagos.pagos.svc:6379
Conditions:
  Type              Status
  Initialized       True
  Ready             False
  ContainersReady   False
  PodScheduled      True`,
        'deployment/pagos/api-pagos': `Name:                   api-pagos
Namespace:              pagos
CreationTimestamp:      Mon, 01 Jul 2026 09:12:03 +0000
Labels:                 app=api-pagos
Annotations:            deployment.kubernetes.io/revision: 14
                        argocd.argoproj.io/tracking-id: pagos:apps/Deployment:pagos/api-pagos
Selector:               app=api-pagos
Replicas:               3 desired | 3 updated | 3 total | 0 available | 3 unavailable
StrategyType:           RollingUpdate
Pod Template:
  Containers:
   api:
    Image:      acrclm.azurecr.io/pagos/api-pagos:1.14.0
    Environment Variables from:
      api-pagos-config  ConfigMap  Optional: false
Conditions:
  Type           Status  Reason
  Available      False   MinimumReplicasUnavailable
  Progressing    False   ProgressDeadlineExceeded
OldReplicaSets:  api-pagos-5b8a7c9d4 (0/0 replicas created)
NewReplicaSet:   api-pagos-7d9f8c6b5 (3/3 replicas created)
Events:
  Type    Reason             Age   From                   Message
  ----    ------             ----  ----                   -------
  Normal  ScalingReplicaSet  11m   deployment-controller  Scaled up replica set api-pagos-7d9f8c6b5 to 3
  Normal  ScalingReplicaSet  10m   deployment-controller  Scaled down replica set api-pagos-5b8a7c9d4 to 0`,
        'configmap/pagos/api-pagos-config': `Name:         api-pagos-config
Namespace:    pagos
Labels:       app=api-pagos
Annotations:  argocd.argoproj.io/tracking-id: pagos:/ConfigMap:pagos/api-pagos-config

Data
====
DB_URL:
----
postgres://api_pagos@pg-pagos.db.svc:5432/pagos?sslmode=require
LOG_LEVEL:
----
info
STRIPE_WEBHOOK_PATH:
----
/webhooks/stripe

Events:  <none>`,
      },
      logs: {
        'pagos/api-pagos-7d9f8c6b5-k2x8w': `{"level":"info","ts":"2026-09-02T02:56:40.911Z","msg":"api-pagos starting","version":"1.14.0","commit":"a91f3c2"}
{"level":"info","ts":"2026-09-02T02:56:40.913Z","msg":"loading configuration from environment"}
{"level":"fatal","ts":"2026-09-02T02:56:40.914Z","msg":"missing required environment variable","var":"DATABASE_URL","hint":"set DATABASE_URL to a postgres:// connection string"}`,
        'pagos/api-pagos-7d9f8c6b5-mq4hn': `{"level":"info","ts":"2026-09-02T02:56:12.203Z","msg":"api-pagos starting","version":"1.14.0","commit":"a91f3c2"}
{"level":"info","ts":"2026-09-02T02:56:12.205Z","msg":"loading configuration from environment"}
{"level":"fatal","ts":"2026-09-02T02:56:12.206Z","msg":"missing required environment variable","var":"DATABASE_URL","hint":"set DATABASE_URL to a postgres:// connection string"}`,
        'pagos/worker-reembolsos-5c6d7e8f9-t3nbp': `{"level":"info","ts":"2026-09-02T02:58:00.001Z","msg":"polling refunds queue","pending":0}`,
      },
      manifests: {
        'deployment/pagos/api-pagos': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-pagos
  namespace: pagos
  annotations:
    deployment.kubernetes.io/revision: "14"
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-pagos
  template:
    metadata:
      labels:
        app: api-pagos
    spec:
      containers:
        - name: api
          image: acrclm.azurecr.io/pagos/api-pagos:1.14.0
          ports:
            - containerPort: 8080
          envFrom:
            - configMapRef:
                name: api-pagos-config
          env:
            - name: PORT
              value: "8080"
            - name: REDIS_ADDR
              value: redis-pagos.pagos.svc:6379
          resources:
            requests: { cpu: 200m, memory: 256Mi }
            limits: { cpu: 500m, memory: 512Mi }`,
        'configmap/pagos/api-pagos-config': `apiVersion: v1
kind: ConfigMap
metadata:
  name: api-pagos-config
  namespace: pagos
data:
  DB_URL: postgres://api_pagos@pg-pagos.db.svc:5432/pagos?sslmode=require
  LOG_LEVEL: info
  STRIPE_WEBHOOK_PATH: /webhooks/stripe`,
      },
      metrics: [
        { metric: 'kube_pod_container_status_restarts_total', labels: { namespace: 'pagos', pod: 'api-pagos-7d9f8c6b5-k2x8w', container: 'api' }, samples: [['2026-09-02T02:47:00Z', 0], ['2026-09-02T02:50:00Z', 3], ['2026-09-02T02:54:00Z', 5], ['2026-09-02T02:58:00Z', 7]] },
        { metric: 'http_requests_total', labels: { namespace: 'pagos', service: 'api-pagos', code: '503' }, samples: [['2026-09-02T02:45:00Z', 0], ['2026-09-02T02:50:00Z', 1842], ['2026-09-02T02:58:00Z', 5107]] },
      ],
    },
  ],
  truth: {
    component: 'deployment/pagos/api-pagos',
    keywords: ['DATABASE_URL', 'DB_URL', 'configmap', 'api-pagos-config', 'revision', '1.14.0'],
    acceptableActionSets: [
      [{ action: 'rollback_deployment', target: 'deployment/pagos/api-pagos' }],
      [{ action: 'patch_configmap_key', target: 'configmap/pagos/api-pagos-config' }],
      [
        { action: 'patch_configmap_key', target: 'configmap/pagos/api-pagos-config' },
        { action: 'restart_workload', target: 'deployment/pagos/api-pagos' },
      ],
    ],
    forbiddenActions: [
      { action: 'restart_workload', target: 'statefulset/pagos/redis-pagos' },
      { action: 'scale_workload', target: 'deployment/pagos/api-pagos' },
    ],
    toolBudget: 5,
    escalateTolerated: true,
    notes: 'Rollback a la revisión 13 o añadir DATABASE_URL al ConfigMap. Reiniciar sin cambiar nada no hace nada; escalar réplicas tampoco.',
  },
};
