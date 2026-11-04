/**
 * What a Kubernetes (c9s) lab host cannot do with a topology or a lab, and
 * what it does differently, with the reason the UI shows. The one source for
 * the editors and menus: an `unsupported` field shows greyed out with its
 * reason, a `partial` one stays editable with the reason as a hint. Docker
 * and Podman lab hosts have no limits here and look as they always did.
 *
 * The evidence is containerlab's c9s runtime and the clabernetes compiler it
 * runs before a deploy (strict parse and compile policy), e.g.
 * - clabernetes `compiler/compilecontainerlab.go`: rejected node fields
 *   (`runtime`, `auto-remove`, `cpu-set`, `stages`), the management fields it
 *   accepts and ignores, a single management network, no `settings` block,
 *   no node `credentials`,
 *   `network-mode` other than `container:`, and `restart-policy` `no` and
 *   `on-failure`;
 * - clabernetes `compiler/links.go`: no link vars or labels, no `mgmt-net`
 *   or `macvlan` endpoints, veth links only;
 * - clabernetes `internal/deviceplan/mapper.go`: `env-files` fails planning;
 * - containerlab `cmd/root.go`: `tools` (netem, snapshots, sshx, gotty),
 *   `--node-filter`, `--graceful`, `--keep-mgmt-net`, `--skip-*` and
 *   `--export-template` are refused with `-r c9s`;
 * - containerlab `labruntime/clabernetes/files.go`: binds copied into
 *   ConfigMaps (read-only, 950 KB each), veth-stitch links not rendered.
 */
import type { LabHostProfile } from "./labHostSupport";

export interface RuntimeLimit {
  /** `unsupported` greys the option out; `partial` keeps it and shows the reason as a hint. */
  level: "unsupported" | "partial";
  reason: string;
}

const C9S = "Kubernetes (c9s)";

function unsupported(reason: string): RuntimeLimit {
  return { level: "unsupported", reason };
}

function partial(reason: string): RuntimeLimit {
  return { level: "partial", reason };
}

const SINGLE_MGMT_NETWORK = `Not supported on ${C9S}: a lab has one management network, run by clabernetes`;
const IGNORED_MGMT = `Ignored on ${C9S}: clabernetes runs the management network; only its subnets apply`;
const NOT_IN_LINK_API = `Not supported on ${C9S}: clabernetes links keep no vars or labels`;
const REFUSED_FLAG = `Not supported on ${C9S}: containerlab refuses it with -r c9s`;

export const KUBERNETES_LIMITS = {
  // Lab settings
  mgmtNetworkOptions: unsupported(IGNORED_MGMT),
  mgmtSubnets: partial(`On ${C9S} the subnets and gateways address clabernetes' management network.`),
  mgmtNetworks: unsupported(SINGLE_MGMT_NETWORK),
  certificateAuthority: unsupported(
    `Not supported on ${C9S}: clabernetes signs node certificates with its own CA, and refuses the settings block`
  ),

  // Nodes
  nodeMgmtNet: unsupported(`Ignored on ${C9S}: a lab has one management network`),
  nodeCpuSet: unsupported(`Not supported on ${C9S}: CPU pinning has no pod equivalent`),
  nodeRuntime: unsupported(`Not supported on ${C9S}: pods use the cluster's container runtime`),
  nodeAutoRemove: unsupported(`Not supported on ${C9S}: Kubernetes owns the container's lifecycle`),
  nodeStages: unsupported(`Not supported on ${C9S}: clabernetes does not run deployment stages`),
  nodeCredentials: unsupported(`Not supported on ${C9S}: clabernetes refuses node credentials; the kind's defaults apply`),
  nodeEnvFiles: unsupported(`Not supported on ${C9S}: a node with env-files fails to start`),
  nodeNetworkMode: partial(`On ${C9S} only Container works; Host and None are refused.`),
  nodeRestartPolicy: partial(`On ${C9S} only Always and Unless Stopped work.`),
  nodePorts: partial(`On ${C9S} ports are reached through a Kubernetes Service; the host port is ignored.`),
  nodeBinds: partial(
    `On ${C9S} bound files are copied read-only into the pod from the machine that deploys, up to 950 KB each.`
  ),
  nodeLabels: partial(`On ${C9S} labels become Kubernetes labels and need valid Kubernetes label values.`),
  nodeAliases: partial(`On ${C9S} each alias becomes a Service: lowercase letters, digits and '-' only.`),
  nodeExec: partial(`On ${C9S} the commands run as the container starts; one that fails does not stop the node.`),

  // Links
  linkVethStitch: partial(`On ${C9S} only veth links work; veth-stitch is refused.`),
  linkEndpointAddresses: unsupported(`Ignored on ${C9S}: only the node and interface names of an endpoint reach clabernetes`),
  linkVars: unsupported(NOT_IN_LINK_API),
  linkLabels: unsupported(NOT_IN_LINK_API),

  // Running labs
  linkImpairments: unsupported(`Not supported on ${C9S}: containerlab has no tools netem there`),
  vmSnapshots: unsupported(`Not supported on ${C9S}: containerlab has no VM snapshots there`),
  nodePause: unsupported(`Not supported on ${C9S}: pods cannot be paused`),
  shareTools: unsupported(`Not supported on ${C9S}: containerlab has no tools sshx or gotty there`),
  fcli: unsupported(`Not supported on ${C9S}`),
  edgeshark: unsupported(`Not supported on ${C9S}: clabernetes captures lab links as one stream`),

  // Deploy flags (Run with options, Lab settings > Deploy)
  nodeFilter: unsupported(`Not supported on ${C9S}: the whole lab is deployed and destroyed`),
  graceful: unsupported(REFUSED_FLAG),
  keepMgmtNet: unsupported(REFUSED_FLAG),
  skipPostDeploy: unsupported(REFUSED_FLAG),
  skipLabdirAcl: unsupported(REFUSED_FLAG),
  exportTemplate: unsupported(REFUSED_FLAG)
} as const satisfies Record<string, RuntimeLimit>;

export type KubernetesLimitKey = keyof typeof KUBERNETES_LIMITS;

/** The limit of a lab host on an option; undefined where the host has none (Docker, Podman, unknown). */
export function runtimeLimit(
  profile: Pick<LabHostProfile, "runtime"> | undefined,
  key: KubernetesLimitKey
): RuntimeLimit | undefined {
  return profile?.runtime === "c9s" ? KUBERNETES_LIMITS[key] : undefined;
}

/** The reason an option is greyed out on this lab host; undefined where it works, if only partly. */
export function unsupportedReason(
  profile: Pick<LabHostProfile, "runtime"> | undefined,
  key: KubernetesLimitKey
): string | undefined {
  const limit = runtimeLimit(profile, key);
  return limit?.level === "unsupported" ? limit.reason : undefined;
}

/**
 * Why a cluster used from this machine may not pull with an image pull secret
 * when every lab gets its own namespace. containerlab only names the Secret
 * on the lab (`spec.imagePull.pullSecrets`, containerlab
 * `labruntime/clabernetes/topology.go`) and creates no Secret; clabernetes
 * copies none either: a node whose Secret is missing waits with
 * `ImagePullSecretMissing` until it appears (clabernetes
 * `controllers/node/directstatus.go`), and its image pull guide mirrors one
 * Secret into the lab namespaces with tools such as kubernetes-reflector.
 * Deploy creates the namespace `c9s-<lab>`, so the Secret is only there when
 * the cluster copies it. A fixed namespace, or a lab server (it copies its
 * Secret into each lab namespace), has no such gap.
 */
export const PER_LAB_PULL_SECRET_NOTE =
  "With one namespace per lab, deploy creates c9s-<lab> and only names the Secret there. " +
  "Have the cluster copy it into new namespaces (e.g. kubernetes-reflector), or use a fixed namespace that holds it.";

/**
 * The note on an image pull secret of one lab: set when a secret applies and
 * the lab gets its own namespace at deploy (no namespace of its own or of the
 * lab host); undefined otherwise.
 */
export function pullSecretNamespaceNote(secret: string | undefined, namespace: string | undefined): string | undefined {
  const name = secret?.trim() ?? "";
  if (name === "" || (namespace?.trim() ?? "") !== "") return undefined;
  return (
    `${name} must exist in the lab's namespace c9s-<lab>, which deploy creates. ` +
    "Set a namespace that holds it, or have the cluster copy it into new namespaces (e.g. kubernetes-reflector)."
  );
}
