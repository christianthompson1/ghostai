// @solana/web3.js and several wallet adapters reference the global `Buffer`
// without importing it. Browsers have no such global, so the module-scope
// access throws (`Cannot read properties of undefined (reading 'from')`)
// and the whole React tree fails to mount.
// Browser-only: on the server Node/workerd already provides Buffer, and the
// CJS npm polyfill cannot be evaluated in the SSR runtime.
if (typeof window !== "undefined") {
  const g = globalThis as unknown as { Buffer?: unknown; global?: unknown };
  if (!g.global) g.global = globalThis;
  if (!g.Buffer) {
    void import("buffer").then((m) => {
      if (!g.Buffer) g.Buffer = m.Buffer;
    });
  }
}

export {};
