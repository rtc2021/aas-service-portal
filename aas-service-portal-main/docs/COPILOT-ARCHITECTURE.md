# AAS Copilot Architecture

## Overview

The AAS Copilot is a context-aware field assistant embedded in the tech portal. It surfaces relevant manuals, suggests parts, shows service history, and generates structured admin actions—all from your existing data lakes.

```
┌─────────────────────────────────────────────────────────────────┐
│                        TECH PORTAL                               │
│  ┌──────────────────────────────────────┬────────────────────┐  │
│  │                                      │   COPILOT PANEL    │  │
│  │         /door?id=MH-1.1              │  ┌──────────────┐  │  │
│  │                                      │  │ Diagnose     │  │  │
│  │   Door: MH-1.1                       │  │ Parts        │  │  │
│  │   Model: Horton 4190                 │  │ Procedures   │  │  │
│  │   Customer: Manning Hospital         │  │ History      │  │  │
│  │   Last Service: 01-15-2026           │  │ Admin        │  │  │
│  │                                      │  └──────────────┘  │  │
│  │   [Request Service] [View History]   │                    │  │
│  │                                      │  "Hearing grinding │  │
│  │                                      │   on close..."     │  │
│  │                                      │                    │  │
│  │                                      │  ▶ Check belt      │  │
│  │                                      │  ▶ Inspect rollers │  │
│  │                                      │  ▶ Manual: p.47    │  │
│  └──────────────────────────────────────┴────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Sources (No New Sheets)

| Source | Location | Used For |
|--------|----------|----------|
| Door Registry | Google Sheets CSV | Door ID → Asset ID, Customer, Model, Manufacturer |
| Door Master | Google Sheets CSV | Status, Last Inspection, Notes |
| Service_History | Google Sheets (Make writes) | Recent WOs, parts used, tech notes |
| Manuals Hub | Google Sheets CSV | Model → Manual links, Tags for search |
| Parts Finder Index | Google Sheets CSV | Addison#, MFG#, Description, Images |
| Playbooks | `/api/copilot` JSON | Model × Symptom → Checklists, Parts |

---

## API Contract

### `POST /api/copilot`

**Request:**
```json
{
  "door_id": "MH-1.1",
  "context": {
    "model": "Horton 4190",
    "manufacturer": "Horton",
    "door_type": "Fire door auto swing",
    "customer": "Manning Family Children's Hospital"
  },
  "symptom": "grinding noise on close",
  "tab": "diagnose"
}
```

**Response:**
```json
{
  "next_actions": [
    {
      "id": "chk-001",
      "type": "checklist",
      "title": "Grinding Noise Diagnosis",
      "steps": [
        { "step": 1, "text": "Inspect drive belt for wear/cracks", "ref": "manual:horton-4190:p47" },
        { "step": 2, "text": "Check top pivot bearing", "ref": "manual:horton-4190:p52" },
        { "step": 3, "text": "Inspect arm roller condition", "ref": null },
        { "step": 4, "text": "Verify header rail alignment", "ref": "manual:horton-4190:p38" }
      ],
      "confidence": 0.92,
      "source": "playbook:horton-4190:grinding"
    }
  ],
  "part_candidates": [
    {
      "rank": 1,
      "addison": "ADI-4190-BLT",
      "mfg_number": "4190-0012",
      "description": "Drive Belt - Horton 4190",
      "confidence": 0.85,
      "reason": "Most common cause of grinding on 4190 swing doors",
      "image_url": "https://...",
      "limble_safe_text": "4190-0012 Drive Belt"
    },
    {
      "rank": 2,
      "addison": "ADI-4190-PVT",
      "mfg_number": "4190-0045",
      "description": "Top Pivot Bearing Assembly",
      "confidence": 0.62,
      "reason": "Second most common; check if belt is fine",
      "image_url": "https://...",
      "limble_safe_text": "4190-0045 Pivot Bearing"
    }
  ],
  "manual_links": [
    {
      "title": "Horton 4190 Service Manual",
      "section": "Drive System Troubleshooting",
      "page": 47,
      "url": "https://drive.google.com/...",
      "tags": ["4190", "grinding", "belt", "drive"]
    }
  ],
  "history_glance": {
    "last_service": {
      "date": "2026-01-15",
      "type": "PM",
      "tech": "Marcus",
      "notes": "Routine inspection, all normal"
    },
    "recent_parts": [],
    "open_issues": []
  },
  "admin_actions": [
    {
      "action": "create_followup_wo",
      "label": "Create Follow-Up WO",
      "payload": {
        "door_id": "MH-1.1",
        "asset_id": "3762",
        "type": "corrective",
        "priority": "normal",
        "description": "Grinding noise diagnosis - check belt and pivot bearing",
        "suggested_parts": ["ADI-4190-BLT"]
      }
    },
    {
      "action": "add_parts_to_estimate",
      "label": "Add Parts to Estimate",
      "payload": {
        "customer": "Manning Family Children's Hospital",
        "door_id": "MH-1.1",
        "parts": [
          { "addison": "ADI-4190-BLT", "qty": 1 }
        ]
      }
    }
  ]
}
```

---

## Playbook Schema

Playbooks are deterministic rule sets per model/symptom. They live in the Netlify Function or a JSON file.

### `copilot.playbook.json`

```json
{
  "version": "1.0",
  "models": {
    "horton-4190": {
      "display_name": "Horton 4190",
      "manufacturer": "Horton",
      "door_types": ["fire door auto swing"],
      "symptoms": {
        "grinding": {
          "keywords": ["grinding", "grind", "scraping", "rubbing"],
          "checklist": [
            { "step": "Inspect drive belt for wear/cracks", "manual_ref": "p47" },
            { "step": "Check top pivot bearing", "manual_ref": "p52" },
            { "step": "Inspect arm roller condition", "manual_ref": null },
            { "step": "Verify header rail alignment", "manual_ref": "p38" }
          ],
          "likely_parts": [
            { "addison": "ADI-4190-BLT", "confidence": 0.85, "reason": "Most common cause" },
            { "addison": "ADI-4190-PVT", "confidence": 0.62, "reason": "If belt is fine" }
          ],
          "manual_sections": ["Drive System Troubleshooting"]
        },
        "wont_close": {
          "keywords": ["won't close", "wont close", "stays open", "stuck open"],
          "checklist": [
            { "step": "Check sensor alignment", "manual_ref": "p23" },
            { "step": "Verify presence sensor not blocked", "manual_ref": "p24" },
            { "step": "Check for obstructions in door path", "manual_ref": null },
            { "step": "Test hold-open switch/button", "manual_ref": "p31" }
          ],
          "likely_parts": [
            { "addison": "ADI-SENS-01", "confidence": 0.70, "reason": "Sensor failure common" }
          ],
          "manual_sections": ["Sensor Configuration", "Hold-Open Features"]
        },
        "false_reopen": {
          "keywords": ["false reopen", "reopens", "reverses", "bounces back"],
          "checklist": [
            { "step": "Check BEA sensor alignment", "manual_ref": "p23" },
            { "step": "Clean sensor lenses", "manual_ref": "p25" },
            { "step": "Verify header learn procedure", "manual_ref": "p19" },
            { "step": "Check lock wiring", "manual_ref": "p55" },
            { "step": "Run BEA Flatscan test", "manual_ref": "p27" }
          ],
          "likely_parts": [
            { "addison": "ADI-BEA-FLAT", "confidence": 0.65, "reason": "Flatscan often needs replacement" }
          ],
          "manual_sections": ["Sensor Troubleshooting", "Header Learn"]
        }
      },
      "manuals": [
        {
          "title": "Horton 4190 Installation & Service Manual",
          "url": "https://drive.google.com/file/d/...",
          "tags": ["4190", "fire", "swing", "auto"]
        }
      ]
    },
    "dura-glide": {
      "display_name": "Dura-Glide 2000/3000",
      "manufacturer": "Stanley",
      "door_types": ["slide", "sliding"],
      "symptoms": {
        "grinding": {
          "keywords": ["grinding", "scraping"],
          "checklist": [
            { "step": "Inspect track for debris", "manual_ref": "p12" },
            { "step": "Check roller condition", "manual_ref": "p34" },
            { "step": "Verify belt tension", "manual_ref": "p41" }
          ],
          "likely_parts": [
            { "addison": "ADI-DG-ROLLER", "confidence": 0.80, "reason": "Rollers wear frequently" }
          ],
          "manual_sections": ["Track Maintenance"]
        },
        "error_e4": {
          "keywords": ["e4", "error 4", "E4"],
          "checklist": [
            { "step": "Check encoder connection", "manual_ref": "p67" },
            { "step": "Verify motor cable", "manual_ref": "p68" },
            { "step": "Run motor test sequence", "manual_ref": "p70" }
          ],
          "likely_parts": [
            { "addison": "ADI-DG-ENC", "confidence": 0.75, "reason": "Encoder failure" }
          ],
          "manual_sections": ["Error Codes", "Motor Diagnostics"]
        }
      },
      "manuals": [
        {
          "title": "Dura-Glide 2000/3000 Service Manual",
          "url": "https://drive.google.com/file/d/...",
          "tags": ["dura-glide", "stanley", "slide", "2000", "3000"]
        }
      ]
    },
    "dorma-ed100": {
      "display_name": "Dorma ED100",
      "manufacturer": "Dorma",
      "door_types": ["swing", "auto swing"],
      "symptoms": {
        "slow_operation": {
          "keywords": ["slow", "sluggish", "delayed"],
          "checklist": [
            { "step": "Check power supply voltage", "manual_ref": "p15" },
            { "step": "Verify speed settings (P1-P4)", "manual_ref": "p22" },
            { "step": "Inspect arm linkage", "manual_ref": "p31" }
          ],
          "likely_parts": [],
          "manual_sections": ["Speed Adjustment", "Power Requirements"]
        },
        "no_power": {
          "keywords": ["no power", "dead", "won't turn on", "no lights"],
          "checklist": [
            { "step": "Check incoming power", "manual_ref": "p11" },
            { "step": "Verify fuse F1", "manual_ref": "p13" },
            { "step": "Check transformer output", "manual_ref": "p14" }
          ],
          "likely_parts": [
            { "addison": "ADI-ED100-FUSE", "confidence": 0.60, "reason": "Fuse is cheap first check" },
            { "addison": "ADI-ED100-XFMR", "confidence": 0.45, "reason": "If fuse is good" }
          ],
          "manual_sections": ["Electrical Troubleshooting"]
        }
      },
      "manuals": [
        {
          "title": "Dorma ED100 Technical Manual",
          "url": "https://drive.google.com/file/d/...",
          "tags": ["dorma", "ed100", "swing"]
        }
      ]
    }
  }
}
```

---

## Admin Actions JSON Spec

When a tech clicks an admin button, the portal POSTs to your Make webhook.

### Idempotency Key Format
```
{door_id}:{date}:{action}:{hash(parts[])}
```

Example: `MH-1.1:2026-01-25:create_followup_wo:a3f2b1`

### Webhook Payload Schema

```json
{
  "idempotency_key": "MH-1.1:2026-01-25:create_followup_wo:a3f2b1",
  "timestamp": "2026-01-25T13:45:00Z",
  "tech_id": "marcus@aas.com",
  "action": "create_followup_wo",
  "door": {
    "door_id": "MH-1.1",
    "asset_id": "3762",
    "customer": "Manning Family Children's Hospital",
    "address": "200 Henry Clay Ave, New Orleans, LA 70118"
  },
  "payload": {
    "type": "corrective",
    "priority": "normal",
    "description": "Grinding noise diagnosis - check belt and pivot bearing",
    "suggested_parts": [
      {
        "addison": "ADI-4190-BLT",
        "mfg_number": "4190-0012",
        "description": "Drive Belt - Horton 4190",
        "qty": 1
      }
    ],
    "copilot_session_id": "cp-2026012513450001"
  },
  "source": "copilot",
  "version": "1.0"
}
```

### Action Types

| Action | Target | Make Scenario |
|--------|--------|---------------|
| `create_followup_wo` | Limble | Create Task on Asset |
| `add_parts_to_estimate` | QBO | Create/Update Estimate Draft |
| `mark_ready_to_bill` | QBO + Sheets | Update Service_History, notify admin |
| `log_diagnosis` | Service_History | Append Copilot findings to Notes |

---

## Make Webhook Integration

### Endpoint
```
https://hook.us1.make.com/your-aas-copilot-webhook
```

### Make Scenario Structure

```
[Webhook] → [Router by action]
              ├── create_followup_wo → [Check idempotency] → [Limble: Create Task]
              ├── add_parts_to_estimate → [Check idempotency] → [QBO: Create Estimate]
              ├── mark_ready_to_bill → [Update Sheets] → [Notify Admin]
              └── log_diagnosis → [Append to Service_History]
```

### Idempotency Check (Data Store)

Store processed `idempotency_key` values in Make's Data Store. Before processing, check if key exists:
- If exists → Return success (already processed), skip action
- If not exists → Process action, then store key

---

## UI Panel Specification

### Panel Structure (Slide-Over)

```html
<aside id="copilotPanel" class="copilot-panel">
  <header class="copilot-header">
    <h2>🤖 Copilot</h2>
    <button class="copilot-close">×</button>
  </header>
  
  <nav class="copilot-tabs">
    <button data-tab="diagnose" class="active">Diagnose</button>
    <button data-tab="parts">Parts</button>
    <button data-tab="procedures">Procedures</button>
    <button data-tab="history">History</button>
    <button data-tab="admin">Admin</button>
  </nav>
  
  <div class="copilot-input">
    <input type="text" placeholder="Describe the issue..." id="symptomInput">
    <button id="analyzeBtn">Analyze</button>
  </div>
  
  <div class="copilot-content">
    <!-- Tab content renders here -->
  </div>
</aside>
```

### Visual Style (Matching AAS Glass UI)

```css
.copilot-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 380px;
  height: 100vh;
  background: rgba(11, 18, 32, 0.95);
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(20px);
  transform: translateX(100%);
  transition: transform 0.3s ease;
  z-index: 1000;
  display: flex;
  flex-direction: column;
}

.copilot-panel.open {
  transform: translateX(0);
}

.copilot-header {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.copilot-header h2 {
  margin: 0;
  font-size: 18px;
  color: #7dffb0;
}

.copilot-tabs {
  display: flex;
  padding: 8px;
  gap: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.copilot-tabs button {
  flex: 1;
  padding: 8px 4px;
  background: transparent;
  border: none;
  color: #9fb0c3;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s;
}

.copilot-tabs button:hover {
  background: rgba(255, 255, 255, 0.05);
}

.copilot-tabs button.active {
  background: rgba(125, 255, 176, 0.15);
  color: #7dffb0;
}

.copilot-input {
  padding: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  gap: 8px;
}

.copilot-input input {
  flex: 1;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #e6edf3;
  font-size: 14px;
}

.copilot-input input::placeholder {
  color: #6b7d91;
}

.copilot-input button {
  padding: 10px 16px;
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
  border: none;
  border-radius: 8px;
  color: white;
  font-weight: 700;
  font-size: 12px;
  text-transform: uppercase;
  cursor: pointer;
}

.copilot-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

/* Checklist Card */
.checklist-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
}

.checklist-card h3 {
  margin: 0 0 12px;
  font-size: 14px;
  color: #e6edf3;
}

.checklist-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.checklist-item:last-child {
  border-bottom: none;
}

.checklist-checkbox {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(125, 255, 176, 0.5);
  border-radius: 4px;
  cursor: pointer;
  flex-shrink: 0;
}

.checklist-checkbox.checked {
  background: #22c55e;
  border-color: #22c55e;
}

.checklist-text {
  flex: 1;
  font-size: 13px;
  color: #c8d4e0;
  line-height: 1.4;
}

.checklist-ref {
  font-size: 11px;
  color: #7dffb0;
  text-decoration: none;
}

/* Part Candidate Card */
.part-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 8px;
  display: flex;
  gap: 12px;
}

.part-card img {
  width: 60px;
  height: 60px;
  object-fit: contain;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
}

.part-info {
  flex: 1;
}

.part-name {
  font-size: 13px;
  font-weight: 600;
  color: #e6edf3;
  margin-bottom: 4px;
}

.part-number {
  font-size: 11px;
  color: #7dffb0;
  font-family: monospace;
}

.part-confidence {
  font-size: 11px;
  color: #9fb0c3;
  margin-top: 4px;
}

.part-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.part-action-btn {
  padding: 6px 10px;
  font-size: 10px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #c8d4e0;
  cursor: pointer;
}

/* Admin Actions */
.admin-btn {
  width: 100%;
  padding: 14px;
  margin-bottom: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  color: #e6edf3;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  transition: all 0.15s;
}

.admin-btn:hover {
  background: rgba(125, 255, 176, 0.1);
  border-color: rgba(125, 255, 176, 0.3);
}

.admin-btn.primary {
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
  border: none;
}

/* History Glance */
.history-item {
  padding: 12px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  margin-bottom: 8px;
}

.history-date {
  font-size: 11px;
  color: #7dffb0;
  font-weight: 600;
}

.history-type {
  font-size: 13px;
  color: #e6edf3;
  margin: 4px 0;
}

.history-notes {
  font-size: 12px;
  color: #9fb0c3;
  line-height: 1.4;
}
```

---

## Security & Guardrails

1. **Auth Required** - Copilot only available to authenticated techs (Clerk role check)
2. **No Auto-Actions** - All admin actions require explicit button click
3. **Audit Trail** - Every Copilot request logged with `copilot_session_id`
4. **Source Attribution** - All suggestions show source (playbook, manual ref, history)
5. **Confidence Thresholds** - Parts below 50% confidence shown grayed with "Low confidence"
6. **Rate Limiting** - Max 30 Copilot requests per tech per hour

---

## Implementation Phases

### MVP (Weeks 1-2)
- [ ] Copilot panel UI shell
- [ ] Symptom input → playbook lookup
- [ ] Checklist rendering with manual links
- [ ] Part candidates (rule-based from playbooks)
- [ ] Basic history glance (last 3 WOs)

### V1.1 (Weeks 3-4)
- [ ] Admin actions → Make webhook
- [ ] Idempotency handling
- [ ] Procedure cards with print
- [ ] Log diagnosis to Service_History

### V1.2 (Weeks 5-6)
- [ ] Keyword extraction from free-text
- [ ] Multi-symptom handling
- [ ] Confidence scoring from historical parts data
- [ ] Offline cache for viewed manuals

### V2.0 (Future)
- [ ] LLM layer for ranking and text generation
- [ ] Image assist (camera → diagram overlay)
- [ ] Voice input for hands-free
- [ ] Customer-facing simplified view

---

## File Structure

```
/netlify/functions/
├── copilot.mts           # Main Copilot API
├── copilot-playbooks.json # Model/symptom rules
└── _copilot-utils.mts    # Helpers (fetch history, parse symptoms)

/public/
├── /assets/
│   └── copilot.css       # Panel styles
├── /tech/
│   └── door/index.html   # Door page with Copilot panel
└── /js/
    └── copilot.js        # Panel logic
```
