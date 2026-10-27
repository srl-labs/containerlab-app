import assert from "node:assert/strict";
import test from "node:test";

import { kubectlExecCommand, parseNodeLocations } from "./kubernetes";

const RECORD = {
  name: "demo-n1",
  lab_name: "demo",
  namespace: "c9s-demo",
  pod: "demo-n1-7c9d8f-abcde",
  container: "node-n1-1a2b3c",
  exposed_ports: [{ port: 80, expose_port: 60080, protocol: "tcp" }],
  load_balancer_address: "192.0.2.10"
};

test("node locations come from c9s inspect records; Docker records have none", () => {
  assert.deepEqual(parseNodeLocations([{ ...RECORD, name: "demo-n2", pod: "p2" }, RECORD, { name: "clab-demo-r1" }]), [
    {
      node: "n1",
      containerName: "demo-n1",
      namespace: "c9s-demo",
      pod: "demo-n1-7c9d8f-abcde",
      container: "node-n1-1a2b3c",
      exposedPorts: [{ exposePort: 60080, destinationPort: 80, protocol: "TCP" }],
      loadBalancerAddress: "192.0.2.10"
    },
    {
      node: "n2",
      containerName: "demo-n2",
      namespace: "c9s-demo",
      pod: "p2",
      container: "node-n1-1a2b3c",
      exposedPorts: [{ exposePort: 60080, destinationPort: 80, protocol: "TCP" }],
      loadBalancerAddress: "192.0.2.10"
    }
  ]);
  assert.deepEqual(parseNodeLocations(undefined), []);
});

test("the kubectl exec command targets the device container with the host's context", () => {
  const [location] = parseNodeLocations([RECORD]);
  assert.equal(
    kubectlExecCommand(location, { kubeContext: "kind-c9s-app" }),
    "kubectl --context kind-c9s-app -n c9s-demo exec -it demo-n1-7c9d8f-abcde -c node-n1-1a2b3c -- sh"
  );
  assert.equal(
    kubectlExecCommand(location, { shell: "sr_cli" }),
    "kubectl -n c9s-demo exec -it demo-n1-7c9d8f-abcde -c node-n1-1a2b3c -- sr_cli"
  );
  assert.equal(
    kubectlExecCommand({ ...location, namespace: "team a" }, { kubeContext: "ctx" }),
    "kubectl --context ctx -n 'team a' exec -it demo-n1-7c9d8f-abcde -c node-n1-1a2b3c -- sh"
  );
  assert.equal(
    kubectlExecCommand(location, { kubeContext: "kind", kubeconfig: "/home/alice/.kube/lab prod" }),
    "kubectl --kubeconfig '/home/alice/.kube/lab prod' --context kind -n c9s-demo exec -it demo-n1-7c9d8f-abcde -c node-n1-1a2b3c -- sh"
  );
});
