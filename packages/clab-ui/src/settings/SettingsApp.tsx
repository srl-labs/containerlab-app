import React, { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { SettingsLayout } from "./SettingsLayout";
import { filterSettings, type SettingsFilter } from "./settingsFilter";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import SearchIcon from "@mui/icons-material/Search";
import SearchOffIcon from "@mui/icons-material/SearchOff";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import PaletteOutlinedIcon from "@mui/icons-material/PaletteOutlined";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import TerminalIcon from "@mui/icons-material/Terminal";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import { type SettingsNavigationItem } from "./SettingsNavigation";
import { floatingRadius } from "../theme/surfaces";
import { MONO_FONT_FAMILY } from "../theme/typography";
import { SettingCard } from "./SettingCard";
import { LabHostsPanel } from "./LabHostsPanel";
import { ExtensionLabHostPage, extensionLabHosts } from "./ExtensionLabHostPage";
import { ADD_HOST_PAGE, hostPageId, hostPageKey, labHostNavigationItems } from "./labHostEntries";
import { LAB_HOST_KIND_LABELS, labHostKind } from "../workspace/endpoints";
import type {
  SettingsChange,
  SettingsSnapshot,
  SettingsTarget,
} from "./schema";

/** Searches that should lead to the Lab Hosts page instead of raw settings. */
const LAB_HOSTS_SEARCH =
  /\b(lab ?hosts?|hosts?|servers?|connections?|clab-api|sign|local|runtime|socket|binary|kube\w*|namespaces?|timeout|edgeshark|packetflix|docker|podman|this computer)\b/i;
const CATEGORIES: SettingsNavigationItem[] = [
  {
    key: "general",
    label: "General",
    description: "Your Containerlab environment",
    icon: <SettingsOutlinedIcon fontSize="small" />,
    group: "App",
  },
  {
    key: "appearance",
    label: "Appearance",
    description: "Make yourself at home",
    icon: <PaletteOutlinedIcon fontSize="small" />,
    group: "App",
  },
  {
    key: "topology",
    label: "Topology editor",
    description: "Canvas and node templates",
    icon: <AccountTreeOutlinedIcon fontSize="small" />,
    group: "App",
  },
  {
    key: "terminal",
    label: "Terminal",
    description: "Shells, SSH, and node actions",
    icon: <TerminalIcon fontSize="small" />,
    group: "App",
  },
  {
    key: "capture",
    label: "Capture",
    description: "Wireshark on this computer, for every lab host",
    icon: <HubOutlinedIcon fontSize="small" />,
    group: "App",
  },
  {
    key: "about",
    label: "About",
    description: "Versions and settings details",
    icon: <InfoOutlinedIcon fontSize="small" />,
    group: "Other",
  },
];
export function SettingsApp({
  initial,
  request,
  subscribe,
}: {
  initial: SettingsSnapshot;
  request: (payload: Record<string, unknown>) => Promise<SettingsSnapshot>;
  subscribe: (listener: (snapshot: SettingsSnapshot) => void) => () => void;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [category, setCategory] = useState(initial.category ?? "general");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SettingsFilter>("all");
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(() => new Set());
  const [pendingTarget, setPendingTarget] = useState<SettingsTarget>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(
    () =>
      subscribe((next) => {
        // The extension opens a page, e.g. Lab Hosts from the explorer.
        if (next.category !== undefined) {
          setCategory(next.category);
          setSearch("");
        }
        setSnapshot((current) =>
          next.target === current.target ? next : current,
        );
      }),
    [subscribe],
  );
  /** Lab host actions answer with the new settings; health stats with metrics. */
  const labHostsRequest = useCallback(
    async (payload: Record<string, unknown>): Promise<unknown> => {
      const result: unknown = await request(payload);
      if (
        typeof result === "object" &&
        result !== null &&
        "definitions" in result
      ) {
        setSnapshot(result as SettingsSnapshot);
      }
      return result;
    },
    [request],
  );
  const onDirty = useCallback(
    (key: string, dirty: boolean) =>
      setDirtyKeys((current) => {
        if (current.has(key) === dirty) return current;
        const next = new Set(current);
        if (dirty) next.add(key);
        else next.delete(key);
        return next;
      }),
    [],
  );
  const onSave = async (change: SettingsChange) => {
    const next = await request({ action: "change", change });
    setSnapshot(next);
  };
  const refresh = async () => {
    setSnapshot(await request({ action: "read", target: snapshot.target }));
  };
  const action = async (name: string) => {
    try {
      await request({ action: name });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const changeTarget = async (target: SettingsTarget) => {
    setBusy(true);
    setError("");
    try {
      setSnapshot(await request({ action: "read", target }));
      setDirtyKeys(new Set());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
      setPendingTarget(undefined);
    }
  };
  const query = search.trim().toLowerCase();
  const labHosts = snapshot.labHosts;
  // Lab hosts have their own page; their raw settings stay out of the lists.
  const definitions = labHosts
    ? snapshot.definitions.filter(
        (definition) => definition.category !== "labHosts",
      )
    : snapshot.definitions;
  const hosts = labHosts ? extensionLabHosts(labHosts) : [];
  // The app's categories that have settings, the lab hosts, then About.
  const appCategories = CATEGORIES.filter(
    (item) => item.key === "about" || definitions.some((definition) => definition.category === item.key),
  );
  const navigation = labHosts
    ? [
        ...appCategories.filter((item) => item.key !== "about"),
        ...labHostNavigationItems(hosts),
        ...appCategories.filter((item) => item.key === "about"),
      ]
    : appCategories;
  // "Lab Hosts" of earlier builds and commands: "Add lab host" when asked to add, else the first host.
  let page = category;
  if (category === "labHosts") {
    page = labHosts?.add !== undefined || hosts.length === 0 ? ADD_HOST_PAGE : hostPageKey(hosts[0].id);
  }
  const pageHostId = hostPageId(page);
  const onLabHostPage =
    labHosts !== undefined && (page === ADD_HOST_PAGE || pageHostId !== undefined);
  const showLabHosts = onLabHostPage && query.length === 0 && filter === "all";
  const { visible, currentModified, allModified } = filterSettings(
    definitions,
    snapshot.values,
    page,
    search,
    filter,
  );
  const active =
    navigation.find((item) => item.key === page) ?? CATEGORIES[0];
  const showAllCategories =
    filter === "modified-all" || (query.length > 0 && filter === "all");
  let title = active.label;
  let description = active.description;
  const pageHost = hosts.find((host) => host.id === pageHostId);
  if (pageHost) description = `${LAB_HOST_KIND_LABELS[labHostKind(pageHost)]} · settings for labs on this lab host`;
  if (query.length > 0) {
    title = "Search results";
    description = `${visible.length} settings match “${search.trim()}”`;
  }
  if (filter === "modified-all") {
    title = "All modified settings";
    description = `${visible.length} overrides across all categories · ${snapshot.target === "user" ? "User" : "Workspace"}`;
  }
  const categories = navigation.map((item) => {
    let count: number | undefined = definitions.filter(
      (definition) => definition.category === item.key,
    ).length;
    if (item.key === "about") count = undefined;
    if (item.group === "Lab hosts") count = undefined;
    return { ...item, count };
  });
  return (
    <>
      <SettingsLayout
        items={categories}
        active={page}
        onSelect={(key) => {
          setCategory(key);
          setSearch("");
          if (filter === "modified-all") setFilter("modified-view");
        }}
        sectionTitle={title}
        sectionDescription={description}
        headerActions={
          <Button
            variant="text"
            size="small"
            endIcon={<OpenInNewIcon />}
            onClick={() => {
              void action("native");
            }}
            sx={{
              color: "text.secondary",
              "&:hover": { color: "text.primary" },
            }}
          >
            VS Code settings
          </Button>
        }
        toolbar={
          <Stack spacing={1}>
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                fullWidth
                placeholder="Search all settings…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                slotProps={{
                  htmlInput: { "aria-label": "Search settings" },
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon sx={{ fontSize: 18 }} />
                      </InputAdornment>
                    ),
                  },
                }}
              />
              {showLabHosts ? null : (
                <TextField
                  select
                  size="small"
                  value={snapshot.target}
                  disabled={busy}
                  slotProps={{
                    select: {
                      inputProps: { "aria-label": "Save settings to" },
                    },
                  }}
                  onChange={(event) => {
                    const target = event.target.value as SettingsTarget;
                    if (dirtyKeys.size) setPendingTarget(target);
                    else void changeTarget(target);
                  }}
                  sx={{ minWidth: 128 }}
                >
                  <MenuItem value="user">User</MenuItem>
                  <MenuItem
                    value="workspace"
                    disabled={!snapshot.workspaceAvailable}
                  >
                    Workspace
                  </MenuItem>
                </TextField>
              )}
            </Stack>
            {showLabHosts ? null : (
              <ToggleButtonGroup
                value={filter}
                exclusive
                size="small"
                aria-label="Filter settings"
                onChange={(_, next: SettingsFilter | null) => {
                  if (next !== null) setFilter(next);
                }}
                sx={{ alignSelf: "flex-start", maxWidth: "100%" }}
              >
                <ToggleButton value="all">All in view</ToggleButton>
                <ToggleButton
                  value="modified-view"
                  aria-label={`Modified in this view: ${currentModified}`}
                >
                  Modified in view{" "}
                  <Box
                    component="span"
                    sx={{
                      color: "text.secondary",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {currentModified}
                  </Box>
                </ToggleButton>
                <ToggleButton
                  value="modified-all"
                  aria-label={`Modified across all settings: ${allModified}`}
                >
                  All modified{" "}
                  <Box
                    component="span"
                    sx={{
                      color: "text.secondary",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {allModified}
                  </Box>
                </ToggleButton>
              </ToggleButtonGroup>
            )}
          </Stack>
        }
        sectionActions={
          page === "appearance" && !showAllCategories ? (
            <Button
              size="small"
              variant="text"
              startIcon={<PaletteOutlinedIcon />}
              onClick={() => {
                void action("colorTheme");
              }}
            >
              VS Code theme
            </Button>
          ) : undefined
        }
        navigationFooter={
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              display: "block",
              overflowWrap: "anywhere",
            }}
          >
            {snapshot.workspaceName ?? "Containerlab"}
            <br />
            {snapshot.remoteName
              ? `Remote · ${snapshot.remoteName}`
              : "Local session"}{" "}
            · v{snapshot.version}
          </Typography>
        }
        footer={
          <>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <CheckCircleOutlineIcon
                sx={{
                  fontSize: 14,
                  color: dirtyKeys.size ? "text.secondary" : "success.main",
                }}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                role="status"
              >
                {dirtyKeys.size
                  ? `${dirtyKeys.size} unsaved ${dirtyKeys.size === 1 ? "setting" : "settings"}`
                  : "All changes saved"}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {definitions.length} settings ·{" "}
              {snapshot.target === "user" ? "User" : "Workspace"}
            </Typography>
          </>
        }
      >
        {error && (
          <Alert severity="error" onClose={() => setError("")}>
            {error}
          </Alert>
        )}
        {snapshot.reloadRequired && (
          <Alert
            severity="info"
            action={
              <Button
                variant="text"
                size="small"
                onClick={() => {
                  void action("reload");
                }}
              >
                Reload window
              </Button>
            }
          >
            Runtime settings changed. Reload VS Code to apply them.
          </Alert>
        )}
        <Box key={snapshot.target} hidden={visible.length === 0}>
          {CATEGORIES.filter((item) => item.key !== "about").map((item) => {
            const categoryDefinitions = definitions.filter(
              (definition) => definition.category === item.key,
            );
            const hasVisible = categoryDefinitions.some((definition) =>
              visible.includes(definition),
            );
            return (
              <Box
                key={item.key}
                hidden={!hasVisible}
                sx={{ mb: showAllCategories ? 3 : 0 }}
              >
                {showAllCategories && (
                  <Typography
                    component="h3"
                    variant="overline"
                    sx={{ display: "block", mb: 1, color: "text.secondary" }}
                  >
                    {item.label}
                  </Typography>
                )}
                <Box
                  sx={{
                    display: "grid",
                    rowGap: 2,
                    // Visible rows read as one list, split by hairlines.
                    "& > div:not([hidden]) ~ div:not([hidden]) > [data-settings-row]":
                      { pt: 2, borderTop: 1, borderColor: "divider" },
                  }}
                >
                  {categoryDefinitions.map((definition) => (
                    <Box
                      key={definition.key}
                      hidden={!visible.includes(definition)}
                    >
                      <SettingCard
                        definition={definition}
                        current={snapshot.values[definition.key]}
                        target={snapshot.target}
                        onSave={onSave}
                        onDirty={onDirty}
                        onRefresh={refresh}
                      />
                    </Box>
                  ))}
                </Box>
              </Box>
            );
          })}
        </Box>
        {query.length > 0 && labHosts && LAB_HOSTS_SEARCH.test(query) && (
          <Alert
            severity="info"
            sx={{ mb: 2 }}
            action={
              <Button
                variant="text"
                size="small"
                onClick={() => {
                  setCategory(hosts.length > 0 ? hostPageKey(hosts[0].id) : ADD_HOST_PAGE);
                  setSearch("");
                  setFilter("all");
                }}
              >
                Open Lab hosts
              </Button>
            }
          >
            Settings that depend on where labs run are on each lab host&apos;s page, under Lab hosts in the menu.
          </Alert>
        )}
        {showLabHosts && labHosts && page === ADD_HOST_PAGE && (
          <LabHostsPanel labHosts={labHosts} request={labHostsRequest} />
        )}
        {showLabHosts && labHosts && pageHostId !== undefined && (
          <ExtensionLabHostPage key={pageHostId} labHosts={labHosts} hostId={pageHostId} request={labHostsRequest} />
        )}
        {!visible.length &&
          !showLabHosts &&
          (query || page !== "about" || filter !== "all") && (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 0.75,
                textAlign: "center",
                py: 6,
              }}
            >
              <SearchOffIcon
                sx={{
                  fontSize: 22,
                  color: "var(--vscode-icon-foreground)",
                  opacity: 0.7,
                }}
              />
              <Typography variant="subtitle1">No matching settings</Typography>
              <Typography variant="body2" color="text.secondary">
                Try another search or change the Modified filter.
              </Typography>
              <Button
                variant="outlined"
                size="small"
                sx={{ mt: 1 }}
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
              >
                Clear filters
              </Button>
            </Box>
          )}
        {!query && page === "about" && filter === "all" && (
          <Box sx={{ display: "grid", gap: 1.5 }}>
            <Typography component="h3" variant="subtitle1">
              Containerlab for VS Code
            </Typography>
            <Box
              component="dl"
              sx={{
                m: 0,
                border: 1,
                borderColor: "divider",
                borderRadius: floatingRadius,
              }}
            >
              {[
                ["Extension", snapshot.version],
                ["VS Code", snapshot.vscodeVersion],
              ].map(([label, value]) => (
                <Box
                  key={label}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "160px minmax(0, 1fr)",
                    columnGap: 2,
                    px: 1.5,
                    py: 1.25,
                    "&:not(:last-child)": {
                      borderBottom: 1,
                      borderColor: "divider",
                    },
                  }}
                >
                  <Typography
                    component="dt"
                    variant="body2"
                    color="text.secondary"
                  >
                    {label}
                  </Typography>
                  <Typography
                    component="dd"
                    sx={{ m: 0, fontFamily: MONO_FONT_FAMILY, fontSize: 12 }}
                  >
                    {value}
                  </Typography>
                </Box>
              ))}
            </Box>
            <Typography variant="body2" color="text.secondary">
              All {definitions.length} Settings stay in sync with VS Code. User settings apply to this session, Workspace settings to the open workspace. Reset removes an override.
            </Typography>
          </Box>
        )}
      </SettingsLayout>
      <Dialog
        open={Boolean(pendingTarget)}
        onClose={() => setPendingTarget(undefined)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Discard unsaved changes?</DialogTitle>
        <DialogContent>
          Your drafts belong to this scope. Save or discard them to switch.
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setPendingTarget(undefined)}>
            Keep editing
          </Button>
          <Button
            onClick={() => {
              if (pendingTarget) void changeTarget(pendingTarget);
            }}
            disabled={busy}
          >
            Discard and switch
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
