import type { Context, Config } from "@netlify/functions";
import { parseCsv, normDoorId, pick, clean, env, fetchCsv } from "./_csv.mts";

/**
 * GET /api/door?doorid=MH-1.1&view=service|door
 * 
 * Unified door endpoint supporting both service requests and fire inspections.
 * 
 * Views:
 * - service (default): Registry-focused for work order requests
 * - door/inspection: Master-focused for fire door inspection records
 * 
 * Env vars (Functions scope):
 * - REGISTRY_CSV_URL   (Door Registry - service info)
 * - DOOR_MASTER_CSV_URL (Door Master - inspection info)
 */

// Fallback URLs
const FALLBACK_REGISTRY_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTcpq972LhvEzo3MA_iJzFeF7vJ1a7qudjvd3ooqxrfho-SZ7p1kvP0943VXsCfHWywDknQ-BHzC2Og/pub?gid=0&single=true&output=csv";
const FALLBACK_DOOR_MASTER_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRaL-Cagmos7f4rCojgOROSm_Zs8Gnl41nvUUN8hXJIrDyGdv4eYhtJKq56lMRK9euN0TvFNOj_rszM/pub?gid=2106704799&single=true&output=csv";

// Build canonical door object from both sources
function buildCanonicalDoor(
  regHit: Record<string,string> | null, 
  masterHit: Record<string,string> | null, 
  doorKey: string, 
  dooridRaw: string
) {
  // Door ID: Registry "Name" or Master "Door ID"
  const doorId = (regHit ? pick(regHit, ["Name","name"]) : null) 
              || (masterHit ? pick(masterHit, ["Door ID","DoorID","door id"]) : null)
              || dooridRaw;
  
  return {
    door_id: doorId,
    door_key: normDoorId(doorId),
    ids: {
      // Registry: "Door ID" column is Limble asset number (e.g., 03-747)
      asset_id: regHit ? pick(regHit, ["Door ID","DoorID","door id"]) : "",
      parent_id: regHit ? pick(regHit, ["Parent ID","ParentID","parent id"]) : "",
      limble_asset_id: regHit ? pick(regHit, ["Asset ID","AssetID","asset id"]) : ""
    },
    customer: {
      name: regHit ? pick(regHit, ["Customer"]) : ""
    },
    location: {
      address: regHit ? pick(regHit, ["Address"]) : "",
      door_location: regHit ? pick(regHit, ["Door location","Door Location"]) : "",
      // Master "Location" field (e.g., "Support Services Corridor")
      inspection_location: masterHit ? pick(masterHit, ["Location"]) : ""
    },
    hardware: {
      door_type: regHit ? pick(regHit, ["Door Type","DoorType","Type"]) : "",
      manufacturer: regHit ? pick(regHit, ["Manufacturer"]) : "",
      model: regHit ? pick(regHit, ["Model"]) : ""
    },
    links: {
      // Registry: QR URL for service/work requests
      request_service: regHit ? pick(regHit, ["QR URL","QR URL ","QR_URL","Work Request URL","Limble Work Request URL"]) : "",
      // Registry: Documentation link
      docs: regHit ? pick(regHit, ["Docs","docs","Documentation","Doc Link"]) : "",
      // Master: QR Link (door page URL)
      door_page: masterHit ? pick(masterHit, ["QR Link","QRLink","QR link"]) : "",
      // Master: Limble PM Link for inspections
      limble_pm: masterHit ? pick(masterHit, ["Limble PM Link","Limble PM","PM Link"]) : ""
    },
    inspection: {
      last_inspection: masterHit ? pick(masterHit, ["Last Inspection","LastInspection"]) : "",
      status: masterHit ? pick(masterHit, ["Status"]) : "",
      results: masterHit ? pick(masterHit, ["Results"]) : "",
      technician: masterHit ? pick(masterHit, ["Technician"]) : "",
      notes: masterHit ? pick(masterHit, ["Notes"]) : "",
      retested: masterHit ? pick(masterHit, ["Retested"]) : ""
    },
    sources: {
      registry: !!regHit,
      master: !!masterHit
    }
  };
}

// Compat for /service page (Registry-focused)
function buildServiceCompat(door: ReturnType<typeof buildCanonicalDoor>) {
  return {
    doorid: door.door_id,
    asset_id: door.ids.asset_id,
    limble_door_id: door.ids.asset_id,
    customer: door.customer.name,
    address: door.location.address,
    door_location: door.location.door_location,
    door_type: door.hardware.door_type,
    manufacturer: door.hardware.manufacturer,
    model: door.hardware.model,
    docs: door.links.docs,
    limble_url: door.links.request_service,
    status: door.inspection.status,
    last_inspection: door.inspection.last_inspection,
    technician: door.inspection.technician,
    notes: door.inspection.notes,
    door_page: door.links.door_page
  };
}

// Compat for /door page (Master-focused / inspections)
function buildDoorCompat(door: ReturnType<typeof buildCanonicalDoor>) {
  return {
    doorid: door.door_id,
    location: door.location.inspection_location || door.location.door_location,
    last_inspection: door.inspection.last_inspection,
    status: door.inspection.status,
    results: door.inspection.results,
    technician: door.inspection.technician,
    notes: door.inspection.notes,
    retested: door.inspection.retested,
    limble_pm_url: door.links.limble_pm,
    door_page: door.links.door_page,
    customer: door.customer.name,
    address: door.location.address,
    door_type: door.hardware.door_type,
    manufacturer: door.hardware.manufacturer,
    model: door.hardware.model
  };
}

export default async (req: Request, _context: Context) => {
  const headers = { 
    "content-type": "application/json",
    "cache-control": "public, max-age=60"
  };

  try {
    const u = new URL(req.url);
    
    // Debug mode
    if (u.searchParams.get("debug") === "1") {
      const REGISTRY_URL = env("REGISTRY_CSV_URL", FALLBACK_REGISTRY_URL);
      const reg = await fetchCsv(REGISTRY_URL);
      return new Response(JSON.stringify({
        version: "3.0",
        env_configured: !!process.env.REGISTRY_CSV_URL,
        sample_rows: reg.slice(0, 3).map(r => ({
          name: pick(r, ["Name","name"]),
          doorId: pick(r, ["Door ID"]),
          customer: pick(r, ["Customer"])
        }))
      }, null, 2), { status: 200, headers });
    }
    
    const dooridRaw = u.searchParams.get("doorid") || u.searchParams.get("id") || "";
    const doorKey = normDoorId(dooridRaw);
    const view = u.searchParams.get("view") || "service";
    
    if (!doorKey) {
      return new Response(JSON.stringify({ 
        error: "Missing doorid parameter",
        usage: "/api/door?doorid=MH-1.1&view=service|door"
      }), { status: 400, headers });
    }

    // Fetch from env vars with fallback
    const REGISTRY_URL = env("REGISTRY_CSV_URL", FALLBACK_REGISTRY_URL);
    const DOOR_MASTER_URL = env("DOOR_MASTER_CSV_URL", FALLBACK_DOOR_MASTER_URL);

    const [regRows, masterRows] = await Promise.all([
      fetchCsv(REGISTRY_URL).catch(() => []),
      fetchCsv(DOOR_MASTER_URL).catch(() => [])
    ]);

    // Search Registry by "Name" column
    const regHit = regRows.find(r => 
      normDoorId(pick(r, ["Name","name"])) === doorKey
    ) || null;
    
    // Search Master by "Door ID" column
    const masterHit = masterRows.find(r => 
      normDoorId(pick(r, ["Door ID","DoorID","door id"])) === doorKey
    ) || null;

    if (!regHit && !masterHit) {
      return new Response(JSON.stringify({ 
        error: `Door not found: ${dooridRaw}`,
        searched_key: doorKey
      }), { status: 404, headers });
    }

    const door = buildCanonicalDoor(regHit, masterHit, doorKey, dooridRaw);
    
    // Validation based on view
    if (view === "service" && !door.links.request_service && regHit) {
      return new Response(JSON.stringify({ 
        error: `Missing Limble request URL for door: ${dooridRaw}`,
        hint: "Check QR URL column in Door Registry"
      }), { status: 500, headers });
    }

    const compat = (view === "door" || view === "inspection") 
      ? buildDoorCompat(door) 
      : buildServiceCompat(door);

    return new Response(JSON.stringify({ door, compat, view }), { status: 200, headers });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), { 
      status: 500, headers 
    });
  }
};

export const config: Config = {
  path: ["/api/door", "/api/service-router"]
};
