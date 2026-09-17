// Keep this as .ts so the declaration build emits it for public CSS imports.
declare module "*.svg" {
  const url: string;
  export default url;
}

declare module "*.css";
