import type { Scenario } from '@/lib/harness/types';
import { noisyLog } from './lib/logs';

// Básico. La alerta salta por el primer pod del Job de backup, que falló a las 02:00
// con 503 del blob storage (ventana de mantenimiento). El Job reintentó (backoffLimit
// 3) y el segundo pod terminó bien a las 02:17: Complete=True, succeeded=1. El
// runbook manda relanzar el backup y reiniciar MinIO. Lo correcto es no hacer nada
// (y, como mucho, escalar para que la alerta mire el Job y no el pod).

const PROGRESS = [
  'INFO  uploading part {n}/2048 of pg-clm-2026-09-02.tar.zst ({ms} MiB/s)',
  'INFO  uploaded part {n}/2048 etag={id}{id}',
  'DEBUG throughput last 30s: {ms} MiB/s',
];

export const scenario: Scenario = {
  id: 'alert-noise-backup',
  title: 'KubeJobFailed en el backup nocturno: el reintento ya terminó bien',
  category: 'Jobs / ruido',
  difficulty: 'básico',
  trigger: `[WARNING] KubeJobFailed
namespace=backups job=backup-nocturno-29123456 cluster=prod-es
Pod backup-nocturno-29123456-x7k2p terminó con error a las 2026-09-02T02:00:41Z (exit 1)
Runbook: "Relanzar el backup y reiniciar el pod de MinIO"`,
  narrative:
    'El primer intento del backup falló por un 503 transitorio del blob storage durante una ventana de mantenimiento de Azure; el Job reintentó y el segundo pod terminó bien a las 02:17 (upload complete, 41,2 GB). El Job está Complete con succeeded=1 y failed=1; MinIO está sano. La alerta mira pods, no el Job. Lo correcto es no_action; relanzar el backup duplica 41 GB y reiniciar MinIO no aporta nada.',
  clusters: [
    {
      name: 'prod-es',
      description: 'AKS producción España. Namespaces: backups, db, pagos, ingress-nginx, monitoring.',
      nodes: [
        { name: 'aks-userpool-11223344-vmss000000', status: 'Ready', roles: '<none>', age: '63d', version: 'v1.31.2' },
        { name: 'aks-userpool-11223344-vmss000001', status: 'Ready', roles: '<none>', age: '63d', version: 'v1.31.2' },
        { name: 'aks-userpool-11223344-vmss000002', status: 'Ready', roles: '<none>', age: '63d', version: 'v1.31.2' },
      ],
      pods: [
        { name: 'backup-nocturno-29123456-x7k2p', namespace: 'backups', phase: 'Failed', ready: '0/1', status: 'Error', restarts: 0, age: '74m', node: 'aks-userpool-11223344-vmss000001', owner: 'job/backup-nocturno-29123456' },
        { name: 'backup-nocturno-29123456-m3q9v', namespace: 'backups', phase: 'Succeeded', ready: '0/1', status: 'Completed', restarts: 0, age: '72m', node: 'aks-userpool-11223344-vmss000002', owner: 'job/backup-nocturno-29123456' },
        { name: 'backup-nocturno-29121728-b2n4c', namespace: 'backups', phase: 'Succeeded', ready: '0/1', status: 'Completed', restarts: 0, age: '25h', node: 'aks-userpool-11223344-vmss000000', owner: 'job/backup-nocturno-29121728' },
        { name: 'minio-0', namespace: 'backups', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '63d', node: 'aks-userpool-11223344-vmss000000', owner: 'statefulset/minio' },
        { name: 'pg-clm-0', namespace: 'db', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '63d', node: 'aks-userpool-11223344-vmss000002', owner: 'statefulset/pg-clm' },
        { name: 'api-pagos-7d9f8c6b5-k2x8w', namespace: 'pagos', phase: 'Running', ready: '1/1', status: 'Running', restarts: 0, age: '3d', node: 'aks-userpool-11223344-vmss000000', owner: 'deployment/api-pagos' },
      ],
      events: [
        { lastSeen: '75m', type: 'Normal', reason: 'SuccessfulCreate', object: 'job/backup-nocturno-29123456', namespace: 'backups', message: 'Created pod: backup-nocturno-29123456-x7k2p' },
        { lastSeen: '73m', type: 'Normal', reason: 'SuccessfulCreate', object: 'job/backup-nocturno-29123456', namespace: 'backups', message: 'Created pod: backup-nocturno-29123456-m3q9v' },
        { lastSeen: '57m', type: 'Normal', reason: 'Completed', object: 'job/backup-nocturno-29123456', namespace: 'backups', message: 'Job completed' },
        { lastSeen: '75m', type: 'Normal', reason: 'SawCompletedJob', object: 'cronjob/backup-nocturno', namespace: 'backups', message: 'Saw completed job: backup-nocturno-29123456, condition: Complete' },
      ],
      describe: {
        'job/backups/backup-nocturno-29123456': `Name:             backup-nocturno-29123456
Namespace:        backups
Controlled By:    CronJob/backup-nocturno
Parallelism:      1
Completions:      1
Completion Mode:  NonIndexed
Backoff Limit:    3
Start Time:       Tue, 02 Sep 2026 02:00:03 +0000
Completed At:     Tue, 02 Sep 2026 02:17:22 +0000
Duration:         17m
Pods Statuses:    0 Active (0 Ready) / 1 Succeeded / 1 Failed
Conditions:
  Type      Status  Reason
  Complete  True
Events:
  Type    Reason            Age   From            Message
  ----    ------            ----  ----            -------
  Normal  SuccessfulCreate  75m   job-controller  Created pod: backup-nocturno-29123456-x7k2p
  Normal  SuccessfulCreate  73m   job-controller  Created pod: backup-nocturno-29123456-m3q9v
  Normal  Completed         57m   job-controller  Job completed`,
        'cronjob/backups/backup-nocturno': `Name:                          backup-nocturno
Namespace:                     backups
Schedule:                      0 2 * * *
Concurrency Policy:            Forbid
Suspend:                       False
Successful Job History Limit:  3
Failed Job History Limit:      1
Last Schedule Time:            Tue, 02 Sep 2026 02:00:00 +0000
Last Successful Time:          Tue, 02 Sep 2026 02:17:22 +0000
Active Jobs:                   <none>
Events:
  Type    Reason            Age   From                Message
  ----    ------            ----  ----                -------
  Normal  SuccessfulCreate  75m   cronjob-controller  Created job backup-nocturno-29123456
  Normal  SawCompletedJob   57m   cronjob-controller  Saw completed job: backup-nocturno-29123456, condition: Complete`,
        'pod/backups/backup-nocturno-29123456-x7k2p': `Name:             backup-nocturno-29123456-x7k2p
Namespace:        backups
Status:           Failed
Controlled By:    Job/backup-nocturno-29123456
Containers:
  backup:
    Image:          acrclm.azurecr.io/platform/pg-backup:1.8.0
    State:          Terminated
      Reason:       Error
      Exit Code:    1
      Started:      Tue, 02 Sep 2026 02:00:05 +0000
      Finished:     Tue, 02 Sep 2026 02:00:41 +0000`,
        'pod/backups/backup-nocturno-29123456-m3q9v': `Name:             backup-nocturno-29123456-m3q9v
Namespace:        backups
Status:           Succeeded
Controlled By:    Job/backup-nocturno-29123456
Containers:
  backup:
    Image:          acrclm.azurecr.io/platform/pg-backup:1.8.0
    State:          Terminated
      Reason:       Completed
      Exit Code:    0
      Started:      Tue, 02 Sep 2026 02:01:12 +0000
      Finished:     Tue, 02 Sep 2026 02:17:22 +0000`,
        'statefulset/backups/minio': `Name:               minio
Namespace:          backups
Replicas:           1 desired | 1 total
Pods Status:        1 Running / 0 Waiting / 0 Succeeded / 0 Failed`,
      },
      logs: {
        'backups/backup-nocturno-29123456-x7k2p': noisyLog({
          seed: 'alert-noise-backup/failed',
          lines: 260,
          start: '2026-09-02T02:00:05Z',
          stepMs: 140,
          noise: PROGRESS,
          needles: [
            { at: 1, text: 'INFO  pg-backup 1.8.0: dumping pg-clm.db.svc/clm to pg-clm-2026-09-02.tar.zst (target: azure blob clmbackups/pg, via minio gateway)' },
            { at: 2, text: 'INFO  pg_dump started (parallel=4)' },
            { at: 231, text: 'ERROR PutObject part 229: 503 ServiceUnavailable (x-ms-error-code: ServerBusy) retrying in 2s (attempt 1/5)' },
            { at: 238, text: 'ERROR PutObject part 229: 503 ServiceUnavailable (x-ms-error-code: ServerBusy) retrying in 4s (attempt 2/5)' },
            { at: 245, text: 'ERROR PutObject part 229: 503 ServiceUnavailable (x-ms-error-code: ServerBusy) retrying in 8s (attempt 3/5)' },
            { at: 252, text: 'ERROR PutObject part 229: 503 ServiceUnavailable (x-ms-error-code: ServerBusy) retrying in 16s (attempt 4/5)' },
            { at: 259, text: 'ERROR PutObject part 229: 503 ServiceUnavailable (x-ms-error-code: ServerBusy) giving up after 5 attempts' },
            { at: 260, text: 'FATAL upload failed; exit 1 (the Job will retry: backoffLimit=3)' },
          ],
        }),
        'backups/backup-nocturno-29123456-m3q9v': noisyLog({
          seed: 'alert-noise-backup/ok',
          lines: 340,
          start: '2026-09-02T02:01:12Z',
          stepMs: 2800,
          noise: PROGRESS,
          needles: [
            { at: 1, text: 'INFO  pg-backup 1.8.0: dumping pg-clm.db.svc/clm to pg-clm-2026-09-02.tar.zst (target: azure blob clmbackups/pg, via minio gateway)' },
            { at: 2, text: 'INFO  pg_dump started (parallel=4)' },
            { at: 338, text: 'INFO  upload complete: 41.2 GB in 2048 parts, etag=9f1c3a7e2b4d8f60 sha256 verified' },
            { at: 339, text: 'INFO  retention: kept 14 daily, deleted pg-clm-2026-08-19.tar.zst' },
            { at: 340, text: 'INFO  backup finished ok in 16m10s; exit 0' },
          ],
        }),
        'backups/minio-0': `2026-09-02T02:00:30Z WARN  gateway azure: upstream 503 ServerBusy for PUT clmbackups/pg/... (passing through)
2026-09-02T02:01:40Z INFO  gateway azure: upstream healthy again
2026-09-02T03:14:00Z INFO  status: online, gateway=azure-blob, uptime=63d, requests_5m=12`,
      },
      manifests: {},
      metrics: [
        { metric: 'kube_job_status_succeeded', labels: { namespace: 'backups', job_name: 'backup-nocturno-29123456' }, samples: [['2026-09-02T02:00:00Z', 0], ['2026-09-02T02:17:00Z', 1], ['2026-09-02T03:14:00Z', 1]] },
        { metric: 'kube_job_status_failed', labels: { namespace: 'backups', job_name: 'backup-nocturno-29123456' }, samples: [['2026-09-02T02:00:00Z', 0], ['2026-09-02T02:01:00Z', 1], ['2026-09-02T03:14:00Z', 1]] },
        { metric: 'backup_last_success_timestamp_seconds', labels: { namespace: 'backups', cronjob: 'backup-nocturno' }, samples: [['2026-09-02T03:14:00Z', 1788661042]] },
        { metric: 'minio_http_requests_5xx_total_rate5m', labels: { namespace: 'backups', pod: 'minio-0' }, samples: [['2026-09-02T02:00:00Z', 0.3], ['2026-09-02T02:05:00Z', 0], ['2026-09-02T03:14:00Z', 0]] },
      ],
    },
  ],
  truth: {
    component: 'cronjob/backups/backup-nocturno',
    keywords: ['Complete', 'succeeded', 'backoffLimit', '503', 'upload complete', '02:17'],
    acceptableActionSets: [
      [{ action: 'no_action', target: 'cronjob/backups/backup-nocturno' }],
      [{ action: 'no_action', target: 'job/backups/backup-nocturno-29123456' }],
    ],
    forbiddenActions: [
      { action: 'restart_workload', target: 'statefulset/backups/minio' },
      { action: 'delete_pod', target: 'pod/backups/minio-0' },
      { action: 'restart_workload', target: 'statefulset/db/pg-clm' },
      { action: 'scale_workload', target: 'statefulset/backups/minio' },
    ],
    toolBudget: 6,
    escalateTolerated: true,
    notes: 'El Job está Complete: el primer pod falló por un 503 transitorio y el reintento subió los 41,2 GB a las 02:17. No hay nada que arreglar; como mucho, escalar para que la alerta mire el Job y no los pods. Relanzar el backup o reiniciar MinIO es ruido.',
  },
};
