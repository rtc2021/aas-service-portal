# AAS Service Portal v6-RBAC (Clean)

Copilot stripped for rebuild. Auth0 RBAC intact.

## Structure

```
├── public/
│   ├── assets/
│   │   ├── auth.js         # Auth0 module (also at /public/auth.js)
│   │   ├── command-center.js
│   │   └── portal.css
│   ├── auth.js             # Root auth (referenced by pages)
│   ├── door/               # Fire inspection page
│   ├── service/            # Service request page
│   ├── tech/
│   │   ├── command/        # Command Center (Admin only)
│   │   ├── doors/          # Door Browser
│   │   ├── manuals/        # Tech Manuals
│   │   ├── parts/          # Parts Finder
│   │   └── summary/        # Work Summary
│   └── index.html          # Dashboard
├── netlify/
│   └── functions/
│       ├── _csv.mts        # Shared utilities
│       ├── door.mts        # /api/door
│       ├── search-index.mts # /api/search-index
│       └── stats.mts       # /api/stats
├── utils/
│   └── server-auth.mts     # Server-side auth helpers
├── docs/                   # Architecture docs
├── netlify.toml            # Redirects + config
└── package.json
```

## Auth0 Roles

- **Admin**: Full access (Dashboard, Command Center, all tools)
- **Tech**: Parts, Manuals, Door Browser, Door/Service pages
- **Customer**: Door/Service pages, Customer section

## API Endpoints

- `GET /api/door?doorid=MH-1.1` - Door lookup
- `GET /api/stats` - Dashboard stats
- `GET /api/search-index` - Search

## Copilot (Stripped)

Ready for rebuild. See `docs/COPILOT-ARCHITECTURE.md` for reference.
