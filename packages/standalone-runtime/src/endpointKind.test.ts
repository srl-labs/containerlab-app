import assert from "node:assert/strict";
import test from "node:test";

import type { EndpointKind as ContractEndpointKind } from "@srl-labs/containerlab-app-contract";
import type { EndpointKind as UiEndpointKind } from "@containerlab/clab-ui/workspace/types";

import type { EndpointKind } from "./stores/endpointStore";

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// The published clab-ui library cannot depend on the app contract, so it keeps a copy;
// this fails to compile when the copy drifts from the one definition.
const uiMatchesContract: Same<UiEndpointKind, ContractEndpointKind> = true;
const storeUsesContract: Same<EndpointKind, ContractEndpointKind> = true;

test("every package uses the app contract's endpoint kinds", () => {
  assert.equal(uiMatchesContract, true);
  assert.equal(storeUsesContract, true);
});
