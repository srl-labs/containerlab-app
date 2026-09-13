import type { SchemaData } from "../core/schema";

export interface ContainerImageSummary {
  id: string;
  shortId?: string;
  repoTags: string[];
  repoDigests: string[];
  created?: number;
  createdAt?: string;
  size?: number | string;
  virtualSize?: number | string;
}

export type KindImageReferenceSource =
  | "topology-defaults"
  | "topology-kind"
  | "topology-group"
  | "topology-node"
  | "custom-template"
  | "running-lab"
  | "pinned";

export interface KindImageReference {
  kind: string;
  image: string;
  source: KindImageReferenceSource;
  label: string;
  endpointId?: string;
  path?: string;
  nodeName?: string;
  type?: string;
}

export interface KindImageCatalogEntry {
  kind: string;
  types: string[];
  guidance: KindImageGuidance;
  references: KindImageReference[];
  localImages: ContainerImageSummary[];
  missingImages: string[];
  pinnedImages: string[];
  searchText: string;
}

export interface KindImageCatalogSnapshot {
  entries: KindImageCatalogEntry[];
  images: ContainerImageSummary[];
  references: KindImageReference[];
  unreferencedLocalImages: ContainerImageSummary[];
}

export interface ImageManagerTargetOptions {
  endpointId?: string;
}

export interface ImagePullRequest extends ImageManagerTargetOptions {
  image: string;
  kind?: string;
}

export interface ImageRemoveRequest extends ImageManagerTargetOptions {
  reference: string;
  force?: boolean;
}

export interface ImagePinRequest extends ImageManagerTargetOptions {
  kind: string;
  image: string;
}

export interface ImageActionResult {
  success: boolean;
  image?: string;
  message?: string;
  output?: string;
}

export interface ImageManagerEndpointOption {
  id: string;
  label: string;
}

export interface ImageManagerInitialData {
  schemaData?: SchemaData;
  endpointOptions?: ImageManagerEndpointOption[];
  selectedEndpointId?: string;
}

export type KindImagePreparationMode =
  | "direct-pull"
  | "vendor-import"
  | "vrnetlab"
  | "none"
  | "docs";

export interface KindImagePreparation {
  mode: KindImagePreparationMode;
  label: string;
  details: string;
  docsUrl?: string;
}

export interface KindImageGuidance {
  kind: string;
  title: string;
  imageRequired: boolean;
  recommendedImages: string[];
  repositoryHints: string[];
  guidance: string;
  preparation: KindImagePreparation;
  docsUrl: string;
  pullable: boolean;
}
