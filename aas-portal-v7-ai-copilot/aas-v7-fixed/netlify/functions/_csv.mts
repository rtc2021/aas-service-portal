/**
 * Shared CSV utilities for AAS Portal Functions
 */

export function parseCsv(text: string): { headers: string[]; rows: Record<string,string>[] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(cur); cur = ""; continue; }
    if (ch === '\r') { continue; }
    if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ""; continue; }
    cur += ch;
  }
  row.push(cur);
  rows.push(row);

  while (rows.length && rows[rows.length - 1].every(c => (c ?? "").trim() === "")) rows.pop();

  const headers = (rows.shift() || []).map(h => (h ?? "").trim());
  const outRows: Record<string,string>[] = rows.map(r => {
    const obj: Record<string,string> = {};
    headers.forEach((h, idx) => (obj[h] = (r[idx] ?? "").trim()));
    return obj;
  });
  return { headers, rows: outRows };
}

export function normDoorId(s: string): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, "");
}

export function pick(obj: Record<string,string>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v && v.trim() !== "") return v.trim();
  }
  return "";
}

export function clean(s: any): string {
  return (s ?? "").toString().trim();
}

export function normSearch(s: string): string {
  return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

export async function fetchCsv(url: string): Promise<Record<string,string>[]> {
  const res = await fetch(url, { headers: { accept: "text/csv" } });
  if (!res.ok) throw new Error(`CSV fetch failed (${res.status})`);
  return parseCsv(await res.text()).rows;
}
