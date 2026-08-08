import { Buffer } from "buffer";

// @solana/web3.js and several wallet adapters reference the global `Buffer`
// without importing it. Browsers have no such global, so the module-scope
// access throws (`Cannot read properties of undefined (reading 'from')`)
// and the whole React tree fails to mount.
// "buffer" resolves to the npm polyfill in the client build (see vite.config.ts)
// and to the Node/workerd builtin on the server.
const g = globalThis as unknown as { Buffer?: typeof Buffer; global?: unknown };
if (!g.global) g.global = globalThis;
if (!g.Buffer) g.Buffer = Buffer;

export {};
