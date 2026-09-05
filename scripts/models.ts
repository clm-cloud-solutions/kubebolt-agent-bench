// Lista los modelos disponibles en tu cuenta de Vercel AI Gateway, con precio
// y proveedores upstream, y comprueba cuáles de MODELS existen de verdad.
//
//   npm run models              # todos
//   npm run models -- deepseek  # filtra por subcadena
//
import 'dotenv/config';
import { gateway } from 'ai';
import { MODELS } from '../src/lib/harness/models';

const filter = process.argv[2]?.toLowerCase();
const res = await gateway.getAvailableModels();
const all = res.models as any[];

const list = all.filter((m) => !filter || m.id.toLowerCase().includes(filter) || (m.name ?? '').toLowerCase().includes(filter));
for (const m of list) {
  const p = m.pricing ? `in $${(Number(m.pricing.input) * 1e6).toFixed(2)}/M  out $${(Number(m.pricing.output) * 1e6).toFixed(2)}/M` : 'sin precio';
  const providers = (m.providers ?? m.specification?.providers ?? []).map((x: any) => (typeof x === 'string' ? x : x.id ?? x.name)).join(', ');
  console.log(`${m.id.padEnd(40)} ${(m.name ?? '').padEnd(28)} ${p}${providers ? `  [${providers}]` : ''}`);
}

console.log('\nComprobación de MODELS (src/lib/harness/models.ts):');
const ids = new Set(all.map((m) => m.id));
for (const m of MODELS) console.log(`  ${ids.has(m.id) ? '✓' : '✗ NO EXISTE'}  ${m.id}`);
