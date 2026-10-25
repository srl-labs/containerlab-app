import assert from "node:assert/strict";
import test from "node:test";

import { getKindImageGuidance } from "./kindGuidance";

const KINDS_DOCS_URL = "https://containerlab.dev/manual/kinds/";

test("kinds get their containerlab docs page and image preparation", () => {
  const expected: Array<[string, string, string]> = [
    ["ciena_saos", "ciena_saos", "vendor-import"],
    ["cisco_xrd_vrouter", "cisco_xrd_vrouter", "vrnetlab"],
    ["fortinet_fortiproxy", "fortinet_fortigate", "vrnetlab"],
    ["f5_bigip-ve", "f5_bigipve", "vrnetlab"],
    ["frr", "frr", "direct-pull"],
    ["frrouting", "frr", "direct-pull"],
    ["juniper_csrx", "csrx", "vendor-import"],
    ["nvidia_cumulusvx", "nvidia_cumulusvx", "vrnetlab"],
    ["plvision_sonic", "plvision_sonic", "vrnetlab"],
    ["spirent_stc", "spirent_stc", "vendor-import"],
    ["veesix_osvbng", "veesix_osvbng", "direct-pull"]
  ];

  for (const [kind, docsSlug, mode] of expected) {
    const guidance = getKindImageGuidance(kind);
    assert.equal(guidance.docsUrl, `${KINDS_DOCS_URL}${docsSlug}/`, kind);
    assert.equal(guidance.preparation.mode, mode, kind);
  }
});

test("FRR guidance points at the containerlab image on quay.io", () => {
  assert.deepEqual(getKindImageGuidance("frr").recommendedImages, [
    "quay.io/frrouting/frr:containerlab-<version>"
  ]);
});

test("kinds containerlab no longer documents fall back to generic guidance", () => {
  for (const kind of ["border0", "cumulus_cvx"]) {
    const guidance = getKindImageGuidance(kind);
    assert.equal(guidance.docsUrl, KINDS_DOCS_URL, kind);
    assert.deepEqual(guidance.recommendedImages, [], kind);
  }
});
