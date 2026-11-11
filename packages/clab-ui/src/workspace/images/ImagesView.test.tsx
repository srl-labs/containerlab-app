import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider, createTheme } from "@mui/material/styles";

import { ImageDetails, TemplateDetails, type RecordActions } from "./ImageDetails";
import { NO_FILTERS, SearchBar, SearchResults } from "./ImageSearch";
import { UnavailablePanel } from "./imagesUi";
import { ImagesView } from "./ImagesView";
import { sortJobs } from "./imagesModel";
import { JobsPanel } from "./JobsPanel";
import { TemplateList } from "./TemplateList";
import type { ImageRecord, ImagesJob, ImagesTemplate } from "./types";

const render = (node: React.ReactElement): string => renderToStaticMarkup(<ThemeProvider theme={createTheme()}>{node}</ThemeProvider>);
const noop = () => undefined;

// ImagesView.tsx:58 calls useSyncExternalStore without getServerSnapshot, so any server render
// throws "Missing getServerSnapshot". Marked todo until the source passes one.

test("UnavailablePanel lists the configuration keys", () => {
  const html = render(<UnavailablePanel info={{ reason: "unavailable", detail: "d", configKeys: ["A_KEY", "B_KEY"] }} />);
  assert.equal(html.match(/data-testid="images-config-key"/g)?.length, 2);
  assert.match(html, /The image manager is not configured/);
});

test("ImagesView explains a missing configuration with its settings and no controls", () => {
  const html = render(
    <ImagesView
      unavailable={{
        reason: "unavailable",
        detail: "The image manager is not configured on this server.",
        configKeys: ["WEB_LOCAL_CLIMG_PATH", "WEB_LOCAL_CLIMG_CONFIG"]
      }}
    />
  );
  assert.match(html, /data-testid="images-unavailable"/);
  assert.equal(html.match(/data-testid="images-config-key"/g)?.length, 2);
  assert.match(html, /WEB_LOCAL_CLIMG_PATH/);
  assert.match(html, /WEB_LOCAL_CLIMG_CONFIG/);
  assert.doesNotMatch(html, /images-search-input|images-upload-button|images-pull-button/);
});

test("ImagesView without config keys says images are not available here", () => {
  const html = render(<ImagesView unavailable={{ reason: "unavailable", detail: "A remote lab host has no local image folder." }} />);
  assert.match(html, /data-testid="images-unavailable"/);
  assert.doesNotMatch(html, /images-config-key/);
  assert.match(html, /Images are not available here/);
});

const baseJob = (fields: Partial<ImagesJob>): ImagesJob => ({
  id: "j",
  op: "pull",
  state: "running",
  phase: "download",
  pct: null,
  message: "",
  log: [],
  startedAt: "2024-01-01T10:00:00Z",
  updatedAt: "2024-01-01T10:00:00Z",
  ...fields
});

test("JobsPanel offers cancel only for active jobs and tails the log", () => {
  const html = render(
    <JobsPanel
      onCancel={noop}
      jobs={[
        baseJob({ id: "1", ref: "labhub:a", pct: 42, log: ["line1", "line2", "line3", "line4", "line5", "line6"] }),
        baseJob({ id: "2", op: "build", file: "b.qcow2", state: "failed", error: "build failed" }),
        baseJob({ id: "3", op: "add", ref: "c", state: "succeeded", message: "ok" })
      ]}
    />
  );
  assert.equal(html.match(/data-testid="images-job-cancel"/g)?.length, 1);
  for (const state of ["running", "failed", "succeeded"]) assert.match(html, new RegExp(`data-state="${state}"`));
  assert.match(html, /42 %/);
  assert.match(html, /line3\nline4\nline5\nline6/);
  assert.doesNotMatch(html, /line1|line2/);
  assert.match(html, /build failed/);
});

test("JobsPanel disables Cancel and says Finishing for a job that already exited", () => {
  const html = render(<JobsPanel onCancel={noop} finishing={["1"]} jobs={[baseJob({ id: "1", ref: "labhub:a" })]} />);
  assert.match(html, /<button[^>]*disabled=""[^>]*data-testid="images-job-cancel"/);
  assert.match(html, /Finishing…/);
});

const templates: ImagesTemplate[] = [
  { name: "managed-present", kind: "arista_ceos", image: "ceos:1", managed: true, imagePresent: true },
  { name: "managed-missing", kind: "cisco_iol", image: "iol:1", managed: true, imagePresent: false },
  { name: "foreign", kind: "linux", image: "alpine", managed: false, imagePresent: null }
];

test("TemplateList marks presence and managed rows and warns about missing images", () => {
  const html = render(<TemplateList templates={templates} loading={false} onSelect={noop} onSync={noop} />);
  const rows = html.match(/<button[^>]*data-testid="images-template-row"[^>]*>.*?<\/button>/g) ?? [];
  assert.equal(rows.length, 3);
  const [present, missing, foreign] = rows;
  assert.match(present ?? "", /data-managed="true"[^>]*data-present="true"|data-present="true"[^>]*data-managed="true"/);
  assert.match(missing ?? "", /data-present="false"/);
  assert.match(foreign ?? "", /data-managed="false"/);
  assert.match(foreign ?? "", /data-present="unknown"/);
  assert.match(present ?? "", />climg</);
  assert.match(missing ?? "", />climg</);
  assert.doesNotMatch(foreign ?? "", />climg</);
  assert.match(html, /1 template uses an image not on this host/);
});

test("TemplateDetails offers removal only for managed templates and search for missing images", () => {
  const props = { onRemove: noop, onSearchImage: noop, onClose: noop };
  const foreign = render(<TemplateDetails template={templates[2] as ImagesTemplate} {...props} />);
  assert.doesNotMatch(foreign, /images-template-remove/);
  assert.doesNotMatch(foreign, /images-template-find/);
  const managed = render(<TemplateDetails template={templates[0] as ImagesTemplate} {...props} />);
  assert.match(managed, /images-template-remove/);
  assert.doesNotMatch(managed, /images-template-find/);
  const missing = render(<TemplateDetails template={templates[1] as ImagesTemplate} {...props} />);
  assert.match(missing, /images-template-find/);
});

const actions: RecordActions = { onPull: noop, onBuild: noop, onAddTemplate: noop };
const details = (record: ImageRecord, list: ImagesTemplate[], overrides: Partial<RecordActions> = {}): string =>
  render(<ImageDetails record={record} loading={false} templates={list} actions={{ ...actions, ...overrides }} onClose={noop} />);

test("ImageDetails of a built record shows its template and hides the add action", () => {
  const record: ImageRecord = { key: "local:ceos.tar", source: "local", status: "built", kind: "arista_ceos", tag: "ceos:1" };
  const html = details(record, templates);
  assert.match(html, /managed-present/);
  assert.doesNotMatch(html, /images-template-add/);
});

test("ImageDetails of a built record without a template offers to add one", () => {
  const record: ImageRecord = { key: "local:other.tar", source: "local", status: "built", kind: "linux", tag: "other:9" };
  const html = details(record, templates);
  assert.match(html, /images-template-add/);
  assert.match(html, /none yet/);
});

test("ImageDetails disables pull with the blocked reason", () => {
  const record: ImageRecord = { key: "labhub:vios-159-3.M3", source: "labhub", status: "available", kind: "cisco_vios" };
  const html = details(record, [], { pullBlocked: "Host check failed: /dev/kvm (missing)" });
  const button = html.match(/<button[^>]*data-testid="images-pull-button"[^>]*>/)?.[0] ?? "";
  assert.match(button, /disabled/);
  const open = details(record, []);
  assert.doesNotMatch(open.match(/<button[^>]*data-testid="images-pull-button"[^>]*>/)?.[0] ?? "", /disabled/);
});

test("TemplateList marks customized managed templates only, with an explanatory tooltip target", () => {
  const list: ImagesTemplate[] = [
    { name: "edited", kind: "cisco_iol", image: "iol:1", managed: true, customized: true, imagePresent: true },
    { name: "plain", kind: "cisco_iol", image: "iol:2", managed: true, customized: false, imagePresent: true },
    { name: "older-climg", kind: "cisco_iol", image: "iol:3", managed: true, imagePresent: true },
    { name: "foreign", kind: "linux", managed: false, customized: true, imagePresent: null }
  ];
  const html = render(<TemplateList templates={list} loading={false} onSelect={noop} onSync={noop} />);
  const rows = html.match(/<button[^>]*data-testid="images-template-row"[^>]*>.*?<\/button>/g) ?? [];
  assert.equal(rows.length, 4);
  assert.match(rows[0] ?? "", /data-customized="true"/);
  assert.match(rows[0] ?? "", /data-testid="images-template-customized"[^>]*>customized</);
  for (const row of rows.slice(1)) {
    assert.match(row, /data-customized="false"/);
    assert.doesNotMatch(row, /images-template-customized/);
  }
});

test("JobsPanel shows the fields climg kept on the job result line", () => {
  const withKept = baseJob({
    id: "k", op: "pull", ref: "labhub:a", state: "succeeded", message: "ok",
    nodetpl: { name: "tpl-a", written: true, kept: ["interfacePattern", "icon"] }
  });
  const html = render(<JobsPanel onCancel={noop} jobs={[withKept]} />);
  assert.match(html, /Node Template tpl-a written · kept your interfacePattern, icon/);
  const without = render(<JobsPanel onCancel={noop} jobs={[{ ...withKept, nodetpl: { name: "tpl-a", written: true } }]} />);
  assert.match(without, /Node Template tpl-a written</);
  assert.doesNotMatch(without, /kept your/);
});

const h3c: ImageRecord = {
  key: "labhub:h3cvsr1k-7.1.064-R1362P12", source: "labhub", status: "unbuildable", kind: null, name: "h3cvsr1k-7.1.064-R1362P12",
  vendor: "H3C", folder: "H3C/vSR", model: "vSR"
};
const vios: ImageRecord = { key: "labhub:vios", source: "labhub", status: "available", kind: "cisco_vios", vendor: "Cisco", folder: "Cisco/IOSv" };
const results = (records: ImageRecord[]): string =>
  render(<SearchResults records={records} loading={false} filters={NO_FILTERS} onSelect={noop} onClearFilters={noop} />);

test("search results show vendor and folder, and mark entries that are not buildable", () => {
  const html = results([vios, h3c]);
  assert.match(html, /data-testid="images-result-vendor"[^>]*>H3C</);
  assert.match(html, /data-testid="images-result-folder"[^>]*>H3C\/vSR</);
  const rows = html.match(/<tr[^>]*data-testid="images-result-row"[^>]*>.*?<\/tr>/g) ?? [];
  assert.equal(rows.length, 2);
  assert.match(rows[0] ?? "", /data-buildable="true"/);
  assert.match(rows[1] ?? "", /data-buildable="false"/);
  assert.match(rows[1] ?? "", />Not buildable</);
  assert.doesNotMatch(rows[0] ?? "", /Not buildable/);
});

test("a record without vendor or folder (an older climg) shows a dash and no folder line", () => {
  const html = results([{ key: "local:a.qcow2", source: "local", status: "cached", kind: "arista_veos" }]);
  assert.match(html, /data-testid="images-result-vendor"[^>]*>–</);
  assert.doesNotMatch(html, /images-result-folder/);
});

test("ImageDetails of a not buildable entry shows vendor and folder and a disabled Pull with the reason", () => {
  const html = details(h3c, []);
  assert.match(html, /H3C\/vSR/);
  const button = html.match(/<button[^>]*data-testid="images-pull-button"[^>]*>/)?.[0] ?? "";
  assert.match(button, /disabled/);
  assert.match(html, /Not buildable/);
  assert.match(html, /aria-label="No vrnetlab kind exists/);
});

test("the search bar has an Include not buildable switch that is on by default", () => {
  const props = { kinds: [], vendors: ["Cisco", "H3C"], indexBusy: false, onChange: noop, onRefreshIndex: noop };
  const on = render(<SearchBar filters={NO_FILTERS} {...props} />);
  assert.match(on, /<input[^>]*data-testid="images-include-unbuildable"[^>]*>/);
  assert.match(on.match(/<input[^>]*data-testid="images-include-unbuildable"[^>]*>/)?.[0] ?? "", /checked/);
  assert.match(on, /Include not buildable/);
  const off = render(<SearchBar filters={{ ...NO_FILTERS, includeUnbuildable: false }} {...props} />);
  assert.doesNotMatch(off.match(/<input[^>]*data-testid="images-include-unbuildable"[^>]*>/)?.[0] ?? "", /checked/);
  assert.match(off, /Clear/, "turning it off counts as a filter");
});

test("JobsPanel lists the running job first with its log, and queued jobs with their place and an enabled Cancel", () => {
  const html = render(
    <JobsPanel
      onCancel={noop}
      jobs={sortJobs([
        baseJob({ id: "q2", ref: "labhub:c", state: "queued", queuePosition: 2, startedAt: "2024-01-01T10:02:00Z" }),
        baseJob({ id: "done", ref: "labhub:z", state: "succeeded", message: "ok", startedAt: "2024-01-01T09:00:00Z" }),
        baseJob({ id: "q1", ref: "labhub:b", state: "queued", queuePosition: 1, startedAt: "2024-01-01T10:01:00Z" }),
        baseJob({ id: "run", ref: "labhub:a", pct: 40, log: ["downloading"], startedAt: "2024-01-01T10:00:00Z" })
      ])}
    />
  );
  const order = [...html.matchAll(/data-state="(\w+)"/g)].map((match) => match[1]);
  assert.deepEqual(order, ["running", "queued", "queued", "succeeded"]);
  assert.match(html, /Queued · Next/);
  assert.match(html, /Queued · 2 in line/);
  const queued = html.match(/<li[^>]*data-state="queued"[^>]*>.*?<\/li>/g) ?? [];
  for (const row of queued) {
    assert.match(row, /data-testid="images-job-cancel"/);
    assert.doesNotMatch(row.match(/<button[^>]*data-testid="images-job-cancel"[^>]*>/)?.[0] ?? "", /disabled/);
  }
  assert.match(html.match(/<li[^>]*data-state="running"[^>]*>.*?<\/li>/)?.[0] ?? "", /data-testid="images-job-log"[^>]*>downloading</);
});

test("a queued job without a place from the server says it waits for a slot", () => {
  const html = render(<JobsPanel onCancel={noop} jobs={[baseJob({ id: "q", ref: "labhub:b", state: "queued" })]} />);
  assert.match(html, /waiting for a build slot/);
  assert.doesNotMatch(html, /in line|Next/);
});
