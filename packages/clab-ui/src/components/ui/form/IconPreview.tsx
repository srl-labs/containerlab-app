// Icon preview with configurable corner radius.
import { Avatar } from "@mantine/core";
import type { FC } from "react";

interface IconPreviewProps {
  src: string;
  alt?: string;
  size: number;
  cornerRadius?: number;
}

export const IconPreview: FC<IconPreviewProps> = ({ src, alt = "", size, cornerRadius }) => (
  <Avatar
    src={src}
    alt={alt}
    w={size}
    h={size}
    radius={cornerRadius !== undefined && cornerRadius > 0 ? (cornerRadius / 48) * size : 0}
  />
);
