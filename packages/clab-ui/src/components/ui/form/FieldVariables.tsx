// Variable previews and magic variable suggestions for topology form fields.
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import MenuItem from "@mui/material/MenuItem";
import MenuList from "@mui/material/MenuList";
import Paper from "@mui/material/Paper";
import Popper from "@mui/material/Popper";
import Typography from "@mui/material/Typography";

import { MAGIC_VARIABLES, magicVariableValues, type MagicVariable } from "../../../host/topologyVariables";
import { useTopoViewerStore } from "../../../stores/topoViewerStore";
import { MONO_FONT_FAMILY } from "../../../theme/typography";

import { describeFieldVariables, type FieldVariableScope } from "./fieldVariablePreview";

const FieldVariablesContext = createContext<FieldVariableScope | null>(null);

/**
 * Turns on variable previews for the form fields inside: environment
 * variables everywhere, magic variables in fields that opt in. Nested
 * providers add the node the fields belong to.
 */
export const FieldVariablesProvider: React.FC<{ nodeName?: string; children: React.ReactNode }> = ({
  nodeName,
  children
}) => {
  const parent = useContext(FieldVariablesContext);
  const labName = useTopoViewerStore((state) => state.labName);
  const variables = useTopoViewerStore((state) => state.topologyVariables);
  const scope = useMemo<FieldVariableScope>(
    () => ({ labName, variables, nodeName: nodeName ?? parent?.nodeName }),
    [labName, variables, nodeName, parent?.nodeName]
  );
  return <FieldVariablesContext.Provider value={scope}>{children}</FieldVariablesContext.Provider>;
};

/** The resolved-value preview of a field, when it uses variables inside a provider. */
export function useFieldVariablePreview(value: string, magicVariables: boolean): string | undefined {
  const scope = useContext(FieldVariablesContext);
  return useMemo(
    () => (scope ? describeFieldVariables(value, scope, magicVariables) : undefined),
    [scope, value, magicVariables]
  );
}

/** The `__clab...` token being typed before the caret, if any. */
function typedToken(value: string, caret: number): { start: number; prefix: string } | undefined {
  // A token starts after a separator, so the closing `__` of a typed one does not count.
  const match = /(?:^|[^A-Za-z0-9_])(__[A-Za-z]*)$/.exec(value.slice(0, caret));
  if (!match) return undefined;
  const prefix = match[1];
  return { start: caret - prefix.length, prefix };
}

interface MagicVariableAutocomplete {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onSelect: () => void;
  onBlur: () => void;
  suggestions: React.ReactNode;
}

/**
 * Suggests containerlab's magic variables while one is typed (`__`), with
 * the value each has for the node. Arrow keys pick, Enter or Tab inserts.
 */
export function useMagicVariableAutocomplete(options: {
  enabled: boolean;
  id: string;
  value: string;
  onChange: (value: string) => void;
}): MagicVariableAutocomplete {
  const { enabled, id, value, onChange } = options;
  const scope = useContext(FieldVariablesContext);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<HTMLInputElement | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const token = enabled && caret !== null ? typedToken(value, caret) : undefined;
  const matches = useMemo(
    () =>
      token
        ? MAGIC_VARIABLES.filter(
            (variable) =>
              variable.token.toLowerCase().startsWith(token.prefix.toLowerCase()) &&
              variable.token !== token.prefix &&
              (!variable.perNode || scope?.nodeName !== undefined)
          )
        : [],
    [token, scope?.nodeName]
  );
  const open = !dismissed && matches.length > 0 && anchor !== null;
  const values = useMemo(
    () =>
      scope
        ? magicVariableValues({
            labName: scope.labName,
            nodeName: scope.nodeName,
            topologyDir: scope.variables?.topologyDir,
            env: scope.variables?.env
          })
        : {},
    [scope]
  );

  const onSelect = useCallback(() => {
    setAnchor(inputRef.current);
    setCaret(inputRef.current?.selectionStart ?? null);
    setDismissed(false);
  }, []);

  const insert = useCallback(
    (variable: MagicVariable) => {
      if (!token || caret === null) return;
      const next = value.slice(0, token.start) + variable.token + value.slice(caret);
      const nextCaret = token.start + variable.token.length;
      onChange(next);
      setCaret(nextCaret);
      setHighlight(0);
      requestAnimationFrame(() => inputRef.current?.setSelectionRange(nextCaret, nextCaret));
    },
    [caret, onChange, token, value]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (!open) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setHighlight((current) => (current + step + matches.length) % matches.length);
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insert(matches[Math.min(highlight, matches.length - 1)]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDismissed(true);
      }
    },
    [highlight, insert, matches, open]
  );

  const onBlur = useCallback(() => setCaret(null), []);

  const suggestions = open ? (
    <Popper
      open
      anchorEl={anchor}
      placement="bottom-start"
      sx={{ zIndex: (theme) => theme.zIndex.modal + 1 }}
    >
      <ClickAwayListener onClickAway={() => setDismissed(true)}>
        <Paper elevation={6}>
          <MenuList dense data-testid={`${id}-magic-variables`} aria-label="Magic variables">
            {matches.map((variable, index) => (
              <MenuItem
                key={variable.token}
                selected={index === Math.min(highlight, matches.length - 1)}
                // Keep the focus in the input while picking.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insert(variable)}
                sx={{ display: "block" }}
              >
                <Typography variant="body2" sx={{ fontFamily: MONO_FONT_FAMILY }}>
                  {variable.token}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                  {values[variable.token] ?? variable.description}
                </Typography>
              </MenuItem>
            ))}
          </MenuList>
        </Paper>
      </ClickAwayListener>
    </Popper>
  ) : null;

  return { inputRef, onKeyDown, onSelect, onBlur, suggestions };
}
