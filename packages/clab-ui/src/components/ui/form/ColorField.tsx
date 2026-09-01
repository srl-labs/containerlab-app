// Color picker input with hex display and optional label (Mantine).
import React from "react";
import { ColorInput } from "@mantine/core";

import { normalizeHexColor } from "../../../utils/color";

interface ColorFieldProps {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export const ColorField: React.FC<ColorFieldProps> = ({
  id,
  label,
  value,
  onChange,
  disabled,
  className
}) => (
  <ColorInput
    {...(id !== undefined && id.length > 0 ? { id } : {})}
    className={className}
    label={label}
    value={normalizeHexColor(value)}
    onChange={onChange}
    disabled={disabled}
    format="hex"
    size="sm"
    popoverProps={{ withinPortal: true }}
  />
);
