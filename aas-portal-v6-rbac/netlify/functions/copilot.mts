import type { Context, Config } from "@netlify/functions";
import fs from "node:fs";

/**
 * POST /api/copilot
 *
 * Deterministic (rule-based) Copilot implementation:
 * - loads playbooks from copilot-playbooks.json
 * - matches model by manufacturer + model
 * - matches symptom keywords or error codes
 */

function readPlaybooks() {
  const p = new URL("./copilot-playbooks.json", import.meta.url);
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

function clean(s: any): string {
  return (s ?? "").toString().trim();
}

function norm(s: string): string {
  return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normSearch(s: string): string {
  return clean(s).toLowerCase();
}

// Build a key like "horton-2150" or "besam-sl500"
function toKey(manufacturer: string, model: string): string {
  const mfg = norm(manufacturer);
  let mdl = norm(model);
  if (mfg && mdl.startsWith(mfg)) mdl = mdl.slice(mfg.length);
  return [mfg, mdl].filter(Boolean).join("-");
}

// Find matching playbook by trying different key combinations
function findPlaybook(playbooks: any, manufacturer: string, model: string): { key: string; playbook: any } | null {
  const pb = playbooks.playbooks || {};
  
  const key1 = toKey(manufacturer, model);
  if (pb[key1]) return { key: key1, playbook: pb[key1] };
  
  const key2 = norm(model);
  if (pb[key2]) return { key: key2, playbook: pb[key2] };
  
  const mfgNorm = norm(manufacturer);
  const mdlNorm = norm(model);
  
  for (const [k, v] of Object.entries(pb)) {
    const p = v as any;
    if (norm(p.manufacturer) === mfgNorm) {
      const pModel = norm(p.model);
      if (pModel === mdlNorm || mdlNorm.includes(pModel) || pModel.includes(mdlNorm)) {
        return { key: k, playbook: p };
      }
    }
  }
  
  for (const [k, v] of Object.entries(pb)) {
    const p = v as any;
    const pModel = norm(p.model);
    if (mdlNorm.includes(pModel) || pModel.includes(mdlNorm)) {
      return { key: k, playbook: p };
    }
  }
  
  return null;
}

// Find symptom by keyword matching
function findSymptom(symptomText: string, playbook: any): { key: string; symptom: any } | null {
  const symptoms = playbook.symptoms || {};
  const search = normSearch(symptomText);
  const searchWords = search.split(/\s+/).filter(w => w.length > 2);
  
  let bestMatch: { key: string; symptom: any; score: number } | null = null;
  
  for (const [key, sym] of Object.entries(symptoms)) {
    const s = sym as any;
    const title = normSearch(s.title || key);
    
    let score = 0;
    if (search.includes(title) || title.includes(search)) score += 10;
    for (const word of searchWords) {
      if (title.includes(word)) score += 3;
    }
    if (search.includes(key.replace(/-/g, " "))) score += 5;
    
    const steps = s.steps || [];
    for (const step of steps) {
      const stepNorm = normSearch(step);
      for (const word of searchWords) {
        if (stepNorm.includes(word)) score += 1;
      }
    }
    
    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { key, symptom: s, score };
    }
  }
  
  if (!bestMatch) {
    const entries = Object.entries(symptoms);
    if (entries.length > 0) {
      return { key: entries[0][0], symptom: entries[0][1] };
    }
  }
  
  return bestMatch;
}

// Find error code match
function findErrorCode(codeInput: string, playbook: any): any | null {
  const codes = playbook.errorCodes || {};
  const input = clean(codeInput).toUpperCase();
  
  if (codes[input]) return { code: input, ...codes[input] };
  
  const inputLower = input.toLowerCase();
  if (codes[inputLower]) return { code: inputLower, ...codes[inputLower] };
  
  for (const [code, info] of Object.entries(codes)) {
    if (code.toUpperCase().includes(input) || input.includes(code.toUpperCase())) {
      return { code, ...(info as any) };
    }
  }
  
  return null;
}

// Find test procedure
function findTestProcedure(query: string, playbook: any): any | null {
  const procedures = playbook.testProcedures || {};
  const search = normSearch(query);
  
  for (const [key, proc] of Object.entries(procedures)) {
    const p = proc as any;
    const title = normSearch(p.title || key);
    if (title.includes(search) || search.includes(title) || key.includes(search)) {
      return { key, ...p };
    }
  }
  
  return null;
}

export default async (req: Request, _context: Context) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405, headers: corsHeaders,
      });
    }

    const body = await req.json().catch(() => ({})) as any;
    const door_id = clean(body.door_id);
    const symptom = clean(body.symptom);
    const error_code = clean(body.error_code);
    const context = body.context || {};
    const manufacturer = clean(context.manufacturer);
    const model = clean(context.model);

    // Back-compat: accept older payloads that sent fields at the root (no context object)
    const manufacturer_root = clean(body.manufacturer);
    const model_root = clean(body.model);
    const door_type_root = clean(body.door_type || body.type);

    const manufacturer_final = manufacturer || manufacturer_root;
    const model_final = model || model_root;
    const door_type_final = clean(context.door_type || door_type_root);


    const playbooks = readPlaybooks();
    const match = findPlaybook(playbooks, manufacturer_final, model_final);
    
    if (!match) {
      const available = Object.keys(playbooks.playbooks || {}).join(", ");
      return new Response(
        JSON.stringify({
          copilot_session_id: `cp-${Date.now()}-${door_id}`,
          status: "no_playbook",
          message: `No playbook found for ${manufacturer} ${model}`,
          available_playbooks: available,
          suggestion: "Check manufacturer and model spelling, or this model may not have a playbook yet.",
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    const { key: playbookKey, playbook } = match;
    const sessionId = `cp-${Date.now()}-${door_id}`;

    const response: any = {
      copilot_session_id: sessionId,
      status: "ok",
      playbook_key: playbookKey,
      door: {
        door_id,
        manufacturer: playbook.manufacturer,
        model: playbook.model,
        type: playbook.type,
        customer: clean(context.customer),
      },
      next_actions: [],
      part_candidates: [],
      manual_links: (playbook.manuals || []).map((m: any) => ({
        name: m.name,
        drive_id: m.drive_id,
      })),
      error_info: null,
      test_procedure: null,
    };

    if (error_code) {
      const errorInfo = findErrorCode(error_code, playbook);
      if (errorInfo) {
        response.error_info = errorInfo;
        response.next_actions.push({
          type: "error_resolution",
          title: `Error ${errorInfo.code}: ${errorInfo.meaning}`,
          action: errorInfo.action,
          confidence: 0.9,
        });
      }
    }

    if (symptom) {
      const symMatch = findSymptom(symptom, playbook);
      if (symMatch) {
        const { key: symKey, symptom: sym } = symMatch;
        
        const steps = (sym.steps || []).map((step: string, idx: number) => ({
          step: idx + 1,
          text: step,
        }));

        response.next_actions.push({
          id: `chk-${playbookKey}-${symKey}`,
          type: "checklist",
          title: sym.title || symKey.replace(/-/g, " "),
          steps,
          confidence: 0.8,
          source: `playbook:${playbookKey}:${symKey}`,
        });

        const parts = sym.parts || [];
        response.part_candidates = parts.map((p: any, i: number) => ({
          rank: i + 1,
          name: p.name,
          confidence: p.confidence || 0.5,
        }));
      }
    }

    if (symptom || error_code) {
      const query = symptom || error_code;
      const proc = findTestProcedure(query, playbook);
      if (proc) {
        response.test_procedure = proc;
        response.next_actions.push({
          type: "test_procedure",
          title: proc.title,
          steps: proc.steps,
          confidence: 0.85,
        });
      }
    }

    if (playbook.wiring) {
      response.wiring = playbook.wiring;
    }

    response.available_symptoms = Object.entries(playbook.symptoms || {}).map(([k, v]: [string, any]) => ({
      key: k,
      title: v.title || k,
    }));

    response.available_error_codes = Object.keys(playbook.errorCodes || {});

    return new Response(JSON.stringify(response, null, 2), {
      status: 200, headers: corsHeaders,
    });

  } catch (e: any) {
    console.error("Copilot error:", e);
    return new Response(
      JSON.stringify({ error: e?.message || "Unknown error", stack: e?.stack }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config: Config = {
  path: "/api/copilot",
};
