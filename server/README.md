# Ghost AI — Backend Processing Engine

Strictly isolated server living at `/server`. No frontend code from `/src` or `/public` is referenced here.

## Structure

```
/server
├── index.ts          # Entry point — Express app, middleware, port 3001
├── routes/
│   └── api.ts        # Root API router — add sub-routers here
├── package.json      # Isolated dependencies (Express, cors, ts-node)
├── tsconfig.json     # TypeScript config scoped to this folder
└── README.md
```

## Running

```bash
cd server
npm install
npm run dev          # watch mode
```

## Ports

| Service     | Port |
|-------------|------|
| Frontend    | 5000 |
| Backend API | 3001 |

## Adding Endpoints

1. Create a new file in `routes/` (e.g. `routes/tokens.ts`)
2. Export a Router from it
3. Mount it in `routes/api.ts`:  `router.use("/tokens", tokenRouter)`
