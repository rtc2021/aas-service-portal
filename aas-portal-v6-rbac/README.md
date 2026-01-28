# AAS Portal v5.0 - Authentication Edition

## What's New in v5.0

### 🔐 Auth0 Authentication
- **Sign In/Sign Out** buttons in sidebar
- **Role-based access**: Admin, Tech, Customer
- **JWT verification** ready for protected API endpoints
- **Persistent sessions** with refresh tokens

### 🤖 Copilot Logic Tree v2.0
- UL325 compliance verification
- Detailed potentiometer/jumper references
- Wear item inspection and lifespan guidance
- Enhanced error codes for all 8 operator models
- Horton C4190 swing/folding playbook additions

### 🐛 Bug Fixes
- Fixed broken logo URL (header now shows properly)
- Sidebar shows on all pages (door, service, tech pages)

---

## Auth0 Configuration

Your Auth0 is already configured with:

| Setting | Value |
|---------|-------|
| Domain | `dev-sug5bhfoekw1qquv.us.auth0.com` |
| Client ID | `GKz9sYl80XVddHTTRKe82QFUpd85cl1W` |
| API Audience | `https://api.aas-portal.com` |
| Roles | Admin, Tech, Customer |

### Role Permissions
- **Admin**: Full access to all sections
- **Tech**: Parts Finder, Command Center, Door Browser, Manuals, Copilot
- **Customer**: My Doors, Service History, Billing (future)

---

## Deployment Options

### Option 1: Netlify CLI (Recommended)
```bash
cd aas-portal-v5
npm install
netlify deploy --prod
```

### Option 2: Git Push
```bash
cd aas-portal-v5
git init
git add .
git commit -m "Portal v5.0 - Auth0 + Copilot v2"
git remote add origin https://github.com/rtc2021/-aas-service-portal.git
git push -u origin main
```

### Option 3: Drag & Drop
Upload the `public` folder contents to Netlify's drag & drop interface.
Note: Functions won't work with drag & drop.

---

## File Structure

```
aas-portal-v5/
├── netlify.toml           # Netlify config
├── package.json           # Dependencies
├── public/
│   ├── index.html         # Dashboard (Command Center)
│   ├── assets/
│   │   ├── auth.js        # Auth0 frontend module ⭐
│   │   ├── portal.css     # Global styles
│   │   ├── copilot.js/css # Copilot widget
│   │   └── command-center.js
│   ├── door/              # Door lookup page
│   ├── service/           # Service page
│   └── tech/
│       ├── command/       # Command Center
│       ├── doors/         # Door Browser
│       ├── manuals/       # Tech Manuals
│       └── parts/         # Parts Finder
├── netlify/functions/
│   ├── door.mts           # /api/door endpoint
│   ├── search-index.mts   # /api/search-index
│   ├── copilot.mts        # /api/copilot
│   ├── stats.mts          # /api/stats
│   └── copilot-playbooks.json  # Logic tree v2.0 ⭐
└── utils/
    └── server-auth.mts    # JWT verification ⭐
```

---

## Testing Authentication

1. **Deploy the portal**
2. **Visit the site** - you'll see "Sign In" button
3. **Click Sign In** - redirects to Auth0 login
4. **Create your admin account** in Auth0:
   - Go to Auth0 Dashboard → User Management → Users
   - Create new user with your email
   - Go to User Management → Roles → Admin
   - Add the user to Admin role
5. **Sign in** - nav sections appear based on role

---

## Environment Variables (Optional)

If you want to customize, add these to Netlify:

```env
AUTH0_DOMAIN=dev-sug5bhfoekw1qquv.us.auth0.com
AUTH0_CLIENT_ID=GKz9sYl80XVddHTTRKe82QFUpd85cl1W
AUTH0_AUDIENCE=https://api.aas-portal.com
```

---

## Next Steps

After deployment:

1. ✅ Create your admin user in Auth0
2. ✅ Test login/logout flow
3. ⬜ Add protected API endpoints (use `utils/server-auth.mts`)
4. ⬜ Build customer portal pages
5. ⬜ Connect to Limble webhooks for real-time updates

---

Built for Automatic Access Solutions LLC
Portal v5.0 • Auth0 + Copilot v2.0 • January 2026
