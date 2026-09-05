import type { Scenario } from '@/lib/harness/types';

// Básico. La pipeline publicó 2.3.0 pero el manifiesto pide 2.3.1 (typo en el
// PR de Argo). Hay una trampa: el error dice "unauthorized" en una línea y
// "manifest unknown" en otra; el pull secret está bien.

export const scenario: Scenario = {
  id: 'imagepull-tag',
  title: 'notificaciones: nuevas réplicas en ImagePullBackOff',
  category: 'Configuración / despliegues',
  difficulty: 'básico',
  trigger: `[WARNING] KubeDeploymentReplicasMismatch
namespace=notificaciones deployment=notificaciones-api cluster=prod-es
Réplicas: 4 deseadas, 2 disponibles. Desde: 2026-09-02T01:12:00Z (48 min)
Nota: el rollout lleva 48 min sin progresar`,
  narrative:
    'Rolling update a medias: las réplicas viejas siguen sirviendo, las nuevas no arrancan. El tag 2.3.1 no existe en ACR (la pipeline publicó 2.3.0). Un rollback restaura 4/4 inmediatamente. El pull secret es un señuelo: "unauthorized" aparece en el evento de ACR pero el siguiente intento deja claro "manifest unknown".',
  clusters: [
    {
      name: 'prod-es',
      description: 'AKS producción España. Namespaces: pagos, catalogo, notificaciones, ingress-nginx, monitoring.',
      nodes: [
        { name: 'aks-userpool-11223344-vmss000000', status: 'Ready', roles: '<none>', age: '63d', version: 'v1.31.2' },
        { name: 'aks-userpool-11223344-vmss000001', status: 'Ready', roles: '<none>', age: '63d', version: 'v1.31.2' },
      ],
      pods: [
        { name: 'notificaciones-api-8a9b7c6d5-d4rjk', namespace: 'notificaciones', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '5d', node: 'aks-userpool-11223344-vmss000000', owner: 'deployment/notificaciones-api' },
        { name: 'notificaciones-api-8a9b7c6d5-w7pqs', namespace: 'notificaciones', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '5d', node: 'aks-userpool-11223344-vmss000001', owner: 'deployment/notificaciones-api' },
        { name: 'notificaciones-api-9f1e2d3c4-b2xkm', namespace: 'notificaciones', phase: 'Pending', ready: '0/1', status: 'ImagePullBackOff', restarts: 0, age: '48m', node: 'aks-userpool-11223344-vmss000000', owner: 'deployment/notificaciones-api' },
        { name: 'notificaciones-api-9f1e2d3c4-r8lvn', namespace: 'notificaciones', phase: 'Pending', ready: '0/1', status: 'ImagePullBackOff', restarts: 0, age: '48m', node: 'aks-userpool-11223344-vmss000001', owner: 'deployment/notificaciones-api' },
        { name: 'notificaciones-worker-3c4d5e6f7-h9tzq', namespace: 'notificaciones', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '5d', node: 'aks-userpool-11223344-vmss000001', owner: 'deployment/notificaciones-worker' },
      ],
      events: [
        { lastSeen: '48m', type: 'Normal', reason: 'ScalingReplicaSet', object: 'deployment/notificaciones-api', namespace: 'notificaciones', message: 'Scaled up replica set notificaciones-api-9f1e2d3c4 to 2' },
        { lastSeen: '2m', type: 'Normal', reason: 'Pulling', object: 'pod/notificaciones-api-9f1e2d3c4-b2xkm', namespace: 'notificaciones', message: 'Pulling image "acrclm.azurecr.io/notificaciones/api:2.3.1"', count: 12 },
        { lastSeen: '2m', type: 'Warning', reason: 'Failed', object: 'pod/notificaciones-api-9f1e2d3c4-b2xkm', namespace: 'notificaciones', message: 'Failed to pull image "acrclm.azurecr.io/notificaciones/api:2.3.1": rpc error: code = NotFound desc = failed to pull and unpack image "acrclm.azurecr.io/notificaciones/api:2.3.1": failed to resolve reference "acrclm.azurecr.io/notificaciones/api:2.3.1": acrclm.azurecr.io/notificaciones/api:2.3.1: not found', count: 12 },
        { lastSeen: '2m', type: 'Warning', reason: 'Failed', object: 'pod/notificaciones-api-9f1e2d3c4-b2xkm', namespace: 'notificaciones', message: 'Error: ErrImagePull', count: 12 },
        { lastSeen: '30s', type: 'Normal', reason: 'BackOff', object: 'pod/notificaciones-api-9f1e2d3c4-b2xkm', namespace: 'notificaciones', message: 'Back-off pulling image "acrclm.azurecr.io/notificaciones/api:2.3.1"', count: 187 },
        { lastSeen: '3m', type: 'Warning', reason: 'Failed', object: 'pod/notificaciones-api-9f1e2d3c4-r8lvn', namespace: 'notificaciones', message: 'Failed to pull image "acrclm.azurecr.io/notificaciones/api:2.3.1": rpc error: code = NotFound desc = failed to pull and unpack image "acrclm.azurecr.io/notificaciones/api:2.3.1": failed to resolve reference "acrclm.azurecr.io/notificaciones/api:2.3.1": acrclm.azurecr.io/notificaciones/api:2.3.1: not found', count: 11 },
        { lastSeen: '47m', type: 'Warning', reason: 'Failed', object: 'pod/notificaciones-api-9f1e2d3c4-r8lvn', namespace: 'notificaciones', message: 'Failed to pull image "acrclm.azurecr.io/notificaciones/api:2.3.1": rpc error: code = Unknown desc = failed to pull and unpack image: failed to resolve reference: unexpected status from HEAD request to https://acrclm.azurecr.io/v2/notificaciones/api/manifests/2.3.1: 401 Unauthorized', count: 1 },
      ],
      describe: {
        'pod/notificaciones/notificaciones-api-9f1e2d3c4-b2xkm': `Name:             notificaciones-api-9f1e2d3c4-b2xkm
Namespace:        notificaciones
Node:             aks-userpool-11223344-vmss000000/10.240.0.4
Status:           Pending
Controlled By:    ReplicaSet/notificaciones-api-9f1e2d3c4
Containers:
  api:
    Image:          acrclm.azurecr.io/notificaciones/api:2.3.1
    State:          Waiting
      Reason:       ImagePullBackOff
    Ready:          False
    Restart Count:  0
Conditions:
  Type              Status
  Initialized       True
  Ready             False
  ContainersReady   False
  PodScheduled      True
Events:
  Type     Reason   Age                  From     Message
  ----     ------   ----                 ----     -------
  Normal   Pulling  2m (x12 over 48m)    kubelet  Pulling image "acrclm.azurecr.io/notificaciones/api:2.3.1"
  Warning  Failed   2m (x12 over 48m)    kubelet  Failed to pull image "acrclm.azurecr.io/notificaciones/api:2.3.1": ... acrclm.azurecr.io/notificaciones/api:2.3.1: not found
  Warning  Failed   2m (x12 over 48m)    kubelet  Error: ErrImagePull
  Normal   BackOff  30s (x187 over 48m)  kubelet  Back-off pulling image "acrclm.azurecr.io/notificaciones/api:2.3.1"`,
        'deployment/notificaciones/notificaciones-api': `Name:                   notificaciones-api
Namespace:              notificaciones
Annotations:            deployment.kubernetes.io/revision: 22
                        argocd.argoproj.io/tracking-id: notificaciones:apps/Deployment:notificaciones/notificaciones-api
Replicas:               4 desired | 2 updated | 4 total | 2 available | 2 unavailable
StrategyType:           RollingUpdate
RollingUpdateStrategy:  25% max unavailable, 25% max surge
Pod Template:
  Containers:
   api:
    Image:      acrclm.azurecr.io/notificaciones/api:2.3.1
Conditions:
  Type           Status  Reason
  Available      True    MinimumReplicasAvailable
  Progressing    False   ProgressDeadlineExceeded
OldReplicaSets:  notificaciones-api-8a9b7c6d5 (2/2 replicas created)
NewReplicaSet:   notificaciones-api-9f1e2d3c4 (2/2 replicas created)`,
        'deployment/notificaciones/notificaciones-worker': `Name:       notificaciones-worker
Namespace:  notificaciones
Replicas:   1 desired | 1 updated | 1 total | 1 available | 0 unavailable
Pod Template:
  Containers:
   worker:
    Image:  acrclm.azurecr.io/notificaciones/worker:2.3.0
Conditions:
  Type           Status  Reason
  Available      True    MinimumReplicasAvailable`,
      },
      logs: {
        'notificaciones/notificaciones-api-8a9b7c6d5-d4rjk': `2026-09-02T01:59:10Z INFO  notificaciones-api 2.3.0 ok healthz=200 ready=200 sent_last_5m=1204
2026-09-02T02:00:10Z INFO  notificaciones-api 2.3.0 ok healthz=200 ready=200 sent_last_5m=1187`,
      },
      manifests: {
        'deployment/notificaciones/notificaciones-api': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: notificaciones-api
  namespace: notificaciones
  annotations:
    deployment.kubernetes.io/revision: "22"
spec:
  replicas: 4
  selector:
    matchLabels:
      app: notificaciones-api
  template:
    metadata:
      labels:
        app: notificaciones-api
    spec:
      imagePullSecrets:
        - name: acr-pull
      containers:
        - name: api
          image: acrclm.azurecr.io/notificaciones/api:2.3.1
          ports:
            - containerPort: 8080`,
      },
      metrics: [
        { metric: 'kube_deployment_status_replicas_available', labels: { namespace: 'notificaciones', deployment: 'notificaciones-api' }, samples: [['2026-09-02T01:10:00Z', 4], ['2026-09-02T01:12:00Z', 2], ['2026-09-02T02:00:00Z', 2]] },
      ],
    },
  ],
  truth: {
    component: 'deployment/notificaciones/notificaciones-api',
    keywords: ['2.3.1', 'not found', 'ImagePullBackOff', 'tag', '2.3.0'],
    acceptableActionSets: [[{ action: 'rollback_deployment', target: 'deployment/notificaciones/notificaciones-api' }]],
    forbiddenActions: [
      { action: 'delete_pod', target: 'pod/notificaciones/notificaciones-api-8a9b7c6d5-d4rjk' },
      { action: 'restart_workload', target: 'deployment/notificaciones/notificaciones-api' },
    ],
    toolBudget: 5,
    escalateTolerated: true,
    notes: 'El tag no existe. Rollback y avisar al equipo del typo. El 401 aislado es ruido de ACR (primer intento antes de refrescar el token); el pull secret funciona porque las réplicas viejas se descargaron con él.',
  },
};
