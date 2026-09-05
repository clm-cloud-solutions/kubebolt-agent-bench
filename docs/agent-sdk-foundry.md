# Correr los modelos de Claude por otra vía: Claude Agent SDK (API de Anthropic o Microsoft Foundry)

El harness corre todos los modelos a través de Vercel AI Gateway con un bucle genérico
(`generateText` + tools). Para los modelos de Claude hay otras vías que sirven para dos cosas:
cobrar los runs a una clave de Anthropic (o a créditos de Azure) en vez de al presupuesto del
gateway, y medir a Claude en el mismo harness que usa KubeBolt Autopilot (el Claude Agent SDK),
que no es el bucle genérico.

Hay tres opciones; las dos primeras usan tu clave de Anthropic:

| Opción | Bucle | A quién se cobra | Cuándo usarla |
|---|---|---|---|
| A. Agent SDK + clave de Anthropic | Claude Agent SDK (el de Autopilot) | Tu cuenta de Anthropic | Medir a Claude en su propio harness |
| B. Gateway + BYOK | Genérico, el mismo que el resto de modelos | Tu cuenta de Anthropic, sin margen y sin contar en el presupuesto del gateway | Comparar a Claude con los demás en igualdad de condiciones |
| C. Agent SDK + Microsoft Foundry | Claude Agent SDK | Créditos de Azure | Solo si Foundry acepta tus créditos |

## Opción A: Agent SDK con la clave de Anthropic

1. Pon la clave en `.env` (está en `.gitignore`):

   ```bash
   ANTHROPIC_API_KEY=sk-ant-...
   ```

2. Lanza un run con el id del modelo tal como lo llama la API de Anthropic:

   ```bash
   npm run agent-sdk-run -- --model claude-sonnet-5 --scenario hpa-maxed --batch ext-01
   ```

   Ids actuales: `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`, `claude-fable-5-1`.
   El Agent SDK calcula el coste de cada run con su tabla de precios (`total_cost_usd`), así que
   no hace falta pasar `--cost-in`/`--cost-out`.

3. Para un lote completo, el bucle de la sección "Un lote completo" con `ext-01` como lote.

## Opción B: BYOK en Vercel AI Gateway

En el panel de Vercel, AI Gateway, sección "Bring Your Own Key", añade tu clave de Anthropic y
pulsa "Test Key". A partir de ahí, cualquier run de `npm run bench` con modelos `anthropic/*`
usa tu clave: el gateway no cobra margen y ese gasto no cuenta contra el presupuesto de la clave
del gateway. Todo lo demás (bucle, scoring, juez, UI) queda igual, y los runs se comparan con
los del resto de modelos sin ninguna diferencia de harness. Dos avisos: BYOK requiere el plan de
pago del gateway, y si tu clave falla en una petición el gateway reintenta con sus credenciales
y ese uso sí se cobra a los créditos.

## Opción C: Agent SDK con Microsoft Foundry

Los resultados se guardan como runs normales en `results/` y se ven en la UI y en los
informes junto al resto. El score determinista es el mismo; el juez se puede pasar después
con `npm run judge -- --batch <id>`.

## Cómo encaja (opciones A y C)

```
Claude Agent SDK (query)  ──stdio/MCP──▶  scripts/mcp-server.ts  ──▶  kubectl falso del escenario
        │                                        │
        │ usage, coste, duración                 │ traza de llamadas + entrega (BENCH_TRACE)
        ▼                                        ▼
scripts/agent-sdk-run.ts  ──────────────────────▶  score() ──▶ results/<run>.json (+ results/batches/<id>.json)
```

- `scripts/mcp-server.ts` expone las siete herramientas de investigación y `submit_remediation`
  como servidor MCP por stdio, para un escenario (`BENCH_SCENARIO`). Registra cada llamada y la
  entrega en un fichero JSON (`BENCH_TRACE`). Es el mismo código que usa el bucle genérico, así
  que el catálogo, el grep de logs y el recorte de logs largos son idénticos.
- `scripts/agent-sdk-run.ts` lanza un run con el Agent SDK: mismo system prompt y mismo prompt
  inicial que `runner.ts`, herramientas integradas de Claude Code desactivadas (nada de Bash,
  Read, Write...), solo las del servidor MCP. Al terminar lee la traza, puntúa y guarda el run.
- `scripts/import-run.ts` convierte una traza producida por cualquier otro agente (por ejemplo,
  Autopilot conectado al mismo servidor MCP) en un run puntuado.

### Requisitos en Azure

1. En el portal de Microsoft Foundry (https://ai.azure.com), un recurso de Claude y un
   despliegue por modelo. Anota el nombre del recurso y el nombre de cada despliegue.
2. Fija la versión del modelo en cada despliegue (no "auto-update"): el Agent SDK no comprueba el
   modelo al arrancar y una versión no disponible falla en la primera petición.
3. Credenciales: clave de API del recurso (sección "Endpoints and keys"), o `az login` para usar
   la cadena de credenciales de Entra ID.

### Variables de entorno de Foundry

El Agent SDK lanza el binario de Claude Code y hereda su configuración de Foundry (si no hay
ninguna variable de Foundry, usa `ANTHROPIC_API_KEY`):

```bash
export CLAUDE_CODE_USE_FOUNDRY=1
export ANTHROPIC_FOUNDRY_RESOURCE=<nombre-del-recurso>       # o ANTHROPIC_FOUNDRY_BASE_URL=https://<recurso>.services.ai.azure.com/anthropic
export ANTHROPIC_FOUNDRY_API_KEY=<clave>                     # o nada, y se usa az login (Entra ID)

# Los alias resuelven a despliegues; fija los tuyos:
export ANTHROPIC_DEFAULT_OPUS_MODEL=<despliegue-opus>        # p.ej. claude-opus-5
export ANTHROPIC_DEFAULT_SONNET_MODEL=<despliegue-sonnet>    # p.ej. claude-sonnet-5
export ANTHROPIC_DEFAULT_HAIKU_MODEL=<despliegue-haiku>      # p.ej. claude-haiku-4-5
```

Ponlas en `.env` (el script las carga con dotenv) o expórtalas en la shell. `.env` está en
`.gitignore`.

## Un run (opciones A y C)

```bash
npm run agent-sdk-run -- --model claude-sonnet-5 --scenario configmap-crashloop --batch ext-01
```

- `--model` es el id del modelo en la API de Anthropic (opción A) o el nombre del despliegue en
  Foundry (opción C; también valen los alias `opus`/`sonnet`/`haiku` si has fijado las
  variables `ANTHROPIC_DEFAULT_*`).
- `--label` (opcional) es el nombre que verás en la UI; por defecto `<modelo> (Agent SDK · Foundry)`.
- `--batch` agrupa runs en un lote; se crea `results/batches/<id>.json` si no existe.
- `--cost-in` / `--cost-out` (USD por millón de tokens) sirven para estimar el coste cuando el SDK
  no lo reporta; en Foundry se factura a precio de lista de Anthropic.
- `--max-turns` (default `BENCH_MAX_STEPS`, 25).
- `--first-turns N` (solo para probar el recordatorio) corta la primera fase a N turnos aunque queden
  pasos, de modo que el adaptador reanude la sesión con el aviso final.

El adaptador aplica las mismas reglas que el bucle genérico: si el modelo cierra el turno sin llamar
a `submit_remediation` y quedan turnos, reanuda la sesión (`resume`) con el mismo recordatorio una
sola vez y marca el run con `nudged: true`; `BENCH_NUDGE=0` lo desactiva. Agotar `--max-turns` se
registra como `max_steps` y se puntúa lo que haya, no como error. Cada fase es un proceso del SDK
que reporta solo lo suyo, así que tokens, coste, turnos y latencia se suman.

El SDK corre aislado: `settingSources: []` y `strictMcpConfig: true`, de modo que no carga el
CLAUDE.md del repo, ni plugins, ni conectores de claude.ai, ni ningún servidor MCP salvo `bench`.
Sin ese aislamiento el modelo vería la documentación del propio benchmark y decenas de herramientas
ajenas que inflan el contexto de cada turno (en una prueba, 258k tokens y $0.16 en dos turnos frente
a $0.07 con siete llamadas y entrega). La línea `sesión … · servidores MCP: bench · herramientas: 8`
que imprime el script confirma el aislamiento en cada run.

Sale en consola lo mismo que en `npm run bench`: score determinista, llamadas, latencia, coste.

## Un lote completo

```bash
for s in $(npx tsx -e "import('./src/scenarios/index.ts').then(m => console.log(m.SCENARIOS.map(s => s.id).join(' ')))"); do
  for m in claude-sonnet-5 claude-opus-5; do
    npm run agent-sdk-run -- --model $m --scenario $s --batch ext-01
  done
done
npm run judge -- --judge openai/gpt-5.6-sol --batch ext-01   # juez externo, opcional
```

Los runs del lote aparecen en `http://localhost:4321/lotes/ext-01`, en `/resultados` y en
`/duelo?batch=ext-01`, y los scripts de evaluación los tratan como cualquier otro.

## Importar una traza de otro agente

Si conectas otro agente (Autopilot, un script propio) al mismo servidor MCP:

```bash
BENCH_SCENARIO=hpa-maxed BENCH_TRACE=/tmp/traza.json npm run mcp-server   # lo lanza tu agente por stdio
npm run import-run -- --trace /tmp/traza.json --scenario hpa-maxed --model autopilot/claude-sonnet-5 --label "Autopilot (Sonnet 5)" --batch ext-autopilot-01 --latency-ms 42000 --input-tokens 31000 --output-tokens 2900
```

La traza es un JSON con `toolCalls`, `catalogViolations` y `submission`, exactamente lo que guarda
`mcp-server.ts`. Latencia, tokens y coste van por parámetros porque el servidor no los conoce.

## Diferencias que conviene tener presentes

- El Agent SDK trae su propio bucle y su gestión de contexto, y por defecto activa el
  razonamiento (thinking) del modelo; por el gateway Claude corre sin él, mientras que otros
  modelos razonan por defecto. Un modelo que en el bucle genérico cierra el turno sin entregar
  puede comportarse distinto aquí. Esa diferencia es una de las cosas
  que se quieren medir; el recordatorio final sí es el mismo en las dos vías.
- El SDK calcula el coste con su tabla de precios interna; con la clave de Anthropic sale bien,
  en Foundry puede salir 0. Pasa `--cost-in`/`--cost-out` para registrar una estimación con
  `costSource: pricing`.
- Los ids de modelo de estos runs llevan el sufijo `@agent-sdk` para que no se mezclen con los
  del gateway en las medias por modelo. Compara "Sonnet 5 (gateway)" con "Sonnet 5 (Agent SDK)"
  como dos filas distintas: es lo que son.
- Funciones no disponibles en Foundry según la tabla de disponibilidad de Anthropic: mensajes de
  sistema a mitad de conversación, fast mode, task budgets. Nada de eso lo usa el harness.
