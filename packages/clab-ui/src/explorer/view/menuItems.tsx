import SettingsEthernetIcon from "@mui/icons-material/SettingsEthernet";
import type { ContextMenuItem } from "../../components/context-menu/ContextMenu";
import type { ExplorerAction } from "../shared/explorer/types";
import {
  type ActionGroupId,
  type ExplorerActionGroup,
  type ExplorerNodeKind,
  type SharingBucket,
  actionGroupIcon,
  actionIcon,
  groupActions,
  isInterfaceTimingAction,
  withSectionDividers
} from "./actionPresentation";
import { isEndpointNode } from "./nodeState";

export function toContextMenuItem(
  action: ExplorerAction,
  onInvokeAction: (action: ExplorerAction) => void
): ContextMenuItem {
  const ActionIcon = actionIcon(action);
  return {
    id: action.id,
    label: action.label,
    icon: <ActionIcon fontSize="small" />,
    danger: Boolean(action.destructive),
    disabled: action.disabled,
    onClick: () => onInvokeAction(action)
  };
}

function sharingBucketForCommand(commandId: string): SharingBucket {
  const command = commandId.toLowerCase();
  if (command.includes(".sshx.")) {
    return "sshx";
  }
  if (command.includes(".gotty.")) {
    return "gotty";
  }
  return "other";
}

function buildSharingGroupChildren(
  actions: ExplorerAction[],
  groupId: ActionGroupId,
  onInvokeAction: (action: ExplorerAction) => void
): ContextMenuItem[] {
  const sharingChildren: ContextMenuItem[] = [];
  let previousBucket: SharingBucket | null = null;

  for (const action of actions) {
    const bucket = sharingBucketForCommand(action.commandId);
    if (sharingChildren.length > 0 && previousBucket !== null && bucket !== previousBucket) {
      sharingChildren.push({
        id: `group:${groupId}:divider:${action.id}`,
        label: "",
        divider: true
      });
    }
    sharingChildren.push(toContextMenuItem(action, onInvokeAction));
    previousBucket = bucket;
  }

  return sharingChildren;
}

function toGroupMenuItem(
  group: ExplorerActionGroup,
  onInvokeAction: (action: ExplorerAction) => void
): ContextMenuItem {
  if (group.actions.length === 1) {
    return toContextMenuItem(group.actions[0], onInvokeAction);
  }

  const GroupIcon = actionGroupIcon(group.id);
  const children =
    group.id === "sharing"
      ? buildSharingGroupChildren(group.actions, group.id, onInvokeAction)
      : group.actions.map((action) => toContextMenuItem(action, onInvokeAction));

  return {
    id: `group:${group.id}`,
    label: group.label,
    icon: <GroupIcon fontSize="small" />,
    children
  };
}

function toGroupMenuItems(
  group: ExplorerActionGroup,
  onInvokeAction: (action: ExplorerAction) => void
): ContextMenuItem[] {
  if (group.id === "lifecycle") {
    return group.actions.map((action) => toContextMenuItem(action, onInvokeAction));
  }
  return [toGroupMenuItem(group, onInvokeAction)];
}

function buildInterfaceMenuItems(
  actions: ExplorerAction[],
  onInvokeAction: (action: ExplorerAction) => void
): ContextMenuItem[] {
  const interfaceItems: ContextMenuItem[] = [];
  let inTimingGroup = false;
  for (const action of actions) {
    const commandId = action.commandId.toLowerCase();
    const isTimingAction = isInterfaceTimingAction(commandId);

    if (isTimingAction && !inTimingGroup && interfaceItems.length > 0) {
      interfaceItems.push({
        id: `group:interface:timing-start:${action.id}`,
        label: "",
        divider: true
      });
    }
    if (!isTimingAction && inTimingGroup) {
      interfaceItems.push({
        id: `group:interface:timing-end:${action.id}`,
        label: "",
        divider: true
      });
    }

    interfaceItems.push(toContextMenuItem(action, onInvokeAction));
    inTimingGroup = isTimingAction;
  }

  return interfaceItems;
}

const ENDPOINT_ROOT_MENU_COMMANDS = [
  "containerlab.editor.topoViewerEditor",
  "containerlab.lab.cloneRepo",
  "containerlab.endpoint.reconnect",
  "containerlab.endpoint.copyUrl",
  "containerlab.endpoint.remove"
] as const;

const ENDPOINT_CAPTURE_MENU_COMMANDS = [
  "containerlab.install.edgeshark",
  "containerlab.uninstall.edgeshark",
  "containerlab.capture.killAllWiresharkVNC",
  "containerlab.set.sessionHostname"
] as const;

function findActionByCommandId(
  actions: readonly ExplorerAction[],
  commandId: string
): ExplorerAction | undefined {
  return actions.find((action) => action.commandId === commandId);
}

function buildEndpointMenuItems(
  actions: ExplorerAction[],
  onInvokeAction: (action: ExplorerAction) => void
): ContextMenuItem[] {
  const groupedCommandIds = new Set<string>([
    ...ENDPOINT_ROOT_MENU_COMMANDS,
    ...ENDPOINT_CAPTURE_MENU_COMMANDS
  ]);
  const rootItems = ENDPOINT_ROOT_MENU_COMMANDS.map((commandId) =>
    findActionByCommandId(actions, commandId)
  )
    .filter((action): action is ExplorerAction => Boolean(action))
    .map((action) => toContextMenuItem(action, onInvokeAction));
  const extraEndpointItems = actions
    .filter((action) => !groupedCommandIds.has(action.commandId))
    .map((action) => toContextMenuItem(action, onInvokeAction));
  const captureItems = ENDPOINT_CAPTURE_MENU_COMMANDS.map((commandId) =>
    findActionByCommandId(actions, commandId)
  )
    .filter((action): action is ExplorerAction => Boolean(action))
    .map((action) => toContextMenuItem(action, onInvokeAction));

  if (captureItems.length === 0) {
    return [...rootItems, ...extraEndpointItems];
  }

  return [
    ...rootItems,
    ...extraEndpointItems,
    {
      id: "group:endpoint:capture",
      label: "Capture",
      icon: <SettingsEthernetIcon fontSize="small" />,
      children: captureItems
    }
  ];
}

export function buildNodeContextMenuItems(
  menuActions: ExplorerAction[],
  nodeKind: ExplorerNodeKind,
  contextValue: string | undefined,
  onInvokeAction: (action: ExplorerAction) => void
): ContextMenuItem[] {
  if (isEndpointNode(contextValue)) {
    return buildEndpointMenuItems(menuActions, onInvokeAction);
  }

  if (nodeKind === "interface") {
    return buildInterfaceMenuItems(menuActions, onInvokeAction);
  }

  const groupedActions = groupActions(menuActions, nodeKind);
  if (nodeKind === "file") {
    return withSectionDividers(groupedActions, nodeKind, (group) =>
      group.actions.map((action) => toContextMenuItem(action, onInvokeAction))
    );
  }

  return withSectionDividers(groupedActions, nodeKind, (group) =>
    toGroupMenuItems(group, onInvokeAction)
  );
}

export function filterNodeMenuActions(
  nodeActions: ExplorerAction[],
  nodeKind: ExplorerNodeKind
): ExplorerAction[] {
  if (nodeKind !== "lab") {
    return nodeActions;
  }
  return nodeActions.filter(
    (action) => action.commandId.toLowerCase() !== "containerlab.lab.graph.topoviewer"
  );
}
