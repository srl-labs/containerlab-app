// Wireshark icon rendered as an inline SVG so it inherits currentColor like the
// surrounding Tabler icons used in menus.
import React from "react";

export interface WiresharkIconProps extends React.SVGProps<SVGSVGElement> {
  /** Mirrors a fontSize prop (size keyword) so existing callers keep working. */
  fontSize?: "inherit" | "small" | "medium" | "large";
}

const FONT_SIZE_MAP: Record<NonNullable<WiresharkIconProps["fontSize"]>, string> = {
  inherit: "1em",
  small: "1.25rem",
  medium: "1.5rem",
  large: "2.1875rem"
};

export const WiresharkIcon: React.FC<WiresharkIconProps> = ({
  fontSize = "medium",
  style,
  ...props
}) => {
  const size = FONT_SIZE_MAP[fontSize];
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="currentColor"
      focusable="false"
      aria-hidden="true"
      style={{ display: "inline-block", flexShrink: 0, ...style }}
      {...props}
    >
      <path d="m24 0c-13.243463 0-24 10.756537-24 24s10.756537 24 24 24 24-10.756537 24-24-10.756537-24-24-24zm0 2.5c11.857 0 21.5 9.643 21.5 21.5 0 2.42-.406 4.74-1.145 6.91h-10.855c-.36-.806-4.42-10.09.445-17.91.133-.234.16775-.52325.09375-.78125-.035-.16-.11275-.3125-.21875-.4375-.199-.211-.49225-.329453-.78125-.314453h-.001953v.001953c-9.016.141-14.029297 5.453-16.779297 10.625-2.516 4.734-2.896703 8.64825-2.970703 9.40625h-9.775c-.739-2.17-1.145-4.49-1.145-6.91 0-11.857 9.643-21.5 21.5-21.5zm8.273438 10.8710941c-4.761 9.23.222656 19.75.222656 19.75.035.043.078.086.125.125.172.254.469343.423453.777344.439453h10.71875c-3.41 7.32-10.82 12.25-19.617188 12.474609-8.797188-.224609-16.2070734-5.154609-19.6171875-12.474609h9.6113285c.285 0 .563-.12875.75-.34375.105-.125.18375-.277453.21875-.439453.004-.043.004-.086 0-.125 0 0 .469-4.238 2.8-8.8 2.163-4.241 6.064547-8.43425 13.560547-9.10625z" />
    </svg>
  );
};
