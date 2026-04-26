import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { App, useTopoViewerStore } from "@srl-labs/clab-ui";
import {
  createApiClabUiHost,
  createClabUiRuntime
} from "@srl-labs/clab-ui/host";
import { applyThemeVars, MuiThemeProvider } from "@srl-labs/clab-ui/theme";
import {
  EXPORT_COMMANDS,
  MSG_CANCEL_LAB_LIFECYCLE,
  MSG_FIT_VIEWPORT,
  MSG_SVG_EXPORT_RESULT,
  parseSchemaData,
  type TopologySnapshot,
  type TopologyRef
} from "@srl-labs/clab-ui/session";

export {
  App,
  EXPORT_COMMANDS,
  MSG_CANCEL_LAB_LIFECYCLE,
  MSG_FIT_VIEWPORT,
  MSG_SVG_EXPORT_RESULT,
  MuiThemeProvider,
  applyThemeVars,
  createApiClabUiHost,
  createClabUiRuntime,
  createPortal,
  createRoot,
  parseSchemaData,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTopoViewerStore,
  type ReactRoot,
  type TopologyRef,
  type TopologySnapshot
};
