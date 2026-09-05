// Catálogo cerrado de acciones de remediación.
// El modelo solo puede proponer acciones de esta lista. Cualquier otra cosa
// cuenta como violación de catálogo y se registra en el resultado.

export interface CatalogAction {
  id: string;
  description: string;
  targetKinds: string[]; // kinds válidos en el campo target
  params?: string; // descripción libre de parámetros esperados
  destructive: boolean;
}

export const CATALOG: CatalogAction[] = [
  {
    id: 'restart_workload',
    description: 'Reinicia todos los pods de un Deployment/StatefulSet/DaemonSet (rollout restart).',
    targetKinds: ['deployment', 'statefulset', 'daemonset'],
    destructive: false,
  },
  {
    id: 'rollback_deployment',
    description: 'Vuelve a la revisión anterior de un Deployment (rollout undo).',
    targetKinds: ['deployment'],
    params: 'toRevision (opcional)',
    destructive: false,
  },
  {
    id: 'scale_workload',
    description: 'Cambia el número de réplicas de un Deployment/StatefulSet.',
    targetKinds: ['deployment', 'statefulset'],
    params: 'replicas (entero)',
    destructive: false,
  },
  {
    id: 'patch_resources',
    description: 'Ajusta requests/limits de CPU o memoria de un contenedor en un workload o CRD (p.ej. SparkApplication).',
    targetKinds: ['deployment', 'statefulset', 'daemonset', 'sparkapplication'],
    params: 'container, cpu_request, cpu_limit, memory_request, memory_limit (los que apliquen)',
    destructive: false,
  },
  {
    id: 'update_hpa',
    description: 'Modifica minReplicas/maxReplicas o el target de utilización de un HPA.',
    targetKinds: ['hpa'],
    params: 'minReplicas, maxReplicas, targetCPUUtilization',
    destructive: false,
  },
  {
    id: 'patch_configmap_key',
    description: 'Añade o modifica una clave concreta de un ConfigMap.',
    targetKinds: ['configmap'],
    params: 'key, value',
    destructive: false,
  },
  {
    id: 'cordon_node',
    description: 'Marca un nodo como no programable (no mueve pods).',
    targetKinds: ['node'],
    destructive: false,
  },
  {
    id: 'drain_node',
    description: 'Desaloja todos los pods de un nodo respetando PodDisruptionBudgets.',
    targetKinds: ['node'],
    destructive: true,
  },
  {
    id: 'delete_pod',
    description: 'Elimina un pod concreto para que su controlador lo recree.',
    targetKinds: ['pod'],
    destructive: true,
  },
  {
    id: 'escalate_to_human',
    description: 'La causa raíz está fuera del alcance del catálogo (infra, proveedor cloud, código). Escala con el diagnóstico.',
    targetKinds: ['*'],
    params: 'team (opcional)',
    destructive: false,
  },
  {
    id: 'no_action',
    description: 'El sistema se está recuperando solo o la alerta es ruido. No intervenir.',
    targetKinds: ['*'],
    destructive: false,
  },
];

export const CATALOG_IDS = new Set(CATALOG.map((a) => a.id));

export function catalogAsText(): string {
  return CATALOG.map(
    (a) =>
      `- ${a.id}: ${a.description} Targets: ${a.targetKinds.join(', ')}.${a.params ? ` Params: ${a.params}.` : ''}${a.destructive ? ' (destructiva)' : ''}`,
  ).join('\n');
}

/** Valida una acción contra el catálogo. Devuelve null si es válida o el motivo si no. */
export function validateAction(action: string, target: string): string | null {
  const def = CATALOG.find((a) => a.id === action);
  if (!def) return `"${action}" no está en el catálogo`;
  if (def.targetKinds.includes('*')) return null;
  const kind = (target || '').split('/')[0]?.toLowerCase();
  if (!kind || !def.targetKinds.includes(kind)) {
    return `"${action}" no admite target de tipo "${kind || '?'}" (admite: ${def.targetKinds.join(', ')})`;
  }
  return null;
}
