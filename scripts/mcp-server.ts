// Servidor MCP (stdio) con el kubectl falso de un escenario: las mismas herramientas
// y el mismo catálogo que usa el bucle genérico, para agentes externos (Claude Agent
// SDK, Autopilot...). Registra cada llamada y la entrega en BENCH_TRACE (JSON) para
// que scripts/agent-sdk-run.ts o scripts/import-run.ts las puntúen.
//
//   BENCH_SCENARIO=hpa-maxed BENCH_TRACE=/tmp/traza.json npm run mcp-server
//
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { findScenario } from '../src/scenarios';
import { buildTools, type RunState } from '../src/lib/harness/fakeKubectl';
import { emptyTrace, type Trace } from '../src/lib/harness/external';

const scenarioId = process.env.BENCH_SCENARIO ?? '';
const tracePath = process.env.BENCH_TRACE ?? '';
const scenario = findScenario(scenarioId);
if (!scenario) {
  console.error(`BENCH_SCENARIO inválido: "${scenarioId}"`);
  process.exit(1);
}

// Si el agente reanuda la sesión (recordatorio final), el servidor se relanza: continúa la traza anterior.
const previous = tracePath && existsSync(tracePath) ? (JSON.parse(readFileSync(tracePath, 'utf8')) as Trace) : undefined;
const trace: Trace = previous?.scenarioId === scenario.id ? previous : emptyTrace(scenario.id);
const flush = () => { if (tracePath) writeFileSync(tracePath, JSON.stringify(trace, null, 2)); };
const state: RunState = {
  step: trace.toolCalls.length,
  toolCalls: trace.toolCalls,
  catalogViolations: trace.catalogViolations,
  emit: (e) => {
    if (e.type === 'tool_result') trace.previews.push({ step: e.step, name: e.name, preview: e.preview });
    if (e.type === 'submission') trace.submission = e.submission;
    flush();
  },
};
const tools = buildTools(scenario, state) as Record<string, { description?: string; inputSchema: unknown; execute: (input: unknown, ctx: unknown) => Promise<string> | string }>;

const server = new McpServer({ name: 'kubebolt-agent-bench', version: '0.1.0' });
for (const [name, t] of Object.entries(tools)) {
  server.registerTool(
    name,
    { description: t.description, inputSchema: t.inputSchema as never },
    (async (args: Record<string, unknown>) => {
      state.step += 1;
      const text = await t.execute(args, { toolCallId: `mcp-${state.step}`, messages: [] });
      flush();
      return { content: [{ type: 'text' as const, text }] };
    }) as never,
  );
}
flush();
await server.connect(new StdioServerTransport());
