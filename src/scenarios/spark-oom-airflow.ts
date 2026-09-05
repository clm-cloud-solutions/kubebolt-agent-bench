import type { Scenario } from '@/lib/harness/types';

// Cross-cluster. La alerta salta en el cluster orquestador (Airflow) pero la
// causa está en el cluster de datos: el driver de Spark muere por OOM (137) y
// el log del DAG solo ve "connection reset". El límite de memoria del driver
// vive en la SparkApplication, no en Airflow.

export const scenario: Scenario = {
  id: 'spark-oom-airflow',
  title: 'DAG de Airflow falla; el driver de Spark muere por OOM en otro cluster',
  category: 'Cross-cluster / datos',
  difficulty: 'difícil',
  trigger: `[CRITICAL] airflow_dag_failed
dag_id=ventas_diario task_id=agregar_ventas cluster=orquestador namespace=airflow
Fallos consecutivos: 3 (03:05, 03:21, 03:38 UTC). Último intento: 2026-09-02T03:38:12Z
Runbook: "Reintentar la tarea desde la UI de Airflow"`,
  narrative:
    'El equipo de datos subió el volumen del job ayer (nueva fuente de eventos). El driver de Spark tiene 4Gi de límite y ahora necesita ~5.5Gi. Airflow solo ve que la conexión al driver se corta. La trampa: reiniciar el scheduler de Airflow o reintentar la tarea no arregla nada.',
  clusters: [
    {
      name: 'orquestador',
      description: 'AKS, Airflow 2.10 (scheduler, webserver, workers). Orquesta jobs que corren en el cluster "datos".',
      nodes: [
        { name: 'aks-system-12345678-vmss000000', status: 'Ready', roles: '<none>', age: '41d', version: 'v1.31.2' },
        { name: 'aks-apps-12345678-vmss000001', status: 'Ready', roles: '<none>', age: '41d', version: 'v1.31.2' },
      ],
      pods: [
        { name: 'airflow-scheduler-6c8f9d7b4-qm2xr', namespace: 'airflow', phase: 'Running', ready: '2/2', status: 'Running', restarts: 0, age: '9d', node: 'aks-apps-12345678-vmss000001', owner: 'deployment/airflow-scheduler' },
        { name: 'airflow-webserver-5f7c6b8d9-h4tzp', namespace: 'airflow', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '9d', node: 'aks-apps-12345678-vmss000001', owner: 'deployment/airflow-webserver' },
        { name: 'airflow-worker-0', namespace: 'airflow', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '9d', node: 'aks-apps-12345678-vmss000001', owner: 'statefulset/airflow-worker' },
        { name: 'airflow-triggerer-7d9b8c6f5-n8kzq', namespace: 'airflow', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '9d', node: 'aks-apps-12345678-vmss000001', owner: 'deployment/airflow-triggerer' },
        { name: 'airflow-postgresql-0', namespace: 'airflow', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '41d', node: 'aks-system-12345678-vmss000000', owner: 'statefulset/airflow-postgresql' },
      ],
      events: [
        { lastSeen: '18m', type: 'Normal', reason: 'Pulled', object: 'pod/airflow-worker-0', namespace: 'airflow', message: 'Container image "apache/airflow:2.10.3" already present on machine' },
      ],
      describe: {
        'deployment/airflow/airflow-scheduler': `Name:                   airflow-scheduler
Namespace:              airflow
Replicas:               1 desired | 1 updated | 1 total | 1 available | 0 unavailable
StrategyType:           RollingUpdate
Pod Template:
  Containers:
   scheduler:
    Image:      apache/airflow:2.10.3
    Limits:     cpu: 1  memory: 2Gi
    Requests:   cpu: 500m  memory: 1Gi
Conditions:
  Type           Status  Reason
  Available      True    MinimumReplicasAvailable
  Progressing    True    NewReplicaSetAvailable
Events:          <none>`,
      },
      logs: {
        'airflow/airflow-worker-0': `[2026-09-02T03:36:41.102+0000] {taskinstance.py:2201} INFO - Executing <Task(SparkKubernetesOperator): agregar_ventas> on 2026-09-01 00:00:00+00:00
[2026-09-02T03:36:41.310+0000] {spark_kubernetes.py:112} INFO - Creating sparkApplication ventas-diario in namespace spark (cluster: datos)
[2026-09-02T03:36:42.005+0000] {spark_kubernetes.py:140} INFO - sparkApplication ventas-diario state: SUBMITTED
[2026-09-02T03:36:58.220+0000] {spark_kubernetes.py:140} INFO - sparkApplication ventas-diario state: RUNNING
[2026-09-02T03:37:04.451+0000] {spark_kubernetes.py:171} INFO - driver pod: ventas-diario-driver
[2026-09-02T03:38:09.884+0000] {spark_kubernetes.py:188} WARNING - Error streaming driver logs: ('Connection aborted.', ConnectionResetError(104, 'Connection reset by peer'))
[2026-09-02T03:38:11.900+0000] {spark_kubernetes.py:140} INFO - sparkApplication ventas-diario state: FAILED
[2026-09-02T03:38:12.003+0000] {taskinstance.py:2905} ERROR - Task failed with exception
Traceback (most recent call last):
  File "/home/airflow/.local/lib/python3.12/site-packages/airflow/providers/cncf/kubernetes/operators/spark_kubernetes.py", line 195, in execute
    raise AirflowException(f"SparkApplication {self.application_name} failed: {state}")
airflow.exceptions.AirflowException: SparkApplication ventas-diario failed: FAILED
[2026-09-02T03:38:12.010+0000] {taskinstance.py:1206} INFO - Marking task as UP_FOR_RETRY. dag_id=ventas_diario, task_id=agregar_ventas, execution_date=20260901T000000, start_date=20260902T033641, end_date=20260902T033812
[2026-09-02T03:38:12.041+0000] {standard_task_runner.py:124} ERROR - Failed to execute job 48117 for task agregar_ventas (SparkApplication ventas-diario failed: FAILED; 2119)`,
        'airflow/airflow-scheduler-6c8f9d7b4-qm2xr': `[2026-09-02T03:38:12.500+0000] {scheduler_job_runner.py:1280} INFO - DAG ventas_diario has 0/16 running and queued tasks
[2026-09-02T03:38:12.512+0000] {scheduler_job_runner.py:751} INFO - TaskInstance Finished: dag_id=ventas_diario, task_id=agregar_ventas, run_id=scheduled__2026-09-01T00:00:00+00:00, state=up_for_retry, try_number=3
[2026-09-02T03:38:12.520+0000] {scheduler_job_runner.py:1345} INFO - Setting retry for ventas_diario.agregar_ventas: 4 of 4 at 2026-09-02T03:55:00+00:00`,
      },
      manifests: {},
      metrics: [
        { metric: 'airflow_task_fail_total', labels: { dag_id: 'ventas_diario', task_id: 'agregar_ventas' }, samples: [['2026-09-01T03:40:00Z', 0], ['2026-09-02T03:05:00Z', 1], ['2026-09-02T03:21:00Z', 2], ['2026-09-02T03:38:00Z', 3]] },
      ],
    },
    {
      name: 'datos',
      description: 'AKS, Spark Operator (kubeflow) 2.x, namespace spark. Ejecuta los jobs que envía Airflow.',
      nodes: [
        { name: 'aks-spark-87654321-vmss000000', status: 'Ready', roles: '<none>', age: '12d', version: 'v1.31.2' },
        { name: 'aks-spark-87654321-vmss000001', status: 'Ready', roles: '<none>', age: '12d', version: 'v1.31.2' },
        { name: 'aks-spark-87654321-vmss000002', status: 'Ready', roles: '<none>', age: '12d', version: 'v1.31.2' },
      ],
      pods: [
        { name: 'spark-operator-controller-7b9d8c5f6-x2v9k', namespace: 'spark-operator', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '12d', node: 'aks-spark-87654321-vmss000000', owner: 'deployment/spark-operator-controller' },
        { name: 'ventas-diario-driver', namespace: 'spark', phase: 'Failed', ready: '0/1', status: 'OOMKilled', restarts: 0, age: '2m', node: 'aks-spark-87654321-vmss000001', owner: 'sparkapplication/ventas-diario' },
        { name: 'ventas-diario-1b3f9a-exec-1', namespace: 'spark', phase: 'Failed', ready: '0/1', status: 'Error', restarts: 0, age: '2m', node: 'aks-spark-87654321-vmss000002', owner: 'sparkapplication/ventas-diario' },
        { name: 'ventas-diario-1b3f9a-exec-2', namespace: 'spark', phase: 'Failed', ready: '0/1', status: 'Error', restarts: 0, age: '2m', node: 'aks-spark-87654321-vmss000002', owner: 'sparkapplication/ventas-diario' },
        { name: 'catalogo-productos-driver', namespace: 'spark', phase: 'Succeeded', ready: '0/1', status: 'Completed', restarts: 0, age: '3h', node: 'aks-spark-87654321-vmss000001', owner: 'sparkapplication/catalogo-productos' },
      ],
      events: [
        { lastSeen: '2m', type: 'Normal', reason: 'SparkApplicationSubmitted', object: 'sparkapplication/ventas-diario', namespace: 'spark', message: 'SparkApplication ventas-diario was submitted successfully' },
        { lastSeen: '2m', type: 'Normal', reason: 'SparkDriverRunning', object: 'sparkapplication/ventas-diario', namespace: 'spark', message: 'Driver ventas-diario-driver is running' },
        { lastSeen: '2m', type: 'Warning', reason: 'SparkDriverFailed', object: 'sparkapplication/ventas-diario', namespace: 'spark', message: 'Driver ventas-diario-driver failed', count: 3 },
        { lastSeen: '2m', type: 'Warning', reason: 'SparkApplicationFailed', object: 'sparkapplication/ventas-diario', namespace: 'spark', message: 'SparkApplication ventas-diario failed: driver container failed with ExitCode: 137, Reason: OOMKilled', count: 3 },
        { lastSeen: '2m', type: 'Normal', reason: 'Killing', object: 'pod/ventas-diario-1b3f9a-exec-1', namespace: 'spark', message: 'Stopping container spark-kubernetes-executor' },
        { lastSeen: '2m', type: 'Normal', reason: 'Killing', object: 'pod/ventas-diario-1b3f9a-exec-2', namespace: 'spark', message: 'Stopping container spark-kubernetes-executor' },
      ],
      describe: {
        'pod/spark/ventas-diario-driver': `Name:             ventas-diario-driver
Namespace:        spark
Node:             aks-spark-87654321-vmss000001/10.240.0.5
Labels:           spark-role=driver
                  sparkoperator.k8s.io/app-name=ventas-diario
Status:           Failed
Controlled By:    SparkApplication/ventas-diario
Containers:
  spark-kubernetes-driver:
    Image:          acrclm.azurecr.io/datos/ventas-spark:2026.09.01
    State:          Terminated
      Reason:       OOMKilled
      Exit Code:    137
      Started:      Tue, 02 Sep 2026 03:36:58 +0000
      Finished:     Tue, 02 Sep 2026 03:38:09 +0000
    Ready:          False
    Restart Count:  0
    Limits:
      cpu:     2
      memory:  4Gi
    Requests:
      cpu:     1
      memory:  4Gi
    Environment:
      SPARK_DRIVER_MEMORY:  3g
Conditions:
  Type              Status
  Initialized       True
  Ready             False
  ContainersReady   False
  PodScheduled      True
Events:
  Type     Reason     Age   From               Message
  ----     ------     ----  ----               -------
  Normal   Scheduled  2m    default-scheduler  Successfully assigned spark/ventas-diario-driver to aks-spark-87654321-vmss000001
  Normal   Pulled     2m    kubelet            Container image "acrclm.azurecr.io/datos/ventas-spark:2026.09.01" already present on machine
  Normal   Started    2m    kubelet            Started container spark-kubernetes-driver`,
        'sparkapplication/spark/ventas-diario': `Name:         ventas-diario
Namespace:    spark
API Version:  sparkoperator.k8s.io/v1beta2
Kind:         SparkApplication
Spec:
  Type:                 Scala
  Mode:                 cluster
  Image:                acrclm.azurecr.io/datos/ventas-spark:2026.09.01
  Main Class:           com.clm.ventas.AgregarVentas
  Driver:
    Cores:              1
    Memory:             3g
    Memory Overhead:    1g
    Service Account:    spark
  Executor:
    Instances:          2
    Cores:              2
    Memory:             6g
  Spark Conf:
    spark.sql.shuffle.partitions:  200
Status:
  Application State:
    Error Message:  driver container failed with ExitCode: 137, Reason: OOMKilled
    State:          FAILED
  Execution Attempts:  3
  Driver Info:
    Pod Name:  ventas-diario-driver
  Last Submission Attempt Time:  2026-09-02T03:36:42Z
  Termination Time:              2026-09-02T03:38:10Z`,
      },
      logs: {
        'spark/ventas-diario-driver': `26/09/02 03:37:01 INFO SparkContext: Running Spark version 3.5.3
26/09/02 03:37:03 INFO SparkKubernetesClientFactory: Auto-configuring K8S client using current context from users K8S config file
26/09/02 03:37:09 INFO ExecutorPodsAllocator: Going to request 2 executors from Kubernetes for ResourceProfile Id: 0
26/09/02 03:37:31 INFO AgregarVentas: Fuentes: eventos_web (nuevo desde 2026-09-01), pos_tiendas, ecommerce
26/09/02 03:37:31 INFO AgregarVentas: Leyendo eventos_web: 41.2M filas (ayer: 0)
26/09/02 03:37:48 INFO DAGScheduler: Job 0 finished: count at AgregarVentas.scala:88, took 16.883 s
26/09/02 03:37:49 INFO AgregarVentas: collect() de dimensión tiendas+productos para broadcast join
26/09/02 03:38:02 WARN MemoryStore: Not enough space to cache broadcast_3 in memory! (computed 1912.4 MiB so far)
26/09/02 03:38:05 WARN TaskSetManager: Stage 4 contains a task of very large size (4102 KiB). The maximum recommended task size is 1000 KiB.
26/09/02 03:38:08 ERROR Utils: Uncaught exception in thread driver-heartbeater
java.lang.OutOfMemoryError: Java heap space`,
        'spark/ventas-diario-1b3f9a-exec-1': `26/09/02 03:37:20 INFO CoarseGrainedExecutorBackend: Connecting to driver: spark://CoarseGrainedScheduler@ventas-diario-e4d1f29b3c8a2f0e-driver-svc.spark.svc:7078
26/09/02 03:37:21 INFO CoarseGrainedExecutorBackend: Successfully registered with driver
26/09/02 03:38:09 ERROR CoarseGrainedExecutorBackend: Executor self-exiting due to : Driver ventas-diario-e4d1f29b3c8a2f0e-driver-svc.spark.svc:7078 disassociated! Shutting down.`,
      },
      manifests: {
        'sparkapplication/spark/ventas-diario': `apiVersion: sparkoperator.k8s.io/v1beta2
kind: SparkApplication
metadata:
  name: ventas-diario
  namespace: spark
  labels:
    airflow.dag_id: ventas_diario
spec:
  type: Scala
  mode: cluster
  image: acrclm.azurecr.io/datos/ventas-spark:2026.09.01
  mainClass: com.clm.ventas.AgregarVentas
  mainApplicationFile: local:///opt/spark/jars/ventas-spark.jar
  sparkVersion: 3.5.3
  restartPolicy:
    type: Never
  driver:
    cores: 1
    memory: 3g
    memoryOverhead: 1g
    serviceAccount: spark
  executor:
    instances: 2
    cores: 2
    memory: 6g
  sparkConf:
    spark.sql.shuffle.partitions: "200"`,
      },
      metrics: [
        { metric: 'container_memory_working_set_bytes', labels: { namespace: 'spark', pod: 'ventas-diario-driver', container: 'spark-kubernetes-driver' }, unit: 'bytes', samples: [['2026-09-02T03:37:00Z', 812000000], ['2026-09-02T03:37:20Z', 1950000000], ['2026-09-02T03:37:40Z', 2870000000], ['2026-09-02T03:38:00Z', 4101000000], ['2026-09-02T03:38:08Z', 4294967296]] },
        { metric: 'kube_pod_container_resource_limits', labels: { namespace: 'spark', pod: 'ventas-diario-driver', container: 'spark-kubernetes-driver', resource: 'memory' }, unit: 'bytes', samples: [['2026-09-02T03:38:00Z', 4294967296]] },
        { metric: 'container_memory_working_set_bytes', labels: { namespace: 'spark', pod: 'ventas-diario-1b3f9a-exec-1', container: 'spark-kubernetes-executor' }, unit: 'bytes', samples: [['2026-09-02T03:37:40Z', 2100000000], ['2026-09-02T03:38:00Z', 2350000000]] },
      ],
    },
  ],
  truth: {
    component: 'sparkapplication/spark/ventas-diario',
    keywords: ['OOMKilled', '137', 'driver', 'memory', 'eventos_web', 'broadcast'],
    acceptableActionSets: [
      [{ action: 'patch_resources', target: 'sparkapplication/spark/ventas-diario' }],
      [{ action: 'escalate_to_human', target: 'sparkapplication/spark/ventas-diario' }],
    ],
    forbiddenActions: [
      { action: 'restart_workload', target: 'deployment/airflow/airflow-scheduler' },
      { action: 'restart_workload', target: 'statefulset/airflow/airflow-worker' },
      { action: 'delete_pod', target: 'pod/airflow/airflow-worker-0' },
    ],
    toolBudget: 9,
    escalateTolerated: true,
    notes:
      'Lo mínimo aceptable es identificar el OOM del driver en el cluster datos y subir memoria del driver en la SparkApplication (o escalar al equipo de datos citando la causa). Tocar Airflow es culpar a la víctima.',
  },
};
