import { isWebMcpAvailable } from "./modelContext";

/** Small top-right mark for document.modelContext availability. */
export function WebMcpStatusIcon() {
  const available = isWebMcpAvailable();
  const label = available ? "WebMCP available" : "WebMCP unavailable";

  return (
    <span
      aria-label={label}
      title={label}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        flexShrink: 0,
        backgroundColor: available ? "var(--mui-palette-success-main, #2e7d32)" : "var(--mui-palette-error-main, #d32f2f)",
        opacity: available ? 1 : 0.45,
      }}
    />
  );
}
