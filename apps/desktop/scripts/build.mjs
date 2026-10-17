import * as esbuild from "esbuild";

// ssh2 (local node terminals) loads optional native addons inside try/catch and
// falls back to JavaScript when they fail to load. Bundle a stub that throws, so
// the fallback is taken instead of an empty object that looks like the addon.
const optionalNativeAddons = {
  name: "optional-native-addons",
  setup(build) {
    build.onResolve({ filter: /\.node$/ }, (args) => ({ path: args.path, namespace: "native-addon" }));
    build.onLoad({ filter: /.*/, namespace: "native-addon" }, (args) => ({
      contents: `throw new Error(${JSON.stringify(`Native addon ${args.path} is not bundled`)});`
    }));
  }
};

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  plugins: [optionalNativeAddons]
};

await esbuild.build({ ...common, entryPoints: ["src/main.ts"], outfile: "dist/main.cjs", sourcemap: true });
await esbuild.build({ ...common, entryPoints: ["src/preload.ts"], outfile: "dist/preload.cjs" });
