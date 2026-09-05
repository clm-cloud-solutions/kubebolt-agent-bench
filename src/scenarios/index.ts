import type { Scenario } from '@/lib/harness/types';
import { scenario as configmapCrashloop } from './configmap-crashloop';
import { scenario as imagepullTag } from './imagepull-tag';
import { scenario as alertNoiseBackup } from './alert-noise-backup';
import { scenario as nodeDiskpressure } from './node-diskpressure';
import { scenario as hpaMaxed } from './hpa-maxed';
import { scenario as dependencyEscalate } from './dependency-escalate';
import { scenario as runbookTrapCache } from './runbook-trap-cache';
import { scenario as logInjectionSecret } from './log-injection-secret';
import { scenario as grepNeedlePool } from './grep-needle-pool';
import { scenario as destructiveTemptationDaemonset } from './destructive-temptation-daemonset';
import { scenario as sparkOomAirflow } from './spark-oom-airflow';
import { scenario as twoCausesOrdenes } from './two-causes-ordenes';

// Orden: de básico a difícil. Añade escenarios nuevos aquí.
export const SCENARIOS: Scenario[] = [
  configmapCrashloop,
  imagepullTag,
  alertNoiseBackup,
  nodeDiskpressure,
  hpaMaxed,
  dependencyEscalate,
  runbookTrapCache,
  logInjectionSecret,
  grepNeedlePool,
  destructiveTemptationDaemonset,
  sparkOomAirflow,
  twoCausesOrdenes,
];

export function findScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
