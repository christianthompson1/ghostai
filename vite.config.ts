// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    server: {
      host: "0.0.0.0",
      port: 5000,
    },
    resolve: {
      alias: [
        // rpc-websockets (via @solana/web3.js) has no "workerd"/"import" export
        // condition — point it at its browser ESM build so the worker build resolves.
        {
          find: /^rpc-websockets$/,
          replacement: new URL("./node_modules/rpc-websockets/dist/index.browser.mjs", import.meta.url).pathname,
        },
        // @solana/web3.js imports "buffer"; Vite externalizes the Node builtin in the
        // browser, leaving Buffer undefined at runtime. Use the npm polyfill instead.
        {
          find: /^buffer$/,
          replacement: new URL("./node_modules/buffer/index.js", import.meta.url).pathname,
        },
      ],
    },
  },
});
