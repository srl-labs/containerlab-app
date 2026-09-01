import aiFabricYaml from "../fixtures/topologies/ai-fabric.clab.yml?raw";
import aiFabricAnnotations from "../fixtures/topologies/ai-fabric.clab.yml.annotations.json?raw";
import datacenterYaml from "../fixtures/topologies/datacenter.clab.yml?raw";
import datacenterAnnotations from "../fixtures/topologies/datacenter.clab.yml.annotations.json?raw";
import emptyYaml from "../fixtures/topologies/empty.clab.yml?raw";
import networkYaml from "../fixtures/topologies/network.clab.yml?raw";
import networkAnnotations from "../fixtures/topologies/network.clab.yml.annotations.json?raw";
import simpleYaml from "../fixtures/topologies/simple.clab.yml?raw";
import simpleAnnotations from "../fixtures/topologies/simple.clab.yml.annotations.json?raw";
import spineLeafYaml from "../fixtures/topologies/spine-leaf.clab.yml?raw";
import spineLeafAnnotations from "../fixtures/topologies/spine-leaf.clab.yml.annotations.json?raw";

export const TOPOLOGY_ROOT = "/topologies";

export const fixtureFiles: Record<string, string> = {
  [`${TOPOLOGY_ROOT}/ai-fabric.clab.yml`]: aiFabricYaml,
  [`${TOPOLOGY_ROOT}/ai-fabric.clab.yml.annotations.json`]: aiFabricAnnotations,
  [`${TOPOLOGY_ROOT}/datacenter.clab.yml`]: datacenterYaml,
  [`${TOPOLOGY_ROOT}/datacenter.clab.yml.annotations.json`]: datacenterAnnotations,
  [`${TOPOLOGY_ROOT}/empty.clab.yml`]: emptyYaml,
  [`${TOPOLOGY_ROOT}/network.clab.yml`]: networkYaml,
  [`${TOPOLOGY_ROOT}/network.clab.yml.annotations.json`]: networkAnnotations,
  [`${TOPOLOGY_ROOT}/simple.clab.yml`]: simpleYaml,
  [`${TOPOLOGY_ROOT}/simple.clab.yml.annotations.json`]: simpleAnnotations,
  [`${TOPOLOGY_ROOT}/spine-leaf.clab.yml`]: spineLeafYaml,
  [`${TOPOLOGY_ROOT}/spine-leaf.clab.yml.annotations.json`]: spineLeafAnnotations
};
