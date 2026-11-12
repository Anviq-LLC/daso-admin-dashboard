// /api/query accepts one SELECT over the curated views only. Real tables, comments, pragmas and
// multiple statements are refused before anything reaches the database.
export const VIEWS = ['v_revenue_day', 'v_sub_day', 'v_project_day'] as const;
const BLOCKED = new Set(['pragma', 'attach', 'detach', 'load_extension', 'readfile', 'writefile', 'sqlite_master', 'sqlite_schema', 'sqlite_temp_master', 'insert', 'update', 'delete', 'drop', 'create', 'alter', 'replace', 'vacuum', 'reindex', 'with']);

export function guardQuery(sql: unknown, tables: ReadonlySet<string>): string {
  if (typeof sql !== 'string' || !sql.trim() || sql.length > 2000) throw new Error('Ungültige Abfrage.');
  const q = sql.trim().replace(/;\s*$/, '');
  if (q.includes(';')) throw new Error('Nur ein Statement erlaubt.');
  if (/--|\/\*/.test(q)) throw new Error('Kommentare sind nicht erlaubt.');
  if (!/^select\s/i.test(q)) throw new Error('Nur SELECT ist erlaubt.');
  const words = q.toLowerCase().match(/[a-z_][a-z0-9_]*/g) || [];
  for (const w of words) {
    if (BLOCKED.has(w) || w.startsWith('pragma_') || tables.has(w)) throw new Error(`Nicht erlaubt: ${w}`);
  }
  if (!words.some((w) => (VIEWS as readonly string[]).includes(w))) throw new Error(`Abfrage muss eine dieser Ansichten nutzen: ${VIEWS.join(', ')}`);
  return `SELECT * FROM (${q}) LIMIT 1000`;
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
