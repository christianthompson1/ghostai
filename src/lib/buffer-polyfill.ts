import { Buffer } from "buffer";

// @solana/web3.js and several wallet adapters reference the global `Buffer`
// without importing it. Browsers have no such global, so the module-scope
// access throws (`Cannot read properties of undefined (reading 'from')`)
// and the whole React tree fails to mount.
const g = globalThis as unknown as { Buffer?: typeof Buffer; global?: unknown };
if (!g.Buffer) g.Buffer = Buffer;
if (!g.global) g.global = globalThis;

export {};
