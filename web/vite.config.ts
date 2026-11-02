import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// @talk/ui (../packages/ui, a file: dependency) ships TypeScript sources.
// Vite's dev scan doesn't crawl node_modules, so without this its modules
// load unbundled and React's CommonJS breaks the Worker's module runner
// ("module is not defined"). Pre-bundle every shared component and the libs
// web uses, for the browser and the Worker alike (the globs of
// optimizeDeps.include don't follow the package's exports map, hence the
// list). The production build doesn't use this.
const sharedUi = [
  ...readdirSync(
    fileURLToPath(
      new URL("./node_modules/@talk/ui/src/components/ui", import.meta.url),
    ),
  )
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => `@talk/ui/components/${file.replace(/\.tsx$/, "")}`),
  "@talk/ui/lib/theme",
  "@talk/ui/lib/dates",
];

const sharedUiDeps = {
  include: sharedUi,
  extensions: [".tsx"],
  // The components are TSX for React's automatic JSX runtime.
  esbuildOptions: { jsx: "automatic" as const },
};

export default defineConfig({
  server: {
    // `cf dev` forwards no port flag; `everyapp dev` passes the port in PORT.
    host: "127.0.0.1",
    port: Number(process.env.PORT ?? 3001),
    strictPort: true,
  },
  // Source maps for the Worker bundle only: "hidden" leaves no
  // sourceMappingURL and keeps maps out of the public assets. The deploy
  // uploads them so Workers logs and Issues point at source lines.
  environments: {
    ssr: {
      build: { sourcemap: "hidden" },
      optimizeDeps: sharedUiDeps,
    },
  },
  optimizeDeps: sharedUiDeps,
  plugins: [
    // Reads cloudflare.config.ts. Local dev never touches remote resources.
    cloudflare({ viteEnvironment: { name: "ssr" }, remoteBindings: false }),
    tsConfigPaths(),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
});
