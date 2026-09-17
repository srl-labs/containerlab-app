import { parse } from "yaml";

import { resolveNodeConfig } from "../core/parsing/NodeConfigResolver";
import type { SchemaData } from "../core/schema";
import type { ClabNode, ClabTopology } from "../core/types/topology";
import type {
  ContainerImageSummary,
  KindImageCatalogEntry,
  KindImageCatalogSnapshot,
  KindImageGuidance,
  KindImageReference
} from "./types";
import {
  getKindImageGuidance,
  isPlaceholderImageReference
} from "./kindGuidance";
import { isRecord } from "../core/utilities/typeHelpers";

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeImageRef(value: string): string {
  return value.trim();
}

function imageRepoTag(repository: string, tag: string): string {
  if (!repository || repository === "<none>" || !tag || tag === "<none>") {
    return "";
  }
  return `${repository}:${tag}`;
}

function imageRepoDigest(repository: string, digest: string): string {
  if (!repository || repository === "<none>" || !digest || digest === "<none>") {
    return "";
  }
  return `${repository}@${digest}`;
}

function hasExplicitTagOrDigest(reference: string): boolean {
  const withoutDigest = reference.split("@")[0] ?? reference;
  const lastColon = withoutDigest.lastIndexOf(":");
  const lastSlash = withoutDigest.lastIndexOf("/");
  return reference.includes("@") || lastColon > lastSlash;
}

function implicitLatestReference(reference: string): string {
  const normalized = normalizeImageRef(reference);
  if (!normalized || hasExplicitTagOrDigest(normalized)) {
    return normalized;
  }
  return `${normalized}:latest`;
}

export function imageIdentityValues(image: ContainerImageSummary): Set<string> {
  const identities = new Set<string>();
  const id = cleanString(image.id);
  if (id) {
    identities.add(id);
    identities.add(id.replace(/^sha256:/, ""));
  }
  const shortId = cleanString(image.shortId);
  if (shortId) {
    identities.add(shortId);
    identities.add(shortId.replace(/^sha256:/, ""));
  }
  for (const tag of image.repoTags) {
    const normalized = normalizeImageRef(tag);
    if (normalized && !normalized.includes("<none>")) {
      identities.add(normalized);
    }
  }
  for (const digest of image.repoDigests) {
    const normalized = normalizeImageRef(digest);
    if (normalized && !normalized.includes("<none>")) {
      identities.add(normalized);
    }
  }
  return identities;
}

export function isImageReferenceLocal(reference: string, images: ContainerImageSummary[]): boolean {
  const normalizedReference = normalizeImageRef(reference);
  if (!normalizedReference) {
    return false;
  }
  const latestReference = implicitLatestReference(normalizedReference);
  return images.some((image) => {
    const identities = imageIdentityValues(image);
    return identities.has(normalizedReference) || identities.has(latestReference);
  });
}

function identitiesMatchReference(identities: Set<string>, reference: string): boolean {
  const normalizedReference = normalizeImageRef(reference);
  if (!normalizedReference) {
    return false;
  }
  return identities.has(normalizedReference) || identities.has(implicitLatestReference(normalizedReference));
}

function normalizeRepositoryName(reference: string): string {
  const withoutDigest = normalizeImageRef(reference).split("@")[0] ?? "";
  const lastColon = withoutDigest.lastIndexOf(":");
  const lastSlash = withoutDigest.lastIndexOf("/");
  if (lastColon > lastSlash) {
    return withoutDigest.slice(0, lastColon);
  }
  return withoutDigest;
}

function normalizedRepositoryVariants(reference: string): Set<string> {
  const normalized = normalizeRepositoryName(reference).toLowerCase();
  const variants = new Set<string>();
  if (!normalized || normalized.includes("<none>")) {
    return variants;
  }

  variants.add(normalized);
  if (!normalized.includes("/") && !normalized.includes(".")) {
    variants.add(`docker.io/library/${normalized}`);
    variants.add(`library/${normalized}`);
  }

  return variants;
}

function imageMatchesRepositoryHint(reference: string, hint: string): boolean {
  const referenceVariants = normalizedRepositoryVariants(reference);
  const hintVariants = normalizedRepositoryVariants(hint);
  for (const referenceVariant of referenceVariants) {
    for (const hintVariant of hintVariants) {
      if (
        referenceVariant === hintVariant ||
        referenceVariant.endsWith(`/${hintVariant}`) ||
        hintVariant.endsWith(`/${referenceVariant}`)
      ) {
        return true;
      }
    }
  }
  return false;
}

function identitiesMatchKindGuidance(
  identities: Set<string>,
  guidance: KindImageGuidance
): boolean {
  for (const identity of identities) {
    for (const hint of guidance.repositoryHints) {
      if (imageMatchesRepositoryHint(identity, hint)) {
        return true;
      }
    }
  }
  return false;
}

function addReference(
  references: KindImageReference[],
  seen: Set<string>,
  reference: KindImageReference
): void {
  const kind = cleanString(reference.kind);
  const image = cleanString(reference.image);
  if (!kind || !image) {
    return;
  }
  const normalized: KindImageReference = {
    ...reference,
    kind,
    image
  };
  const key = [
    normalized.kind,
    normalized.image,
    normalized.source,
    normalized.label,
    normalized.endpointId ?? "",
    normalized.path ?? "",
    normalized.nodeName ?? ""
  ].join("\0");
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  references.push(normalized);
}

function inferNodeImageSource(
  parsed: ClabTopology,
  node: ClabNode,
  effectiveKind: string | undefined
): KindImageReference["source"] {
  const topology = parsed.topology ?? {};
  const groupCfg = node.group ? topology.groups?.[node.group] : undefined;
  const kindCfg = effectiveKind ? topology.kinds?.[effectiveKind] : undefined;
  if (cleanString(node.image)) return "topology-node";
  if (cleanString(groupCfg?.image)) return "topology-group";
  if (cleanString(kindCfg?.image)) return "topology-kind";
  return "topology-defaults";
}

export function collectKindImageReferencesFromTopology(
  topology: ClabTopology,
  options: {
    endpointId?: string;
    label?: string;
    path?: string;
  } = {}
): KindImageReference[] {
  const references: KindImageReference[] = [];
  const seen = new Set<string>();
  const sourceLabel = options.label ?? topology.name ?? options.path ?? "Topology";
  const topo = topology.topology ?? {};

  for (const [kind, cfg] of Object.entries(topo.kinds ?? {})) {
    addReference(references, seen, {
      kind,
      image: cleanString(cfg.image),
      source: "topology-kind",
      label: `${sourceLabel} kind ${kind}`,
      endpointId: options.endpointId,
      path: options.path,
      type: cleanString(cfg.type) || undefined
    });
  }

  for (const [groupName, cfg] of Object.entries(topo.groups ?? {})) {
    addReference(references, seen, {
      kind: cleanString(cfg.kind),
      image: cleanString(cfg.image),
      source: "topology-group",
      label: `${sourceLabel} group ${groupName}`,
      endpointId: options.endpointId,
      path: options.path,
      type: cleanString(cfg.type) || undefined
    });
  }

  const defaultKind = cleanString(topo.defaults?.kind);
  const defaultImage = cleanString(topo.defaults?.image);
  if (defaultKind && defaultImage) {
    addReference(references, seen, {
      kind: defaultKind,
      image: defaultImage,
      source: "topology-defaults",
      label: `${sourceLabel} defaults`,
      endpointId: options.endpointId,
      path: options.path,
      type: cleanString(topo.defaults?.type) || undefined
    });
  }

  for (const [nodeName, node] of Object.entries(topo.nodes ?? {})) {
    const resolved = resolveNodeConfig(topology, node);
    const kind = cleanString(resolved.kind);
    const image = cleanString(resolved.image);
    if (!kind || !image) {
      continue;
    }
    addReference(references, seen, {
      kind,
      image,
      source: inferNodeImageSource(topology, node, kind),
      label: `${sourceLabel} node ${nodeName}`,
      endpointId: options.endpointId,
      path: options.path,
      nodeName,
      type: cleanString(resolved.type) || undefined
    });
  }

  return references;
}

export function collectKindImageReferencesFromYaml(
  content: string,
  options: {
    endpointId?: string;
    label?: string;
    path?: string;
  } = {}
): KindImageReference[] {
  const parsed = parse(content) as unknown;
  if (!isRecord(parsed)) {
    return [];
  }
  return collectKindImageReferencesFromTopology(parsed as ClabTopology, options);
}

export function collectKindImageReferencesFromCustomTemplates(
  templates: unknown[],
  options: {
    endpointId?: string;
    label?: string;
  } = {}
): KindImageReference[] {
  const references: KindImageReference[] = [];
  const seen = new Set<string>();
  for (const template of templates) {
    if (!isRecord(template)) {
      continue;
    }
    const name = cleanString(template.name) || cleanString(template.label) || "Custom template";
    addReference(references, seen, {
      kind: cleanString(template.kind),
      image: cleanString(template.image),
      source: "custom-template",
      label: `${options.label ?? "Custom"} ${name}`,
      endpointId: options.endpointId,
      type: cleanString(template.type) || undefined
    });
  }
  return references;
}

export function pinnedReferencesFromMap(
  pinnedByKind: Record<string, readonly string[]>,
  endpointId?: string
): KindImageReference[] {
  const references: KindImageReference[] = [];
  const seen = new Set<string>();
  for (const [kind, images] of Object.entries(pinnedByKind)) {
    for (const image of images) {
      addReference(references, seen, {
        kind,
        image,
        source: "pinned",
        label: "Pinned",
        endpointId
      });
    }
  }
  return references;
}

function sortKinds(schemaData: SchemaData, extraKinds: Iterable<string>): string[] {
  const kinds = new Set<string>();
  for (const kind of schemaData.kinds ?? []) {
    if (kind.trim()) {
      kinds.add(kind);
    }
  }
  for (const kind of extraKinds) {
    if (kind.trim()) {
      kinds.add(kind);
    }
  }
  return [...kinds].sort((a, b) => {
    const aNokia = a.startsWith("nokia_");
    const bNokia = b.startsWith("nokia_");
    if (aNokia !== bNokia) {
      return aNokia ? -1 : 1;
    }
    return a.localeCompare(b);
  });
}

function imagePrimaryName(image: ContainerImageSummary): string {
  return image.repoTags[0] ?? image.repoDigests[0] ?? image.shortId ?? image.id;
}

interface ImageWithIdentities {
  image: ContainerImageSummary;
  identities: Set<string>;
}

function referenceLocalIn(imagesWithIdentities: ImageWithIdentities[], reference: string): boolean {
  const normalizedReference = normalizeImageRef(reference);
  if (!normalizedReference) {
    return false;
  }
  const latestReference = implicitLatestReference(normalizedReference);
  return imagesWithIdentities.some(
    ({ identities }) => identities.has(normalizedReference) || identities.has(latestReference)
  );
}

function localImagesForKind(
  imagesWithIdentities: ImageWithIdentities[],
  referenceImages: string[],
  guidance: KindImageGuidance
): ContainerImageSummary[] {
  const localImages: ContainerImageSummary[] = [];
  for (const { image, identities } of imagesWithIdentities) {
    if (
      referenceImages.some((reference) => identitiesMatchReference(identities, reference)) ||
      identitiesMatchKindGuidance(identities, guidance)
    ) {
      localImages.push(image);
    }
  }
  return localImages;
}

function isUnreferencedLocalImage(
  identities: Set<string>,
  referencedImages: Set<string>,
  guidanceByKind: Map<string, KindImageGuidance>
): boolean {
  for (const reference of referencedImages) {
    if (identities.has(reference) || identities.has(implicitLatestReference(reference))) {
      return false;
    }
  }
  for (const guidance of guidanceByKind.values()) {
    if (identitiesMatchKindGuidance(identities, guidance)) {
      return false;
    }
  }
  return true;
}

export function buildKindImageCatalog(
  schemaData: SchemaData,
  images: ContainerImageSummary[],
  references: KindImageReference[]
): KindImageCatalogSnapshot {
  const referencesByKind = new Map<string, KindImageReference[]>();
  for (const reference of references) {
    const refs = referencesByKind.get(reference.kind) ?? [];
    refs.push(reference);
    referencesByKind.set(reference.kind, refs);
  }

  const referencedImages = new Set(references.map((reference) => normalizeImageRef(reference.image)));
  const matchedLocalImageIds = new Set<string>();
  const entries: KindImageCatalogEntry[] = [];
  const sortedKinds = sortKinds(schemaData, referencesByKind.keys());
  const guidanceByKind = new Map(
    sortedKinds.map((kind) => [kind, getKindImageGuidance(kind)] as const)
  );
  // Identity sets are expensive to build; compute them once per image instead of per kind.
  const imagesWithIdentities: ImageWithIdentities[] = images.map(
    (image) => ({ image, identities: imageIdentityValues(image) })
  );

  for (const kind of sortedKinds) {
    const guidance = guidanceByKind.get(kind) ?? getKindImageGuidance(kind);
    const kindReferences = referencesByKind.get(kind) ?? [];
    const referenceImages = [...new Set(kindReferences.map((reference) => reference.image))];
    const concreteRecommendedImages = guidance.recommendedImages.filter(
      (image) => !isPlaceholderImageReference(image)
    );
    const localImages = localImagesForKind(imagesWithIdentities, referenceImages, guidance);
    for (const image of localImages) {
      matchedLocalImageIds.add(image.id);
    }
    const missingReferenceImages = referenceImages.filter(
      (reference) =>
        !isPlaceholderImageReference(reference) &&
        !referenceLocalIn(imagesWithIdentities, reference)
    );
    const missingImages = [...new Set(missingReferenceImages)].filter((image) => image.trim());
    const desiredImages = [...new Set([...referenceImages, ...concreteRecommendedImages])].filter(
      (image) => image.trim()
    );
    const pinnedImages = [
      ...new Set(
        kindReferences
          .filter((reference) => reference.source === "pinned")
          .map((reference) => reference.image)
      )
    ];
    const types = schemaData.typesByKind?.[kind] ?? [];
    const searchText = [
      kind,
      guidance.title,
      guidance.guidance,
      guidance.preparation.label,
      guidance.preparation.details,
      guidance.recommendedImages.join(" "),
      guidance.repositoryHints.join(" "),
      types.join(" "),
      kindReferences.map((reference) => `${reference.image} ${reference.label}`).join(" "),
      localImages.map(imagePrimaryName).join(" "),
      desiredImages.join(" ")
    ]
      .join(" ")
      .toLowerCase();

    entries.push({
      kind,
      types,
      guidance,
      references: kindReferences.sort((a, b) => a.image.localeCompare(b.image)),
      localImages,
      missingImages,
      pinnedImages,
      searchText
    });
  }

  const unreferencedLocalImages = imagesWithIdentities
    .filter(
      ({ image, identities }) =>
        !matchedLocalImageIds.has(image.id) &&
        isUnreferencedLocalImage(identities, referencedImages, guidanceByKind)
    )
    .map(({ image }) => image);

  return {
    entries,
    images,
    references,
    unreferencedLocalImages
  };
}

export function pullableMissingImagesForEntry(
  entry: Pick<KindImageCatalogEntry, "guidance" | "missingImages">
): string[] {
  if (!entry.guidance.pullable || entry.guidance.preparation.mode !== "direct-pull") {
    return [];
  }
  return entry.missingImages.filter((image) => !isPlaceholderImageReference(image));
}

export function pullableImagesForEntry(
  entry: Pick<
    KindImageCatalogEntry,
    "guidance" | "localImages" | "missingImages" | "references"
  >
): string[] {
  if (!entry.guidance.pullable || entry.guidance.preparation.mode !== "direct-pull") {
    return [];
  }

  const recommendedImages =
    entry.references.length === 0 && entry.localImages.length === 0
      ? entry.guidance.recommendedImages
      : [];

  return [...new Set([...entry.missingImages, ...recommendedImages])]
    .map(normalizeImageRef)
    .filter((image) => image && !isPlaceholderImageReference(image));
}

export function runtimeImageSummaryFromCliRecord(record: Record<string, string>): ContainerImageSummary {
  const id = cleanString(record.ID) || cleanString(record.Id);
  const repository = cleanString(record.Repository);
  const tag = cleanString(record.Tag);
  const digest = cleanString(record.Digest);
  const repoTag = imageRepoTag(repository, tag);
  const repoDigest = imageRepoDigest(repository, digest);
  return {
    id,
    shortId: id.replace(/^sha256:/, "").slice(0, 12),
    repoTags: repoTag ? [repoTag] : [],
    repoDigests: repoDigest ? [repoDigest] : [],
    createdAt: cleanString(record.CreatedAt) || cleanString(record.CreatedSince) || undefined,
    size: cleanString(record.Size) || undefined,
    virtualSize: cleanString(record.VirtualSize) || undefined
  };
}

// This file backs the published dist/image-manager/catalog.d.ts (the runtime JS
// for the subpath is bundled from catalog-entry.ts) — keep this type re-export
// in sync with catalog-entry.ts so the public type surface matches the runtime.
export type {
  ContainerImageSummary,
  ImageActionResult,
  ImageManagerTargetOptions,
  ImagePinRequest,
  ImagePullRequest,
  ImageRemoveRequest,
  KindImageReference
} from "./types";
