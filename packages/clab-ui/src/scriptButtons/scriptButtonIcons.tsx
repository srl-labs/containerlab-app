import type React from "react";
import BoltIcon from "@mui/icons-material/Bolt";
import BugReportOutlinedIcon from "@mui/icons-material/BugReportOutlined";
import BuildOutlinedIcon from "@mui/icons-material/BuildOutlined";
import CleaningServicesOutlinedIcon from "@mui/icons-material/CleaningServicesOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import RefreshIcon from "@mui/icons-material/Refresh";
import RocketLaunchOutlinedIcon from "@mui/icons-material/RocketLaunchOutlined";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import TerminalIcon from "@mui/icons-material/Terminal";
import type { SvgIconProps } from "@mui/material/SvgIcon";

/** Icons a script button can show, by the key stored in the annotations file. */
export const SCRIPT_BUTTON_ICONS: ReadonlyArray<{
  value: string;
  label: string;
  Icon: React.ComponentType<SvgIconProps>;
}> = [
  { value: "play", label: "Play", Icon: PlayArrowRoundedIcon },
  { value: "terminal", label: "Terminal", Icon: TerminalIcon },
  { value: "refresh", label: "Refresh", Icon: RefreshIcon },
  { value: "bolt", label: "Bolt", Icon: BoltIcon },
  { value: "rocket", label: "Rocket", Icon: RocketLaunchOutlinedIcon },
  { value: "build", label: "Build", Icon: BuildOutlinedIcon },
  { value: "stop", label: "Stop", Icon: StopRoundedIcon },
  { value: "clean", label: "Clean up", Icon: CleaningServicesOutlinedIcon },
  { value: "upload", label: "Upload", Icon: CloudUploadOutlinedIcon },
  { value: "bug", label: "Debug", Icon: BugReportOutlinedIcon }
];

/** The icon for a stored key; unknown or missing keys show Play. */
export function scriptButtonIcon(key: string | undefined): React.ComponentType<SvgIconProps> {
  return (SCRIPT_BUTTON_ICONS.find((entry) => entry.value === key) ?? SCRIPT_BUTTON_ICONS[0]).Icon;
}
