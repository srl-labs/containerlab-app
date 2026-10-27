import {
  ApisApi,
  AppsV1Api,
  AuthorizationV1Api,
  CustomObjectsApi,
  VersionApi,
  type KubeConfig
} from "@kubernetes/client-node";

/** The API group of clabernetes' resources. */
export const C9S_API_GROUP = "c9s.run";

/** One permission a c9s lab host needs, as a SelfSubjectAccessReview asks for it. */
export interface KubeAccessCheck {
  verb: string;
  group?: string;
  resource: string;
  subresource?: string;
  /** Empty asks about every namespace. */
  namespace?: string;
}

/** What detection asks a cluster. Tests replace it with a fake. */
export interface KubeClusterProbe {
  /** The context the probe talks to. */
  readonly context: string;
  /** The API server's version; rejects when the cluster cannot be reached. */
  serverVersion(): Promise<string>;
  /** Whether the API server serves `topologies.c9s.run`. */
  hasTopologyResource(): Promise<boolean>;
  /** The clabernetes manager's image tag, or undefined when the user may not read it. */
  clabernetesVersion(): Promise<string | undefined>;
  /** A SelfSubjectAccessReview. */
  canI(check: KubeAccessCheck): Promise<boolean>;
}

function errorCode(error: unknown): number | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : undefined;
}

/** The tag of a container image reference, without a digest. */
export function imageTag(image: string): string | undefined {
  const withoutDigest = image.split("@")[0] ?? "";
  const lastSlash = withoutDigest.lastIndexOf("/");
  const colon = withoutDigest.indexOf(":", lastSlash + 1);
  return colon >= 0 ? withoutDigest.slice(colon + 1) : undefined;
}

/** A probe over client-node. */
export function createKubeClusterProbe(config: KubeConfig): KubeClusterProbe {
  return {
    context: config.getCurrentContext(),
    async serverVersion() {
      const info = await config.makeApiClient(VersionApi).getCode();
      return info.gitVersion;
    },
    async hasTopologyResource() {
      const groups = await config.makeApiClient(ApisApi).getAPIVersions();
      const group = groups.groups.find((candidate) => candidate.name === C9S_API_GROUP);
      if (!group) return false;
      const versions = group.preferredVersion
        ? [group.preferredVersion, ...group.versions.filter((version) => version !== group.preferredVersion)]
        : group.versions;
      const objects = config.makeApiClient(CustomObjectsApi);
      for (const version of versions) {
        const resources = await objects.getAPIResources({ group: C9S_API_GROUP, version: version.version });
        if (resources.resources.some((resource) => resource.name === "topologies")) return true;
      }
      return false;
    },
    async clabernetesVersion() {
      try {
        const deployments = await config.makeApiClient(AppsV1Api).listDeploymentForAllNamespaces({
          labelSelector: "app.kubernetes.io/name=clabernetes"
        });
        for (const deployment of deployments.items) {
          for (const container of deployment.spec?.template.spec?.containers ?? []) {
            const tag = container.image ? imageTag(container.image) : undefined;
            if (tag) return tag;
          }
        }
        return undefined;
      } catch (error) {
        if (errorCode(error) === 403) return undefined;
        throw error;
      }
    },
    async canI(check) {
      const review = await config.makeApiClient(AuthorizationV1Api).createSelfSubjectAccessReview({
        body: {
          apiVersion: "authorization.k8s.io/v1",
          kind: "SelfSubjectAccessReview",
          spec: {
            resourceAttributes: {
              verb: check.verb,
              group: check.group ?? "",
              resource: check.resource,
              ...(check.subresource ? { subresource: check.subresource } : {}),
              ...(check.namespace ? { namespace: check.namespace } : {})
            }
          }
        }
      });
      return review.status?.allowed === true;
    }
  };
}
