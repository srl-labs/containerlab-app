import { useCustomNodeCommands } from "../../../hooks/app/useAppHelpers";
import { useIsLocked, useMode, useTopoViewerStore } from "../../../stores/topoViewerStore";
import { PaletteSection } from "./PaletteSection";

export function NodePalette() {
  const mode = useMode();
  const isLocked = useIsLocked();
  const customNodes = useTopoViewerStore((state) => state.customNodes);
  const editCustomTemplate = useTopoViewerStore((state) => state.editCustomTemplate);
  const commands = useCustomNodeCommands(customNodes, editCustomTemplate);

  return (
    <PaletteSection
      mode={mode}
      isLocked={isLocked}
      hideTitle
      onEditCustomNode={commands.onEditCustomNode}
      onDeleteCustomNode={commands.onDeleteCustomNode}
      onSetDefaultCustomNode={commands.onSetDefaultCustomNode}
    />
  );
}
