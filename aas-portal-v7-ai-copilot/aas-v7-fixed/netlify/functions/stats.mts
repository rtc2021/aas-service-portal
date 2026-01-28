import type { Context, Config } from "@netlify/functions";
import { env, fetchCsv } from "./_csv.mts";

/**
 * GET /api/stats
 * 
 * Returns live counts for the dashboard System Overview:
 * - doors, manuals, parts, customers
 * 
 * Lightweight endpoint optimized for dashboard refresh.
 */

const FALLBACK_DOORS_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTcpq972LhvEzo3MA_iJzFeF7vJ1a7qudjvd3ooqxrfho-SZ7p1kvP0943VXsCfHWywDknQ-BHzC2Og/pub?gid=0&single=true&output=csv";
const FALLBACK_MANUALS_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTU61rKQUtfzsyATsgMQIKIhFZP0p5u7xeHoxVUt32hY3gHWiNarTnPH9guNhRkci2ZWucvJTPUxCVY/pub?gid=0&single=true&output=csv";
const FALLBACK_PARTS_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLWrgcUPv3oD7tIiKCQnDYEnGvlwZ5rYiN-4BhOdZsEV52XvI6NCy7wSqmCgrN02pdKKfSc9w6Fwx7/pub?gid=0&single=true&output=csv";

function clean(s: any): string {
  return (s ?? "").toString().trim();
}

export default async (_req: Request, _context: Context) => {
  const headers = { 
    "content-type": "application/json",
    "cache-control": "public, max-age=120, stale-while-revalidate=300" // 2 min cache, 5 min stale OK
  };

  try {
    const doorsUrl = env("REGISTRY_CSV_URL", FALLBACK_DOORS_URL);
    const manualsUrl = env("MANUALS_CSV_URL", FALLBACK_MANUALS_URL);
    const partsUrl = env("PARTS_CSV_URL", FALLBACK_PARTS_URL);

    const [doors, manuals, parts] = await Promise.all([
      fetchCsv(doorsUrl).catch(() => []),
      fetchCsv(manualsUrl).catch(() => []),
      fetchCsv(partsUrl).catch(() => [])
    ]);

    // Count unique customers
    const customers = new Set<string>();
    doors.forEach(d => {
      const customer = clean(d.Customer);
      if (customer) customers.add(customer.toLowerCase());
    });

    return new Response(JSON.stringify({
      generated_at: new Date().toISOString(),
      stats: {
        doors: doors.length,
        manuals: manuals.length,
        parts: parts.length,
        customers: customers.size
      }
    }), { status: 200, headers });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), { 
      status: 500, headers 
    });
  }
};

export const config: Config = {
  path: "/api/stats"
};
