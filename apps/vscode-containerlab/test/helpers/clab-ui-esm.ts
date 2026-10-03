import { registerHooks } from "node:module";

// @containerlab/clab-ui only exposes its subpaths under the "import" condition, which is how
// esbuild resolves them for the extension bundle. The unit tests run as CommonJS, so resolve
// clab-ui requests with the same condition and load the real ESM build via require(esm).
registerHooks({
  resolve(specifier, context, nextResolve) {
    const isClabUi =
      specifier === "@containerlab/clab-ui" || specifier.startsWith("@containerlab/clab-ui/");
    if (!isClabUi || context.conditions.includes("import")) {
      return nextResolve(specifier, context);
    }
    return nextResolve(specifier, { ...context, conditions: [...context.conditions, "import"] });
  }
});
