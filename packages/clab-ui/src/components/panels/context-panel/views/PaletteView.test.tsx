import assert from "node:assert/strict";
import test from "node:test";
import React from "react";

import type { LinkData } from "../../../../hooks/ui";

import type { InfoTabContentProps } from "./InfoTabContent";
import { createInfoTabContent } from "./PaletteView";

const linkData: LinkData = {
  id: "ixr-e2-0001:eth1--ixr-e2-0002:eth1",
  source: "ixr-e2-0001",
  target: "ixr-e2-0002",
  sourceEndpoint: "eth1",
  targetEndpoint: "eth1",
  extraData: {
    clabSourceMacAddress: "aa:c1:ab:ec:17:73",
    clabSourceMtu: 9500,
    clabSourceType: "veth"
  }
};

test("createInfoTabContent renders link info for link-only selection", () => {
  const content = createInfoTabContent(null, linkData);

  assert.equal(React.isValidElement<InfoTabContentProps>(content), true);
  if (!React.isValidElement<InfoTabContentProps>(content)) return;

  assert.equal(content.props.selectedNodeData, null);
  assert.equal(content.props.selectedLinkData, linkData);
});

test("createInfoTabContent returns null when there is no selection data", () => {
  assert.equal(createInfoTabContent(null, null), null);
});
