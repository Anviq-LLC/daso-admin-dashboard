// Semicolon CSV with BOM so German Excel opens it correctly. Cells that could run as formulas are neutralised.
const cell = (v: string | number) => {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export const toCsv = (rows: (string | number)[][]) => '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
