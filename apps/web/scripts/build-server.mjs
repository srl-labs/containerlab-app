import * as esbuild from "esbuild";

// ssh2 (node terminals of labs on this host) loads optional native addons inside
// try/catch and falls back to JavaScript when they fail to load. Bundle a stub
// that throws, so the fallback is taken.
const optionalNativeAddons = {
  name: "optional-native-addons",
  setup(build) {
    build.onResolve({ filter: /\.node$/ }, (args) => ({ path: args.path, namespace: "native-addon" }));
    build.onLoad({ filter: /.*/, namespace: "native-addon" }, (args) => ({
      contents: `throw new Error(${JSON.stringify(`Native addon ${args.path} is not bundled`)});`
    }));
  }
};

await esbuild.build({
  entryPoints: ["server/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outfile: "dist/server/index.cjs",
  sourcemap: true,
  plugins: [optionalNativeAddons]
});
