import assert from "node:assert/strict";
import test from "node:test";

import {
  convertCustomTemplateToEditorData,
  convertEditorDataToSaveData,
  convertTemplateToEditorData
} from "./customNodeConversions";
import { convertEditorDataToNodeSaveData, convertToEditorData } from "./nodeEditorConversions";

test("box appearance round-trips from node data through the editor to save data", () => {
  const editorData = convertToEditorData({
    id: "srl1",
    name: "srl1",
    role: "router",
    box: { color: "#3b82f6", opacity: 60, blur: 8, borderWidth: 1 },
    extraData: { kind: "nokia_srlinux" }
  });
  assert.ok(editorData);
  assert.deepEqual(editorData.box, { color: "#3b82f6", opacity: 60, blur: 8 });

  const saveData = convertEditorDataToNodeSaveData({
    ...editorData,
    box: { ...editorData.box, textColor: "#ffffff", cornerRadius: 12 }
  });
  assert.deepEqual(saveData.extraData?.box, {
    color: "#3b82f6",
    opacity: 60,
    blur: 8,
    cornerRadius: 12,
    textColor: "#ffffff"
  });
});

test("box appearance falls back to extraData when the node data has none", () => {
  const editorData = convertToEditorData({
    id: "srl1",
    name: "srl1",
    extraData: { kind: "linux", box: { shadow: false } }
  });
  assert.deepEqual(editorData?.box, { shadow: false });
});

test("an unset or all-default box saves as null so the annotation is cleared", () => {
  const unset = convertEditorDataToNodeSaveData({ id: "srl1", name: "srl1" });
  assert.equal(unset.extraData?.box, null);

  const defaults = convertEditorDataToNodeSaveData({
    id: "srl1",
    name: "srl1",
    box: { opacity: 100, blur: 0, borderWidth: 1, shadow: true }
  });
  assert.equal(defaults.extraData?.box, null);
});

test("custom node templates keep their box appearance", () => {
  const editorData = convertCustomTemplateToEditorData({
    id: "temp-custom-node",
    isCustomTemplate: true,
    customName: "glass-leaf",
    kind: "nokia_srlinux",
    box: { color: "#ffffff", opacity: 40, blur: 12 }
  });
  assert.deepEqual(editorData.box, { color: "#ffffff", opacity: 40, blur: 12 });

  const saved = convertEditorDataToSaveData({ ...editorData, box: { opacity: 100 } });
  assert.equal(saved.box, undefined);

  const reloaded = convertTemplateToEditorData({
    ...convertEditorDataToSaveData(editorData),
    name: "glass-leaf",
    kind: "nokia_srlinux"
  });
  assert.deepEqual(reloaded.box, { color: "#ffffff", opacity: 40, blur: 12 });
});
