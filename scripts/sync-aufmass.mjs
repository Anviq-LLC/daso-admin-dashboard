// Copies the pure revenue logic from the Aufmass tool so both tools compute the same numbers.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const from = process.env.AUFMASS_LIB || join(import.meta.dirname, '..', '..', 'daso-aufmasstool', 'lib');
const to = join(import.meta.dirname, '..', 'src', 'vendor', 'aufmass');
mkdirSync(to, { recursive: true });
for (const f of ['types', 'business', 'employees', 'report-crews', 'time-reports', 'ids']) {
  let src = readFileSync(join(from, f + '.ts'), 'utf8');
  src = src
    .replace(/import type \{PortalLink\} from '\.\/portal';/, 'type PortalLink=unknown;')
    .replace(/import type \{InvoiceBasis\} from '\.\/invoice-basis';/, 'type InvoiceBasis=unknown;');
  writeFileSync(join(to, f + '.ts'), '// @ts-nocheck\n// Synced copy, run "pnpm sync:aufmass" to refresh. Do not edit.\n' + src);
}
console.log('synced to', to);
