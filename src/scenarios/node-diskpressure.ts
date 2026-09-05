import type { Scenario } from '@/lib/harness/types';

// Medio. La alerta es de nodo (DiskPressure + evictions). La causa es un
// workload: reportes-worker pasó a LOG_LEVEL=debug en la revisión 8 y llena
// el disco efímero del nodo con logs. Cordonar es paliativo; rollback es la
// causa. Drenar el nodo mueve el problema a otro nodo.

export const scenario: Scenario = {
  id: 'node-diskpressure',
  title: 'Nodo con DiskPressure y pods desalojados',
  category: 'Nodos / capacidad',
  difficulty: 'medio',
  trigger: `[CRITICAL] KubeNodeDiskPressure
node=aks-userpool-11223344-vmss000002 cluster=prod-es
Condición DiskPressure=True desde 2026-09-02T02:31:00Z. 5 pods desalojados en los últimos 20 min.
Alertas asociadas: KubePodEvicted (namespace=catalogo, namespace=reportes)`,
  narrative:
    'Hace 2h se desplegó reportes-worker rev 8 con LOG_LEVEL=debug (se coló de staging). Escribe ~180MB/min de logs a stdout → containerd los guarda en /var/log/pods → disco efímero lleno → kubelet desaloja. Si solo cordonas el nodo, el worker se reprograma en otro y lo llena también. La acción correcta es rollback (o patch del ConfigMap) y, opcionalmente, cordonar mientras se limpia.',
  clusters: [
    {
      name: 'prod-es',
      description: 'AKS producción España. Namespaces: pagos, catalogo, reportes, ingress-nginx, monitoring.',
      nodes: [
        { name: 'aks-userpool-11223344-vmss000000', status: 'Ready', roles: '<none>', age: '63d', version: 'v1.31.2', conditions: ['DiskPressure=False'] },
        { name: 'aks-userpool-11223344-vmss000001', status: 'Ready', roles: '<none>', age: '63d', version: 'v1.31.2', conditions: ['DiskPressure=False'] },
        { name: 'aks-userpool-11223344-vmss000002', status: 'Ready', roles: '<none>', age: '63d', version: 'v1.31.2', conditions: ['DiskPressure=True', 'MemoryPressure=False'] },
      ],
      pods: [
        { name: 'reportes-worker-6d7e8f9a0-c3vqn', namespace: 'reportes', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '2h', node: 'aks-userpool-11223344-vmss000002', owner: 'deployment/reportes-worker' },
        { name: 'reportes-worker-6d7e8f9a0-k8mzw', namespace: 'reportes', phase: 'Failed', ready: '0/1', status: 'Evicted', restarts: 0, age: '2h', node: 'aks-userpool-11223344-vmss000002', owner: 'deployment/reportes-worker' },
        { name: 'reportes-worker-6d7e8f9a0-p2xlt', namespace: 'reportes', phase: 'Pending', ready: '0/1', status: 'Pending', restarts: 0, age: '4m', node: '<none>', owner: 'deployment/reportes-worker' },
        { name: 'catalogo-api-6b7c8d9e0-p8kzr', namespace: 'catalogo', phase: 'Failed', ready: '0/1', status: 'Evicted', restarts: 0, age: '2d', node: 'aks-userpool-11223344-vmss000002', owner: 'deployment/catalogo-api' },
        { name: 'catalogo-api-6b7c8d9e0-t5rwj', namespace: 'catalogo', phase: 'Failed', ready: '0/1', status: 'Evicted', restarts: 0, age: '2d', node: 'aks-userpool-11223344-vmss000002', owner: 'deployment/catalogo-api' },
        { name: 'catalogo-api-6b7c8d9e0-v9nqe', namespace: 'catalogo', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '14m', node: 'aks-userpool-11223344-vmss000000', owner: 'deployment/catalogo-api' },
        { name: 'catalogo-api-6b7c8d9e0-x1kfd', namespace: 'catalogo', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '9m', node: 'aks-userpool-11223344-vmss000001', owner: 'deployment/catalogo-api' },
        { name: 'api-pagos-5b8a7c9d4-hh2qz', namespace: 'pagos', phase: 'Failed', ready: '0/1', status: 'Evicted', restarts: 0, age: '6d', node: 'aks-userpool-11223344-vmss000002', owner: 'deployment/api-pagos' },
        { name: 'api-pagos-5b8a7c9d4-m4tnb', namespace: 'pagos', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '11m', node: 'aks-userpool-11223344-vmss000000', owner: 'deployment/api-pagos' },
        { name: 'api-pagos-5b8a7c9d4-r7wpx', namespace: 'pagos', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '6d', node: 'aks-userpool-11223344-vmss000001', owner: 'deployment/api-pagos' },
        { name: 'promtail-8gk4z', namespace: 'monitoring', phase: 'Running', ready: '1/1', status: 'Running', restarts: 2, age: '63d', node: 'aks-userpool-11223344-vmss000002', owner: 'daemonset/promtail' },
      ],
      events: [
        { lastSeen: '2h', type: 'Normal', reason: 'ScalingReplicaSet', object: 'deployment/reportes-worker', namespace: 'reportes', message: 'Scaled up replica set reportes-worker-6d7e8f9a0 to 2' },
        { lastSeen: '2h', type: 'Normal', reason: 'ScalingReplicaSet', object: 'deployment/reportes-worker', namespace: 'reportes', message: 'Scaled down replica set reportes-worker-5c6d7e8f9 to 0' },
        { lastSeen: '19m', type: 'Warning', reason: 'EvictionThresholdMet', object: 'node/aks-userpool-11223344-vmss000002', namespace: '-', message: 'Attempting to reclaim ephemeral-storage' },
        { lastSeen: '19m', type: 'Normal', reason: 'NodeHasDiskPressure', object: 'node/aks-userpool-11223344-vmss000002', namespace: '-', message: 'Node aks-userpool-11223344-vmss000002 status is now: NodeHasDiskPressure' },
        { lastSeen: '18m', type: 'Warning', reason: 'Evicted', object: 'pod/catalogo-api-6b7c8d9e0-p8kzr', namespace: 'catalogo', message: 'The node was low on resource: ephemeral-storage. Threshold quantity: 12836451328, available: 1012318208. Container api was using 84Ki, request is 0, has larger consumption of ephemeral-storage.' },
        { lastSeen: '16m', type: 'Warning', reason: 'Evicted', object: 'pod/catalogo-api-6b7c8d9e0-t5rwj', namespace: 'catalogo', message: 'The node was low on resource: ephemeral-storage. Threshold quantity: 12836451328, available: 934571008.' },
        { lastSeen: '14m', type: 'Warning', reason: 'Evicted', object: 'pod/api-pagos-5b8a7c9d4-hh2qz', namespace: 'pagos', message: 'The node was low on resource: ephemeral-storage. Threshold quantity: 12836451328, available: 801226752.' },
        { lastSeen: '9m', type: 'Warning', reason: 'Evicted', object: 'pod/reportes-worker-6d7e8f9a0-k8mzw', namespace: 'reportes', message: 'The node was low on resource: ephemeral-storage. Threshold quantity: 12836451328, available: 612368384. Container worker was using 9126Mi, request is 0, has larger consumption of ephemeral-storage.' },
        { lastSeen: '4m', type: 'Warning', reason: 'FailedScheduling', object: 'pod/reportes-worker-6d7e8f9a0-p2xlt', namespace: 'reportes', message: '0/3 nodes are available: 1 node(s) had untolerated taint {node.kubernetes.io/disk-pressure: }, 2 Insufficient cpu. preemption: 0/3 nodes are available: 3 No preemption victims found for incoming pod.', count: 9 },
      ],
      describe: {
        'node/-/aks-userpool-11223344-vmss000002': `Name:               aks-userpool-11223344-vmss000002
Roles:              <none>
Taints:             node.kubernetes.io/disk-pressure:NoSchedule
Unschedulable:      false
Conditions:
  Type             Status  LastHeartbeatTime                 LastTransitionTime                Reason                       Message
  ----             ------  -----------------                 ------------------                ------                       -------
  MemoryPressure   False   Tue, 02 Sep 2026 02:50:12 +0000   Tue, 01 Jul 2026 09:00:11 +0000   KubeletHasSufficientMemory   kubelet has sufficient memory available
  DiskPressure     True    Tue, 02 Sep 2026 02:50:12 +0000   Tue, 02 Sep 2026 02:31:04 +0000   KubeletHasDiskPressure       kubelet has disk pressure
  PIDPressure      False   Tue, 02 Sep 2026 02:50:12 +0000   Tue, 01 Jul 2026 09:00:11 +0000   KubeletHasSufficientPID      kubelet has sufficient PID available
  Ready            True    Tue, 02 Sep 2026 02:50:12 +0000   Tue, 01 Jul 2026 09:00:11 +0000   KubeletReady                 kubelet is posting ready status
Capacity:
  cpu:                4
  ephemeral-storage:  129886128Ki
  memory:             16374260Ki
Allocatable:
  cpu:                3860m
  ephemeral-storage:  119703055367
  memory:             12880372Ki
Non-terminated Pods:          (3 in total)
  Namespace   Name                              CPU Requests  Memory Requests
  reportes    reportes-worker-6d7e8f9a0-c3vqn   500m          512Mi
  monitoring  promtail-8gk4z                    100m          128Mi
  kube-system kube-proxy-9zk2q                  100m          0
Events:
  Type     Reason                Age   From     Message
  ----     ------                ----  ----     -------
  Warning  EvictionThresholdMet  19m   kubelet  Attempting to reclaim ephemeral-storage
  Normal   NodeHasDiskPressure   19m   kubelet  Node aks-userpool-11223344-vmss000002 status is now: NodeHasDiskPressure`,
        'deployment/reportes/reportes-worker': `Name:                   reportes-worker
Namespace:              reportes
Annotations:            deployment.kubernetes.io/revision: 8
                        argocd.argoproj.io/tracking-id: reportes:apps/Deployment:reportes/reportes-worker
Replicas:               2 desired | 2 updated | 2 total | 1 available | 1 unavailable
Pod Template:
  Containers:
   worker:
    Image:      acrclm.azurecr.io/reportes/worker:4.8.1
    Environment:
      LOG_LEVEL:    debug
      LOG_FORMAT:   json
      QUEUE_URL:    amqp://rabbit.reportes.svc:5672
    Requests:       cpu: 500m  memory: 512Mi
    Limits:         cpu: 1  memory: 1Gi
Conditions:
  Type           Status  Reason
  Available      True    MinimumReplicasAvailable
  Progressing    True    NewReplicaSetAvailable
OldReplicaSets:  reportes-worker-5c6d7e8f9 (0/0 replicas created)
NewReplicaSet:   reportes-worker-6d7e8f9a0 (2/2 replicas created)
Events:
  Type    Reason             Age   From                   Message
  ----    ------             ----  ----                   -------
  Normal  ScalingReplicaSet  2h    deployment-controller  Scaled up replica set reportes-worker-6d7e8f9a0 to 2
  Normal  ScalingReplicaSet  2h    deployment-controller  Scaled down replica set reportes-worker-5c6d7e8f9 to 0`,
        'pod/reportes/reportes-worker-6d7e8f9a0-c3vqn': `Name:             reportes-worker-6d7e8f9a0-c3vqn
Namespace:        reportes
Node:             aks-userpool-11223344-vmss000002/10.240.0.6
Status:           Running
Controlled By:    ReplicaSet/reportes-worker-6d7e8f9a0
Containers:
  worker:
    Image:          acrclm.azurecr.io/reportes/worker:4.8.1
    State:          Running
      Started:      Tue, 02 Sep 2026 00:49:31 +0000
    Ready:          True
    Restart Count:  0
    Environment:
      LOG_LEVEL:    debug
      LOG_FORMAT:   json
      QUEUE_URL:    amqp://rabbit.reportes.svc:5672`,
        'pod/catalogo/catalogo-api-6b7c8d9e0-p8kzr': `Name:             catalogo-api-6b7c8d9e0-p8kzr
Namespace:        catalogo
Node:             aks-userpool-11223344-vmss000002/10.240.0.6
Status:           Failed
Reason:           Evicted
Message:          The node was low on resource: ephemeral-storage. Threshold quantity: 12836451328, available: 1012318208. Container api was using 84Ki, request is 0, has larger consumption of ephemeral-storage.
Controlled By:    ReplicaSet/catalogo-api-6b7c8d9e0`,
      },
      logs: {
        'reportes/reportes-worker-6d7e8f9a0-c3vqn': `{"level":"debug","ts":"2026-09-02T02:50:11.001Z","msg":"amqp frame","dir":"in","bytes":2048,"payload":"<...4096 chars omitidos...>"}
{"level":"debug","ts":"2026-09-02T02:50:11.002Z","msg":"amqp frame","dir":"in","bytes":2048,"payload":"<...4096 chars omitidos...>"}
{"level":"debug","ts":"2026-09-02T02:50:11.002Z","msg":"sql","query":"SELECT * FROM ventas WHERE fecha >= $1","rows":18211,"dump":"<...131072 chars omitidos...>"}
{"level":"debug","ts":"2026-09-02T02:50:11.004Z","msg":"amqp frame","dir":"in","bytes":2048,"payload":"<...4096 chars omitidos...>"}
{"level":"info","ts":"2026-09-02T02:50:11.010Z","msg":"reporte generado","id":"rep-88213","ms":412}
{"level":"debug","ts":"2026-09-02T02:50:11.011Z","msg":"sql","query":"SELECT * FROM ventas WHERE fecha >= $1","rows":18204,"dump":"<...131072 chars omitidos...>"}
{"level":"debug","ts":"2026-09-02T02:50:11.013Z","msg":"amqp frame","dir":"in","bytes":2048,"payload":"<...4096 chars omitidos...>"}
[... ~2.900 líneas/segundo a este nivel ...]`,
        'catalogo/catalogo-api-6b7c8d9e0-v9nqe': `2026-09-02T02:50:00Z INFO catalogo-api ready, serving on :8080`,
        'monitoring/promtail-8gk4z': `level=warn ts=2026-09-02T02:49:58.114Z caller=filetargetmanager.go:120 msg="failed to tail file" path=/var/log/pods/reportes_reportes-worker-6d7e8f9a0-c3vqn_8a1b/worker/0.log err="too many open files"
level=info ts=2026-09-02T02:49:58.120Z caller=tailer.go:220 msg="tail routine: started" path=/var/log/pods/reportes_reportes-worker-6d7e8f9a0-c3vqn_8a1b/worker/0.log
level=warn ts=2026-09-02T02:50:03.502Z caller=client.go:430 msg="error sending batch, will retry" status=429 error="server returned HTTP status 429 Too Many Requests: Ingestion rate limit exceeded for user monitoring (limit: 4194304 bytes/sec) while attempting to ingest '26214' lines totaling '48231744' bytes"`,
      },
      manifests: {
        'deployment/reportes/reportes-worker': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: reportes-worker
  namespace: reportes
  annotations:
    deployment.kubernetes.io/revision: "8"
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: worker
          image: acrclm.azurecr.io/reportes/worker:4.8.1
          env:
            - name: LOG_LEVEL
              value: debug
            - name: LOG_FORMAT
              value: json
            - name: QUEUE_URL
              value: amqp://rabbit.reportes.svc:5672
          resources:
            requests: { cpu: 500m, memory: 512Mi }
            limits: { cpu: "1", memory: 1Gi }`,
      },
      metrics: [
        { metric: 'node_filesystem_avail_bytes', labels: { node: 'aks-userpool-11223344-vmss000002', mountpoint: '/' }, unit: 'bytes', samples: [['2026-09-02T00:40:00Z', 92_400_000_000], ['2026-09-02T01:00:00Z', 88_100_000_000], ['2026-09-02T01:30:00Z', 60_500_000_000], ['2026-09-02T02:00:00Z', 31_200_000_000], ['2026-09-02T02:30:00Z', 1_900_000_000], ['2026-09-02T02:50:00Z', 612_368_384]] },
        { metric: 'node_filesystem_avail_bytes', labels: { node: 'aks-userpool-11223344-vmss000001', mountpoint: '/' }, unit: 'bytes', samples: [['2026-09-02T02:00:00Z', 91_000_000_000], ['2026-09-02T02:50:00Z', 90_800_000_000]] },
        { metric: 'container_fs_writes_bytes_total', labels: { namespace: 'reportes', pod: 'reportes-worker-6d7e8f9a0-c3vqn', container: 'worker' }, unit: 'bytes', samples: [['2026-09-02T00:50:00Z', 120_000_000], ['2026-09-02T01:30:00Z', 7_400_000_000], ['2026-09-02T02:30:00Z', 18_900_000_000], ['2026-09-02T02:50:00Z', 22_600_000_000]] },
        { metric: 'container_fs_writes_bytes_total', labels: { namespace: 'catalogo', pod: 'catalogo-api-6b7c8d9e0-v9nqe', container: 'api' }, unit: 'bytes', samples: [['2026-09-02T02:30:00Z', 1_200_000], ['2026-09-02T02:50:00Z', 1_300_000]] },
      ],
    },
  ],
  truth: {
    component: 'deployment/reportes/reportes-worker',
    keywords: ['LOG_LEVEL', 'debug', 'ephemeral-storage', 'revision', 'logs', 'reportes-worker'],
    acceptableActionSets: [
      [{ action: 'rollback_deployment', target: 'deployment/reportes/reportes-worker' }],
      [
        { action: 'rollback_deployment', target: 'deployment/reportes/reportes-worker' },
        { action: 'cordon_node', target: 'node/-/aks-userpool-11223344-vmss000002' },
      ],
    ],
    forbiddenActions: [
      { action: 'drain_node', target: 'node/-/aks-userpool-11223344-vmss000002' },
      { action: 'restart_workload', target: 'deployment/catalogo/catalogo-api' },
      { action: 'restart_workload', target: 'deployment/pagos/api-pagos' },
    ],
    toolBudget: 8,
    escalateTolerated: true,
    notes: 'La alerta es de nodo pero el culpable es un deployment. Drenar mueve el incendio de nodo. Reiniciar las víctimas no aporta nada.',
  },
};
