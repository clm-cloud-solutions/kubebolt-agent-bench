// Prueba sin LLM del servidor MCP: lo lanza por stdio con un escenario, lista las
// herramientas, llama a list_pods, get_logs con grep y submit_remediation, y
// comprueba que la traza en BENCH_TRACE recoge todo. Después importa la traza.
//
//   npm run mcp-selftest
//
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { findScenario } from '../src/scenarios';
import { buildExternalRun, type Trace } from '../src/lib/harness/external';

const s = findScenario('configmap-crashloop')!;
const tracePath = join(mkdtempSync(join(tmpdir(), 'bench-mcp-')), 'traza.json');
const client = new Client({ name: 'bench-selftest', version: '0.1.0' });
await client.connect(new StdioClientTransport({ command: 'npx', args: ['tsx', 'scripts/mcp-server.ts'], env: { ...process.env, BENCH_SCENARIO: s.id, BENCH_TRACE: tracePath } as Record<string, string> }));

let failures = 0;
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
const expected = ['describe', 'get_events', 'get_logs', 'get_manifest', 'list_nodes', 'list_pods', 'query_metrics', 'submit_remediation'];
if (JSON.stringify(names) !== JSON.stringify(expected)) { console.error('✗ herramientas expuestas:', names); failures++; }
const text = (r: any) => (r.content as { type: string; text: string }[]).map((c) => c.text).join('\n');
const pods = text(await client.callTool({ name: 'list_pods', arguments: { cluster: 'prod-es', namespace: 'pagos' } }));
if (!pods.includes('CrashLoopBackOff')) { console.error('✗ list_pods:', pods.slice(0, 80)); failures++; }
const logs = text(await client.callTool({ name: 'get_logs', arguments: { cluster: 'prod-es', namespace: 'pagos', pod: 'api-pagos-7d9f8c6b5-k2x8w', grep: 'fatal' } }));
if (!logs.includes('DATABASE_URL')) { console.error('✗ get_logs grep:', logs.slice(0, 80)); failures++; }
const rej = text(await client.callTool({ name: 'submit_remediation', arguments: { root_cause: { component: 'deployment/pagos/api-pagos', summary: 'x', evidence: ['x'] }, actions: [{ action: 'kubectl_delete_namespace', target: 'namespace/-/pagos' }], confidence: 0.5 } }));
if (!rej.startsWith('RECHAZADO')) { console.error('✗ catálogo no rechazó:', rej.slice(0, 80)); failures++; }
const ok = text(await client.callTool({ name: 'submit_remediation', arguments: { root_cause: { component: s.truth.component, summary: s.truth.keywords.join(' '), evidence: s.truth.keywords }, actions: s.truth.acceptableActionSets[0], confidence: 0.9 } }));
if (!ok.startsWith('Plan registrado')) { console.error('✗ entrega:', ok.slice(0, 80)); failures++; }
await client.close();

const trace = JSON.parse(readFileSync(tracePath, 'utf8')) as Trace;
if (trace.toolCalls.length !== 4 || trace.catalogViolations.length !== 1 || !trace.submission) { console.error('✗ traza incompleta:', { calls: trace.toolCalls.length, violaciones: trace.catalogViolations.length, entrega: !!trace.submission }); failures++; }
const run = buildExternalRun(s, trace, { modelId: 'test/x', label: 'x', batchId: 'test', latencyMs: 1000, usage: { input: 1000, output: 100 }, pricing: { input: 2, output: 10 } });
if (run.score.total !== 95 || run.costSource !== 'pricing' || run.stopReason !== 'submitted') { console.error('✗ buildExternalRun:', run.score, run.costSource, run.stopReason); failures++; }
console.log(failures ? `\n${failures} fallos` : `✓ servidor MCP: 8 herramientas, grep, catálogo, traza (${tracePath}) y run externo (score ${run.score.total}, seguridad ${run.score.safety}) OK`);
process.exit(failures ? 1 : 0);
