import { isWebMcpAvailable } from "./modelContext";

/**
 * Rail mark, lined up with the rail icons, shown only when the browser exposes
 * document.modelContext; without WebMCP the sandbox shows nothing.
 */
export function WebMcpStatusIcon() {
  if (!isWebMcpAvailable()) {
    return null;
  }

  return (
    <div
      role="img"
      aria-label="WebMCP available"
      title="WebMCP available"
      data-testid="webmcp-status"
      style={{
        display: "grid",
        placeItems: "center",
        width: 36,
        height: 20,
        marginInline: 6,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: "var(--mui-palette-success-main, #2e7d32)",
        }}
      />
    </div>
  );
}
