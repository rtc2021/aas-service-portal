import type { Context, Config } from "@netlify/functions";
import { parseCsv, pick, clean, normSearch, env, fetchCsv } from "./_csv.mts";

/**
 * GET /api/search-index
 * 
 * Returns a ready-to-search index for Command Center v2.3+:
 * - doors, manuals, parts, service records
 * - includes manufacturer/model for cross-reference weighting
 * 
 * v3.0 Changes:
 * - Added manufacturer and model fields to items for weighting
 * - Added door_link field for cross-referencing
 * - Added stale-while-revalidate caching
 * - Links doors to /service?id= (primary workflow)
 */

// Fallback URLs (can be overridden via env vars)
const FALLBACK_DOORS_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTcpq972LhvEzo3MA_iJzFeF7vJ1a7qudjvd3ooqxrfho-SZ7p1kvP0943VXsCfHWywDknQ-BHzC2Og/pub?gid=0&single=true&output=csv";
const FALLBACK_MANUALS_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTU61rKQUtfzsyATsgMQIKIhFZP0p5u7xeHoxVUt32hY3gHWiNarTnPH9guNhRkci2ZWucvJTPUxCVY/pub?gid=0&single=true&output=csv";
const FALLBACK_PARTS_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLWrgcUPv3oD7tIiKCQnDYEnGvlwZ5rYiN-4BhOdZsEV52XvI6NCy7wSqmCgrN02pdKKfSc9w6Fwx7/pub?gid=0&single=true&output=csv";
const FALLBACK_SERVICE_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRaL-Cagmos7f4rCojgOROSm_Zs8Gnl41nvUUN8hXJIrDyGdv4eYhtJKq56lMRK9euN0TvFNOj_rszM/pub?gid=379834637&single=true&output=csv";

interface SearchItem {
  type: "door" | "manual" | "part" | "service";
  title: string;
  subtitle: string;
  url: string;
  search_text: string;
  // v3.0: Added for cross-reference weighting
  manufacturer?: string;
  model?: string;
  door_link?: string;
}

export default async (_req: Request, _context: Context) => {
  const headers = { 
    "content-type": "application/json",
    "cache-control": "public, max-age=300, stale-while-revalidate=600"
  };

  try {
    const doorsUrl = env("REGISTRY_CSV_URL", FALLBACK_DOORS_URL);
    const manualsUrl = env("MANUALS_CSV_URL", FALLBACK_MANUALS_URL);
    const partsUrl = env("PARTS_CSV_URL", FALLBACK_PARTS_URL);
    const serviceUrl = env("SERVICE_CSV_URL", FALLBACK_SERVICE_URL);

    const [doors, manuals, parts, service] = await Promise.all([
      fetchCsv(doorsUrl).catch(() => []),
      fetchCsv(manualsUrl).catch(() => []),
      fetchCsv(partsUrl).catch(() => []),
      fetchCsv(serviceUrl).catch(() => [])
    ]);

    const items: SearchItem[] = [];

    // Doors (from Registry) - use Name as primary ID
    doors.forEach(d => {
      const name = clean(d.Name || d["Door ID"]);
      if (!name) return;
      
      const manufacturer = clean(d.Manufacturer);
      const model = clean(d.Model);
      
      const subtitle = [
        clean(d.Customer), 
        clean(d.Address), 
        clean(d["Door location"])
      ].filter(Boolean).join(" • ");
      
      items.push({
        type: "door",
        title: name,
        subtitle,
        url: `/service?id=${encodeURIComponent(name)}`,
        search_text: normSearch([name, subtitle, manufacturer, model].join(" ")),
        manufacturer,
        model,
      });
    });

    // Manuals - include manufacturer/model for weighting
    manuals.forEach(m => {
      const url = clean(m.DriveLink || m["Drive Link"]);
      if (!url) return;
      
      const title = clean(m.Model_Final || m.FileName || m.Model || "Manual");
      const manufacturer = clean(m.Manufacturer);
      const manualType = clean(m.ManualType_Final || m.ManualType);
      
      const subtitle = [manufacturer, manualType].filter(Boolean).join(" • ");
      
      items.push({
        type: "manual",
        title,
        subtitle,
        url,
        search_text: normSearch([title, subtitle, clean(m.Tags)].join(" ")),
        manufacturer,
        model: clean(m.Model_Final || m.Model),
      });
    });

    // Parts - include manufacturer for filtering
    parts.forEach(p => {
      const key = clean(p["Addison #"] || p["MFG #"] || p.key);
      if (!key) return;
      
      const manufacturer = clean(p.Manufacturer);
      const description = clean(p.Description);
      
      const subtitle = [manufacturer, description].filter(Boolean).join(" • ");
      
      items.push({
        type: "part",
        title: key,
        subtitle,
        url: `/tech/parts?q=${encodeURIComponent(key)}`,
        search_text: normSearch([key, subtitle, clean(p["MFG #"])].join(" ")),
        manufacturer,
      });
    });

    // Service records
    service.forEach(s => {
      const title = clean(s["Door Name"] || s.Name || s["Door ID"]);
      if (!title) return;
      
      const subtitle = [
        clean(s.Customer), 
        clean(s.Date), 
        clean(s.Technician)
      ].filter(Boolean).join(" • ");
      
      items.push({
        type: "service",
        title,
        subtitle,
        url: `/service?id=${encodeURIComponent(title)}`,
        search_text: normSearch([title, subtitle, clean(s.Notes)].join(" ")),
        door_link: title,
      });
    });

    const counts = {
      doors: doors.length,
      manuals: manuals.length,
      parts: parts.length,
      service: service.length
    };

    return new Response(JSON.stringify({
      version: "3.0",
      generated_at: new Date().toISOString(),
      counts,
      total: items.length,
      items
    }), { status: 200, headers });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), { 
      status: 500, headers 
    });
  }
};

export const config: Config = {
  path: "/api/search-index"
};
