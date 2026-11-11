import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { useWorkspaceViewStore } from "./workspaceViewStore";

beforeEach(() => {
  useWorkspaceViewStore.setState({ documentView: "editor", overviewOpen: false });
});

test("the editor is the default document view", () => {
  const state = useWorkspaceViewStore.getState();
  assert.equal(state.documentView, "editor");
  assert.equal(state.overviewOpen, false);
});

test("setOverviewOpen(true) shows the overview", () => {
  useWorkspaceViewStore.getState().setOverviewOpen(true);
  const state = useWorkspaceViewStore.getState();
  assert.equal(state.documentView, "overview");
  assert.equal(state.overviewOpen, true);
});

test("setDocumentView('images') keeps overviewOpen false", () => {
  useWorkspaceViewStore.getState().setDocumentView("images");
  const state = useWorkspaceViewStore.getState();
  assert.equal(state.documentView, "images");
  assert.equal(state.overviewOpen, false);
});

test("setDocumentView('overview') from images sets overviewOpen", () => {
  useWorkspaceViewStore.getState().setDocumentView("images");
  useWorkspaceViewStore.getState().setDocumentView("overview");
  assert.equal(useWorkspaceViewStore.getState().overviewOpen, true);
});

test("setOverviewOpen(false) from images shows the editor", () => {
  useWorkspaceViewStore.getState().setDocumentView("images");
  useWorkspaceViewStore.getState().setOverviewOpen(false);
  const state = useWorkspaceViewStore.getState();
  assert.equal(state.documentView, "editor");
  assert.equal(state.overviewOpen, false);
});

test("setting the current view does not change the state object", () => {
  const before = useWorkspaceViewStore.getState();
  before.setDocumentView("editor");
  before.setOverviewOpen(false);
  assert.equal(useWorkspaceViewStore.getState(), before);
});
