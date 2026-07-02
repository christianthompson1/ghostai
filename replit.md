# Ghost AI

Conversational Solana intelligence terminal built under the Ghost Protocol ecosystem.

## Stack

- **Frontend**: TanStack Start (React 19, TanStack Router, TanStack Query) + Vite 8 + Tailwind CSS 4
- **Auth / DB**: Supabase (project `ubcaykxwceslvbttkarc`)
- **UI**: shadcn/ui (Radix primitives), liquid-glass design system
- **Backend engine**: Express + TypeScript at `/server` (isolated, port 3001)

## Running the project

### Frontend (port 5000)
```bash
npm run dev
```
Workflow: **Start application** — runs automatically.

### Backend server (port 3001)
```bash
cd server && npm install && npm run dev
```
A separate workflow can be added when API endpoints are configured.

## Architecture rule

> All backend API endpoints, routes, and token calculations live **exclusively** in `/server`.  
> `/src` and `/public` are the Lovable-built frontend — do **not** modify them.

## /server layout

```
server/
├── index.ts          # Express entry (port 3001, CORS, middleware)
├── routes/
│   └── api.ts        # Root API router — mount sub-routers here
├── package.json      # Isolated deps (express, cors, ts-node)
└── tsconfig.json
```

## Environment variables

| Variable | Where set | Purpose |
|---|---|---|
| `SUPABASE_URL` | `.env` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | `.env` | Supabase anon/publishable key |
| `SESSION_SECRET` | Replit Secret | Session signing |

## User preferences

- Backend code must stay in `/server` — never bleed into `/src` or `/public`.
- Preserve the existing frontend exactly as Lovable built it.
