# AAS Portal v7.0.0 - RBAC Protected + AI Copilot

## What's New in v7

### 🔒 Copilot Security (from v7.0)

- **API Protection**: `/api/copilot` requires Auth0 JWT with Admin/Tech role
- **Frontend Protection**: Copilot button only appears for authorized users
- **Customer Safe**: Public visitors never see the Copilot

### 🤖 AI Copilot (NEW - v7.1)

The Copilot now has **two modes**:

| Mode | Description | When to Use |
|------|-------------|-------------|
| **AI Chat** | Natural conversation with LLM | Complex questions, "how do I..." |
| **Classic** | Deterministic playbook lookup | Quick symptom → steps lookup |

**AI Features:**
- Natural language troubleshooting
- Automatic door context awareness
- Can look up doors, search parts, query manuals
- Falls back to Classic mode if AI server offline

**Requires:** Ollama server running (see `docs/OLLAMA_SETUP.md`)

### Access Matrix

| Page | Public | Customer | Tech | Admin |
|------|--------|----------|------|-------|
| `/service?id=XXX` | ✅ Basic info | ✅ Basic info | ✅ + Copilot | ✅ + Copilot |
| `/door?id=XXX` | ❌ | ✅ View | ✅ + Copilot | ✅ + Copilot |
| `/tech/*` | ❌ | ❌ | ✅ | ✅ |
| `/api/copilot` | ❌ 401 | ❌ 403 | ✅ | ✅ |

## Deployment

### Prerequisites

1. **Auth0 Configuration** (already done):
   - Domain: `dev-sug5bhfoekw1qquv.us.auth0.com`
   - Audience: `https://api.aas-portal.com`
   - Roles namespace: `https://aas-portal.com/roles`

2. **Disable Google Social Login** (if showing developer key warning):
   - Go to Auth0 Dashboard → Authentication → Social
   - Disable or delete the Google connection

### Deploy to Netlify

```bash
# From your project folder
git add .
git commit -m "v7.0.0 - Copilot RBAC protection"
git push
```

Netlify will auto-deploy from your repo.

## How It Works

### Backend (`/api/copilot`)

```
Request → Check Authorization header → Verify JWT → Check roles → Process or Reject
```

- Missing token → 401 Unauthorized
- Invalid token → 401 Unauthorized  
- Wrong role → 403 Forbidden (shows user's actual roles)
- Valid Admin/Tech → 200 OK with copilot data

### Frontend (`copilot.js`)

```
Page Load → Wait for Auth → Check roles → Create UI (or not)
```

- Not authenticated → No Copilot button appears
- Customer role → No Copilot button appears
- Tech/Admin role → Copilot button appears, API calls include token

## File Changes from v6

| File | Change |
|------|--------|
| `netlify/functions/copilot.mts` | Added JWT verification + role check |
| `public/assets/copilot.js` | Added auth check before UI creation |
| `utils/server-auth.mjs` | Auth utilities (unchanged) |
| `package.json` | Version bump to 7.0.0 |

## Testing

### Test as Customer (should NOT see Copilot):
1. Log out
2. Log in with a Customer account
3. Visit `/service?id=AAS-001`
4. Verify: No 🤖 button visible

### Test as Tech (SHOULD see Copilot):
1. Log in with a Tech account
2. Visit `/service?id=AAS-001`
3. Verify: 🤖 button visible
4. Click it - should load playbooks

### Test API directly (should fail without token):
```bash
curl -X POST https://your-site.netlify.app/api/copilot \
  -H "Content-Type: application/json" \
  -d '{"manufacturer":"Horton","model":"C4190"}'

# Expected: {"error":"Unauthorized","message":"Missing Authorization header"}
```

## Troubleshooting

### Copilot not showing for Techs?

1. Check browser console for `[Copilot]` logs
2. Verify user has `Tech` role in Auth0 Dashboard
3. Make sure roles are in the ID token (check Auth0 Rules/Actions)

### 401 errors on API?

1. Token might be expired - try logging out and back in
2. Check Auth0 audience matches `https://api.aas-portal.com`

### Google login warning?

Disable Google social connection in Auth0 Dashboard - you're using Auth0's dev keys.

---

Built for AAS by Claude • v7.0.0 • January 2026
