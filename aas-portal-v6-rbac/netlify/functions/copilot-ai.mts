import type { Context, Config } from "@netlify/functions";

// ============================================================================
// AAS AI COPILOT v3.0 - STRICT RAG (No Silent Fallbacks)
// Build: 2026-01-28T0730Z
// Architecture: Retrieve from Portal APIs → Reason with LLM → Answer with Citations
// ============================================================================

const BUILD_VERSION = "3.0.0-strict-2026-01-28";

const OLLAMA_BASE_URL = Netlify.env.get("OLLAMA_BASE_URL") || "https://ai.automaticaccesssolution.com";
const OLLAMA_MODEL = Netlify.env.get("OLLAMA_MODEL") || "llama3.1:8b";
const PORTAL_BASE_FALLBACK = Netlify.env.get("PORTAL_BASE_URL") || Netlify.env.get("URL") || "";

// ============================================================================
// TYPES - STRICT CONTRACT (LAYER 4)
// ============================================================================
interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface PageContext {
  page?: string;
  role?: string;
  door?: {
    door_id?: string;
    manufacturer?: string;
    model?: string;
    customer?: string;
    location?: string;
  };
  query?: string;
}

interface PortalResult {
  type: "manual" | "part" | "door" | "service";
  title: string;
  subtitle?: string;
  url: string;
  id?: string;
  score?: number;
}

interface RetrievalLog {
  tool: string;
  query: string;
  endpoint: string;
  count: number;
  timestamp: string;
}

// STRICT OUTPUT CONTRACT - UI must only handle this shape
interface CopilotResponse {
  mode: "portal" | "troubleshoot" | "error";
  summary: string;
  actions: Array<{ type: string; title?: string; text?: string; steps?: string[] }>;
  cards: Array<{ type: string; title: string; subtitle?: string; url: string }>;
  sources: Array<{ label: string; url?: string }>;
  warnings: string[];
  debug: {
    build: string;
    timestamp: string;
    retrieval: RetrievalLog[];
    ollama_used: boolean;
    ollama_error?: string;
  };
}

// ============================================================================
// PORTAL TOOL FUNCTIONS (LAYER 3 - Auditable Retrieval)
// ============================================================================

function getPortalBase(req: Request): string {
  try {
    const origin = new URL(req.url).origin;
    if (origin) return origin;
  } catch {}
  return PORTAL_BASE_FALLBACK || "";
}

async function portalSearch(
  req: Request,
  query: string,
  type?: string,
  limit: number = 10
): Promise<{ results: PortalResult[]; log: RetrievalLog }> {
  const base = getPortalBase(req);
  const qs = new URLSearchParams({ q: query, limit: String(limit) });
  if (type) qs.set("type", type);
  
  const endpoint = `${base}/api/search-index?${qs.toString()}`;
  const timestamp = new Date().toISOString();
  
  const log: RetrievalLog = {
    tool: type ? `${type}_search` : "portal_search",
    query,
    endpoint,
    count: 0,
    timestamp,
  };

  try {
    console.log(`[Tool:portalSearch] Calling: ${endpoint}`);
    
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.log(`[Tool:portalSearch] HTTP ${response.status}`);
      return { results: [], log };
    }

    const data = await response.json();
    console.log(`[Tool:portalSearch] Keys: ${Object.keys(data).join(", ")}`);
    
    // Handle both {results:[]} and {items:[]} formats
    const items = data.results || data.items || (Array.isArray(data) ? data : []);
    
    if (!Array.isArray(items)) {
      console.log(`[Tool:portalSearch] items is not an array`);
      return { results: [], log };
    }

    const results = items.slice(0, limit).map((r: any) => ({
      type: r.type || type || "door",
      title: r.title || r.name || r.Name || "Unknown",
      subtitle: r.subtitle || r.meta || r.description || "",
      url: r.url || r.link || "#",
      id: r.id || r.door_id || r.Name,
      score: r.score,
    }));

    log.count = results.length;
    console.log(`[Tool:portalSearch] Found ${results.length} items`);
    
    return { results, log };
  } catch (err) {
    console.error("[Tool:portalSearch] Error:", err);
    return { results: [], log };
  }
}

async function lookupDoor(
  req: Request,
  doorId: string
): Promise<{ result: PortalResult | null; log: RetrievalLog }> {
  const base = getPortalBase(req);
  const endpoint = `${base}/api/door?id=${encodeURIComponent(doorId)}`;
  const timestamp = new Date().toISOString();

  const log: RetrievalLog = {
    tool: "lookup_door",
    query: doorId,
    endpoint,
    count: 0,
    timestamp,
  };

  try {
    console.log(`[Tool:lookupDoor] Calling: ${endpoint}`);
    
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) return { result: null, log };

    const data = await response.json();
    if (!data || data.error) return { result: null, log };

    const result: PortalResult = {
      type: "door",
      title: data.Name || data.name || doorId,
      subtitle: [
        data.Customer || data.customer,
        data.Manufacturer || data.manufacturer,
        data.Model || data.model,
        data.Location || data["Door Location"],
      ].filter(Boolean).join(" • "),
      url: `/service?id=${encodeURIComponent(doorId)}`,
      id: doorId,
    };

    log.count = 1;
    return { result, log };
  } catch (err) {
    console.error("[Tool:lookupDoor] Error:", err);
    return { result: null, log };
  }
}

// ============================================================================
// INTENT DETECTION
// ============================================================================

interface Intent {
  tools: string[];
  query: string;
  doorId?: string;
  manufacturer?: string;
  model?: string;
}

function detectIntent(message: string, context: PageContext): Intent {
  const lower = message.toLowerCase();
  const intent: Intent = {
    tools: [],
    query: message,
    doorId: context.door?.door_id,
    manufacturer: context.door?.manufacturer,
    model: context.door?.model,
  };

  // Extract door ID patterns
  const doorIdMatch = message.match(/\b([A-Z]{1,3}[-\s]?\d+(?:[-./]\d+)?)\b/i);
  if (doorIdMatch) {
    intent.doorId = doorIdMatch[1].replace(/\s/g, "-");
  }

  // Extract manufacturer names
  const mfgPatterns = ["horton", "stanley", "besam", "nabco", "dorma", "record"];
  for (const mfg of mfgPatterns) {
    if (lower.includes(mfg)) {
      intent.manufacturer = mfg.charAt(0).toUpperCase() + mfg.slice(1);
      break;
    }
  }

  // Extract model patterns
  const modelMatch = message.match(/\b(C3150|C4190|MC521|SL500|SW200i|UniSlide|OPUS|U30|iQ)/i);
  if (modelMatch) intent.model = modelMatch[1];

  // Determine tools based on keywords
  if (lower.includes("manual") || lower.includes("programming") || lower.includes("learn cycle") ||
      lower.includes("parameter") || lower.includes("steps") || lower.includes("procedure")) {
    intent.tools.push("manuals");
  }

  if (lower.includes("part") || lower.includes("sensor") || lower.includes("motor") ||
      lower.includes("switch") || lower.includes("breakout") || lower.includes("replacement")) {
    intent.tools.push("parts");
  }

  if (lower.includes("door") || intent.doorId || lower.includes("customer") ||
      lower.includes("location") || lower.includes("ochsner") || lower.includes("hospital")) {
    intent.tools.push("doors");
  }

  if (lower.includes("service") || lower.includes("history") || lower.includes("last visit") ||
      lower.includes("work order") || lower.includes("recent")) {
    intent.tools.push("service");
  }

  if (lower.includes("error") || lower.includes("troubleshoot") || lower.includes("problem") ||
      lower.includes("issue") || lower.includes("not working") || lower.match(/\bE\d+\b/)) {
    if (!intent.tools.includes("manuals")) intent.tools.push("manuals");
  }

  // Page defaults
  if (intent.tools.length === 0) {
    switch (context.page) {
      case "manuals": intent.tools.push("manuals"); break;
      case "parts": intent.tools.push("parts"); break;
      case "doors": intent.tools.push("doors"); break;
      case "command": intent.tools.push("doors", "manuals", "parts"); break;
      default: intent.tools.push("doors");
    }
  }

  return intent;
}

// ============================================================================
// RETRIEVE DATA (LAYER 3 - All retrieval logged)
// ============================================================================

async function retrieveData(
  req: Request,
  intent: Intent
): Promise<{ results: PortalResult[]; logs: RetrievalLog[] }> {
  const allResults: PortalResult[] = [];
  const logs: RetrievalLog[] = [];

  // Look up specific door first
  if (intent.doorId && intent.tools.includes("doors")) {
    const { result, log } = await lookupDoor(req, intent.doorId);
    logs.push(log);
    if (result) {
      allResults.push(result);
      if (result.subtitle) {
        const parts = result.subtitle.split(" • ");
        if (!intent.manufacturer && parts[1]) intent.manufacturer = parts[1];
        if (!intent.model && parts[2]) intent.model = parts[2];
      }
    }
  }

  // Search manuals
  if (intent.tools.includes("manuals")) {
    let searchQuery = intent.query;
    if (intent.manufacturer) searchQuery += ` ${intent.manufacturer}`;
    const { results, log } = await portalSearch(req, searchQuery, "manual", 8);
    logs.push(log);
    allResults.push(...results);
  }

  // Search parts
  if (intent.tools.includes("parts")) {
    let searchQuery = intent.query;
    if (intent.manufacturer) searchQuery += ` ${intent.manufacturer}`;
    const { results, log } = await portalSearch(req, searchQuery, "part", 8);
    logs.push(log);
    allResults.push(...results);
  }

  // Search doors (general)
  if (intent.tools.includes("doors") && !intent.doorId) {
    const { results, log } = await portalSearch(req, intent.query, "door", 6);
    logs.push(log);
    allResults.push(...results);
  }

  // Search service
  if (intent.tools.includes("service")) {
    let searchQuery = intent.doorId ? `${intent.doorId} ${intent.query}` : intent.query;
    const { results, log } = await portalSearch(req, searchQuery, "service", 8);
    logs.push(log);
    allResults.push(...results);
  }

  return { results: allResults, logs };
}

// ============================================================================
// BUILD LLM PROMPT (Minimal, retrieval-focused)
// ============================================================================

function buildLLMPrompt(
  userMessage: string,
  role: string,
  results: PortalResult[]
): string {
  const modeStr = role === "Customer" ? "Customer (simplified)" : "Technician (full detail)";
  
  let prompt = `You are AAS Copilot. Answer using ONLY the portal data below.
Mode: ${modeStr}

RULES:
1. If no relevant data below, say "I couldn't find that in your portal"
2. Reference items by their title and URL
3. Be concise - technicians need quick answers
4. For procedures, use numbered steps

PORTAL DATA:
`;

  if (results.length === 0) {
    prompt += "(No data retrieved)\n";
  } else {
    results.slice(0, 15).forEach((r, i) => {
      prompt += `${i + 1}. [${r.type}] ${r.title}`;
      if (r.subtitle) prompt += ` — ${r.subtitle}`;
      prompt += `\n   URL: ${r.url}\n`;
    });
  }

  prompt += `\nUSER: ${userMessage}\n\nAnswer:`;
  return prompt;
}

// ============================================================================
// CALL OLLAMA (with strict timeout)
// ============================================================================

async function callOllama(prompt: string): Promise<string> {
  const response = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      options: { temperature: 0.7, num_predict: 400 },
    }),
    signal: AbortSignal.timeout(12000), // 12s hard limit
  });

  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || data.message?.content || "";
}

// ============================================================================
// BUILD RESPONSE (LAYER 4 - Strict contract)
// ============================================================================

function buildResponse(
  summary: string,
  results: PortalResult[],
  logs: RetrievalLog[],
  role: string,
  ollamaUsed: boolean,
  ollamaError?: string
): CopilotResponse {
  const cards = results.slice(0, 10).map((r) => ({
    type: r.type,
    title: r.title,
    subtitle: r.subtitle || "",
    url: r.url,
  }));

  const sources = logs
    .filter((l) => l.count > 0)
    .map((l) => ({
      label: `${l.tool} (${l.count} results)`,
      url: l.endpoint,
    }));

  const warnings: string[] = [];
  if (role !== "Customer") {
    warnings.push("Use proper lockout/tagout during testing.");
  }
  if (results.length === 0) {
    warnings.push("No portal data was retrieved for this query.");
  }

  return {
    mode: results.length > 0 ? "portal" : "error",
    summary,
    actions: [],
    cards,
    sources,
    warnings,
    debug: {
      build: BUILD_VERSION,
      timestamp: new Date().toISOString(),
      retrieval: logs,
      ollama_used: ollamaUsed,
      ollama_error: ollamaError,
    },
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export default async (req: Request, context: Context) => {
  // LAYER 1 - Debug marker
  console.log("COPILOT_AI_RAG_V3_ACTIVE", {
    ts: new Date().toISOString(),
    build: BUILD_VERSION,
    origin: req.headers.get("origin"),
    referer: req.headers.get("referer"),
  });

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  // GET = version check
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        status: "ok",
        build: BUILD_VERSION,
        model: OLLAMA_MODEL,
        features: ["portal_search", "lookup_door", "strict_contract", "no_fallback"],
      }),
      { status: 200, headers }
    );
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers,
    });
  }

  try {
    const body = await req.json();
    const messages: Message[] = body.messages || [];
    const pageContext: PageContext = body.page_context || {};

    const lastUserMsg = messages.filter((m) => m.role === "user").pop();
    if (!lastUserMsg?.content) {
      return new Response(JSON.stringify({ error: "No message" }), {
        status: 400,
        headers,
      });
    }

    const userMessage = String(lastUserMsg.content).trim();
    const role = pageContext.role || "Tech";

    // RBAC
    if (role === "Public") {
      return new Response(
        JSON.stringify({
          mode: "error",
          summary: "Sign in to use Copilot.",
          actions: [],
          cards: [],
          sources: [],
          warnings: [],
          debug: { build: BUILD_VERSION, timestamp: new Date().toISOString(), retrieval: [], ollama_used: false },
        }),
        { status: 401, headers }
      );
    }

    if (role === "Customer" && pageContext.page === "command") {
      return new Response(
        JSON.stringify({
          mode: "error",
          summary: "Command Center is for technicians only.",
          actions: [],
          cards: [],
          sources: [],
          warnings: [],
          debug: { build: BUILD_VERSION, timestamp: new Date().toISOString(), retrieval: [], ollama_used: false },
        }),
        { status: 403, headers }
      );
    }

    console.log(`[Copilot] Query: "${userMessage}" | Page: ${pageContext.page} | Role: ${role}`);

    // 1. Detect intent
    const intent = detectIntent(userMessage, pageContext);
    console.log(`[Copilot] Intent: ${intent.tools.join(", ")} | DoorID: ${intent.doorId}`);

    // 2. Retrieve from portal (LAYER 3 - all logged)
    const { results, logs } = await retrieveData(req, intent);
    console.log(`[Copilot] Retrieved: ${results.length} items from ${logs.length} tool calls`);

    // LAYER 2 - No silent fallback. If no data, say so clearly.
    if (results.length === 0) {
      const response = buildResponse(
        "I couldn't find that in your portal data. Try providing a door ID, manufacturer (Horton, Stanley, Besam, NABCO), or model number.",
        [],
        logs,
        role,
        false
      );
      return new Response(JSON.stringify(response), { status: 200, headers });
    }

    // 3. Build LLM prompt
    const prompt = buildLLMPrompt(userMessage, role, results);

    // 4. Call Ollama
    let summary: string;
    let ollamaUsed = false;
    let ollamaError: string | undefined;

    try {
      summary = await callOllama(prompt);
      ollamaUsed = true;
    } catch (err: any) {
      console.error("[Copilot] Ollama error:", err);
      ollamaError = err.message || String(err);
      // Fallback to simple summary with results
      summary = `Found ${results.length} results in your portal. See the cards below.`;
    }

    // 5. Build strict response
    const response = buildResponse(summary, results, logs, role, ollamaUsed, ollamaError);
    return new Response(JSON.stringify(response), { status: 200, headers });

  } catch (error: any) {
    console.error("[Copilot] Error:", error);
    return new Response(
      JSON.stringify({
        mode: "error",
        summary: "An error occurred.",
        actions: [],
        cards: [],
        sources: [],
        warnings: [error.message || "Unknown error"],
        debug: {
          build: BUILD_VERSION,
          timestamp: new Date().toISOString(),
          retrieval: [],
          ollama_used: false,
        },
      }),
      { status: 500, headers }
    );
  }
};

export const config: Config = {
  path: "/api/copilot-ai",
};
