import type { Context, Config } from "@netlify/functions";
import { verifyToken, getRoles, hasRole, AuthError } from "../../utils/server-auth.mjs";
import fs from "node:fs";

/**
 * POST /api/copilot-ai
 * 
 * LLM-Powered Copilot using Ollama
 * - Connects to local/remote Ollama server
 * - Uses RAG with diagnostic playbooks, manuals, parts
 * - Requires Admin or Tech role
 */

const ALLOWED_ROLES = ['Admin', 'Tech'];

// Ollama server configuration - set via environment variables
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

// Load the diagnostic playbook for context
function loadPlaybook(): string {
  try {
    const p = new URL("./copilot-playbooks.json", import.meta.url);
    const raw = fs.readFileSync(p, "utf8");
    const data = JSON.parse(raw);
    // Convert to a condensed format for context
    return JSON.stringify(data, null, 0);
  } catch (e) {
    console.error("[Copilot-AI] Failed to load playbook:", e);
    return "{}";
  }
}

// System prompt that defines the AI's role and available knowledge
function buildSystemPrompt(playbookContext: string): string {
  return `You are the AAS (Automatic Access Solutions) Field Technician Copilot - an expert AI assistant for automatic door service technicians.

## Your Expertise
- Automatic sliding doors (NABCO OPUS, Dorma ESA II, Besam UniSlide, Stanley Dura-Glide Model J, Record 8000)
- Automatic swing doors (Dorma ED100/ED250, Stanley MC521, Horton C4190)
- Fire-rated door systems and AAADM compliance
- Error code diagnosis, learn cycles, sensor calibration
- Parts identification and replacement procedures

## Your Knowledge Base
You have access to the AAS diagnostic decision tree with troubleshooting playbooks for each operator model:

<playbook_data>
${playbookContext}
</playbook_data>

## How to Respond
1. **Safety First**: Always mention safety precautions (lock out power, secure door panels)
2. **Be Specific**: Reference exact error codes, parameter settings, and step numbers
3. **Ask Clarifying Questions**: If the symptom is vague, ask what LEDs are showing or what sounds the door makes
4. **Suggest Parts**: When appropriate, suggest likely replacement parts
5. **Reference Manuals**: Point to specific manual sections when available
6. **Keep it Practical**: You're talking to field techs who need actionable steps, not theory

## Response Format
- Use numbered steps for procedures
- Bold important warnings with **CAUTION** or **WARNING**
- Keep responses focused and actionable
- If you don't know something specific, say so and suggest checking the manual

## Available Tools (via function calls)
When the user asks about specific doors, parts, or needs to look something up, you can use these tools:
- lookup_door: Get door details by ID (AAS-XXX or FD-XXX format)
- search_parts: Search the parts catalog
- search_manual: Search tech manual content

You are helpful, knowledgeable, and safety-conscious. Help techs solve problems efficiently.`;
}

// Tool definitions for function calling
const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "lookup_door",
      description: "Look up door information by door ID. Returns customer, location, manufacturer, model, and service history.",
      parameters: {
        type: "object",
        properties: {
          door_id: {
            type: "string",
            description: "The door ID in format AAS-XXX or FD-XXX"
          }
        },
        required: ["door_id"]
      }
    }
  },
  {
    type: "function", 
    function: {
      name: "search_parts",
      description: "Search the parts catalog by part name, number, or description",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for parts (e.g., 'motor belt', 'sensor', 'ED100 gear')"
          },
          manufacturer: {
            type: "string",
            description: "Optional: Filter by manufacturer (Horton, Stanley, Besam, etc.)"
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_manual",
      description: "Search tech manual content for specific procedures or information",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What to search for in manuals (e.g., 'MC521 learn cycle', 'ESA II error E4')"
          }
        },
        required: ["query"]
      }
    }
  }
];

// Execute tool calls (these would call your actual APIs/databases)
async function executeTool(name: string, args: Record<string, any>, baseUrl: string): Promise<string> {
  try {
    switch (name) {
      case "lookup_door": {
        // Call your existing door API
        const response = await fetch(`${baseUrl}/api/door?doorid=${encodeURIComponent(args.door_id)}`);
        if (!response.ok) return `Door ${args.door_id} not found`;
        const data = await response.json();
        return JSON.stringify(data.compat || data, null, 2);
      }
      
      case "search_parts": {
        // TODO: Implement parts search - for now return placeholder
        return JSON.stringify({
          query: args.query,
          results: [
            { note: "Parts search not yet connected. Check Parts Finder at /tech/parts" }
          ]
        });
      }
      
      case "search_manual": {
        // TODO: Implement manual search - for now return placeholder
        return JSON.stringify({
          query: args.query,
          results: [
            { note: "Manual search not yet connected. Check Tech Manuals at /tech/manuals" }
          ]
        });
      }
      
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (e: any) {
    return `Tool error: ${e.message}`;
  }
}

// Call Ollama API
async function callOllama(
  messages: Array<{role: string, content: string}>,
  systemPrompt: string
): Promise<{content: string, tool_calls?: any[]}> {
  
  const fullMessages = [
    { role: "system", content: systemPrompt },
    ...messages
  ];

  const response = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: fullMessages,
      tools: TOOL_DEFINITIONS,
      temperature: 0.7,
      max_tokens: 2000,
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ollama error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  
  return {
    content: choice?.message?.content || '',
    tool_calls: choice?.message?.tool_calls
  };
}

export default async (req: Request, context: Context) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Auth check
  try {
    const payload = await verifyToken(req);
    const roles = getRoles(payload);
    
    if (!hasRole(payload, ALLOWED_ROLES)) {
      return new Response(
        JSON.stringify({ error: "Forbidden", message: "Copilot AI requires Admin or Tech role" }),
        { status: 403, headers: corsHeaders }
      );
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", message: error.message }),
        { status: 401, headers: corsHeaders }
      );
    }
    return new Response(
      JSON.stringify({ error: "Unauthorized", message: "Authentication required" }),
      { status: 401, headers: corsHeaders }
    );
  }

  try {
    const body = await req.json() as {
      messages: Array<{role: string, content: string}>;
      door_context?: {
        door_id?: string;
        manufacturer?: string;
        model?: string;
        customer?: string;
      };
    };

    if (!body.messages || !Array.isArray(body.messages)) {
      return new Response(
        JSON.stringify({ error: "Invalid request", message: "messages array required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Load playbook for RAG context
    const playbookContext = loadPlaybook();
    const systemPrompt = buildSystemPrompt(playbookContext);

    // Add door context to the conversation if provided
    let messages = [...body.messages];
    if (body.door_context && (body.door_context.manufacturer || body.door_context.model)) {
      const contextMsg = `[Current door context: ${body.door_context.manufacturer || ''} ${body.door_context.model || ''}, ID: ${body.door_context.door_id || 'unknown'}, Customer: ${body.door_context.customer || 'unknown'}]`;
      // Prepend context to first user message or add as system context
      if (messages.length > 0 && messages[0].role === 'user') {
        messages[0] = {
          ...messages[0],
          content: `${contextMsg}\n\n${messages[0].content}`
        };
      }
    }

    // Call Ollama
    let result = await callOllama(messages, systemPrompt);
    
    // Handle tool calls if any
    const toolResults: string[] = [];
    if (result.tool_calls && result.tool_calls.length > 0) {
      for (const toolCall of result.tool_calls) {
        const fn = toolCall.function;
        const args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : fn.arguments;
        
        // Get base URL for internal API calls
        const baseUrl = new URL(req.url).origin;
        const toolResult = await executeTool(fn.name, args, baseUrl);
        toolResults.push(`[${fn.name}]: ${toolResult}`);
      }
      
      // Add tool results and get final response
      const messagesWithTools = [
        ...messages,
        { role: "assistant", content: result.content || "Let me look that up..." },
        { role: "user", content: `Tool results:\n${toolResults.join('\n\n')}\n\nPlease provide your response based on this information.` }
      ];
      
      result = await callOllama(messagesWithTools, systemPrompt);
    }

    return new Response(
      JSON.stringify({
        response: result.content,
        model: OLLAMA_MODEL,
        tool_calls_made: toolResults.length > 0 ? toolResults : undefined
      }),
      { status: 200, headers: corsHeaders }
    );

  } catch (e: any) {
    console.error("[Copilot-AI] Error:", e);
    
    // Check if Ollama server is unreachable
    if (e.message?.includes('fetch failed') || e.message?.includes('ECONNREFUSED')) {
      return new Response(
        JSON.stringify({ 
          error: "AI Server Unavailable", 
          message: "Cannot connect to Ollama server. Make sure the AI server is running.",
          details: `Tried to connect to: ${OLLAMA_BASE_URL}`
        }),
        { status: 503, headers: corsHeaders }
      );
    }
    
    return new Response(
      JSON.stringify({ error: "Internal error", message: e.message }),
      { status: 500, headers: corsHeaders }
    );
  }
};

export const config: Config = {
  path: "/api/copilot-ai",
};
