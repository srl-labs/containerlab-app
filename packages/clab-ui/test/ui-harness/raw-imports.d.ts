// Declared here instead of pulling in vite/client, whose "*.svg" module clashes with src/types/assets.ts.
declare module "*?raw" {
  const content: string;
  export default content;
}

declare module "*?url" {
  const url: string;
  export default url;
}
