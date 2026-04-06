import { engraveTypeLabel, engraveTypeToFillMode, fillModeToEngraveType } from "./engraving";
import { clampPlacementToArtboard, parseSvgDocumentMetrics } from "./geometry";
import { groupAssignmentsForIds } from "./profile-groups";
import type {
  ArtObject,
  ElementAssignment,
  EngraveType,
  FrontendOperation,
  PreparedSvgDocument,
  Settings,
  SvgTreeNode,
} from "./types";
import { clamp, roundMm } from "./utils";

const IMPORT_GAP_MM = 10;

export function buildCompositeElementId(artObjectId: string, elementId: string) {
  return `${artObjectId}::${elementId}`;
}

export function splitCompositeElementId(compositeId: string) {
  const [artObjectId, ...rest] = compositeId.split("::");
  return {
    artObjectId,
    elementId: rest.join("::"),
  };
}

/**
 * Create an ArtObject from a prepared SVG document.
 * Browser-only: uses DOMParser via parseSvgDocumentMetrics.
 *
 * @param elementColors - Optional pre-computed color map. Pass in from your UI's
 *   color detection logic, or omit to skip color assignment.
 */
export function createArtObject(params: {
  artObjectId: string;
  name: string;
  preparedSvg: PreparedSvgDocument;
  settings: Settings | null;
  defaultEngraveType: EngraveType;
  existingArtObjects: ArtObject[];
  elementColors?: Map<string, string>;
}) {
  const svgMetrics = parseSvgDocumentMetrics(params.preparedSvg.normalized_svg);
  if (!svgMetrics) {
    throw new Error("Could not read SVG dimensions.");
  }

  const widthMm = roundMm(svgMetrics.widthMm);
  const heightMm = roundMm(svgMetrics.heightMm);
  const defaultDepth = params.settings?.engraving.target_depth ?? 5;
  const defaultFillMode = engraveTypeToFillMode(params.defaultEngraveType) ?? params.settings?.engraving.fill_mode ?? "Pocket";
  const elementAssignments = Object.fromEntries(
    params.preparedSvg.selectable_element_ids.map((elementId) => {
      const compositeId = buildCompositeElementId(params.artObjectId, elementId);
      return [
        compositeId,
        {
          elementId: compositeId,
          targetDepthMm: defaultDepth,
          engraveType: params.defaultEngraveType,
          fillMode: defaultFillMode,
        } satisfies ElementAssignment,
      ];
    }),
  );
  const placement = getAutoPlacement({
    settings: params.settings,
    existingArtObjects: params.existingArtObjects,
    widthMm,
    heightMm,
  });

  return {
    id: params.artObjectId,
    name: params.name,
    preparedSvg: params.preparedSvg,
    svgMetrics,
    placementX: placement.x,
    placementY: placement.y,
    widthMm,
    heightMm,
    aspectLocked: true,
    elementAssignments,
    elementColors: params.elementColors,
  } satisfies ArtObject;
}

export function cloneTreeWithCompositeIds(tree: SvgTreeNode, artObjectId: string): SvgTreeNode {
  return {
    ...tree,
    id: tree.id ? buildCompositeElementId(artObjectId, tree.id) : null,
    selectable_descendant_ids: tree.selectable_descendant_ids.map((elementId) =>
      buildCompositeElementId(artObjectId, elementId),
    ),
    children: tree.children.map((child) => cloneTreeWithCompositeIds(child, artObjectId)),
  };
}

export function getArtObjectElementIds(artObject: ArtObject) {
  return artObject.preparedSvg.selectable_element_ids.map((elementId) =>
    buildCompositeElementId(artObject.id, elementId),
  );
}

export function getMergedAssignments(artObjects: ArtObject[]) {
  return Object.fromEntries(
    artObjects.flatMap((artObject) => Object.entries(artObject.elementAssignments)),
  );
}

export function getDerivedOperationsForArtObjects(artObjects: ArtObject[]) {
  const assignments = getMergedAssignments(artObjects);
  const allElementIds = artObjects.flatMap((artObject) => getArtObjectElementIds(artObject));
  const groups = groupAssignmentsForIds(assignments, allElementIds);

  return groups.map((group): FrontendOperation => ({
    id: `profile-${group.key}`,
    name: `${roundMm(group.targetDepthMm)}mm${
      group.engraveType ? ` · ${engraveTypeLabel(group.engraveType)}` : group.fillMode ? ` · ${group.fillMode}` : ""
    }`,
    target_depth_mm: group.targetDepthMm,
    assigned_element_ids: group.elementIds,
    color: group.color,
    engrave_type: group.engraveType,
    fill_mode: group.fillMode,
  }));
}

/**
 * Compose multiple art objects into a single SVG document for conversion.
 * Browser-only: uses DOMParser and XMLSerializer.
 */
export function composeArtObjectsSvg(artObjects: ArtObject[], settings: Settings) {
  const svgDocument = window.document.implementation.createDocument("http://www.w3.org/2000/svg", "svg", null);
  const root = svgDocument.documentElement;
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  root.setAttribute("width", `${roundMm(settings.engraving.material_width)}mm`);
  root.setAttribute("height", `${roundMm(settings.engraving.material_height)}mm`);
  root.setAttribute(
    "viewBox",
    `0 0 ${roundMm(settings.engraving.material_width)} ${roundMm(settings.engraving.material_height)}`,
  );

  for (const artObject of artObjects) {
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(artObject.preparedSvg.normalized_svg, "image/svg+xml");
    const svgElement = svgDoc.querySelector("svg");
    if (!svgElement) {
      continue;
    }

    rewriteCompositeIds(svgElement, artObject.id);
    annotateAssignmentMetadata(svgElement, artObject);
    const placement = clampPlacementToArtboard({
      artboardWidthMm: settings.engraving.material_width,
      artboardHeightMm: settings.engraving.material_height,
      placementX: artObject.placementX,
      placementY: artObject.placementY,
      svgWidthMm: artObject.widthMm,
      svgHeightMm: artObject.heightMm,
    });

    const scaleX = artObject.widthMm / artObject.svgMetrics.width;
    const scaleY = artObject.heightMm / artObject.svgMetrics.height;
    const topMm = settings.engraving.material_height - placement.y - artObject.heightMm;

    const group = svgDocument.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("data-art-object-id", artObject.id);
    group.setAttribute(
      "transform",
      [
        `translate(${roundMm(placement.x)} ${roundMm(topMm)})`,
        `scale(${roundMm(scaleX)} ${roundMm(scaleY)})`,
        `translate(${-artObject.svgMetrics.x} ${-artObject.svgMetrics.y})`,
      ].join(" "),
    );

    for (const child of Array.from(svgElement.childNodes)) {
      group.appendChild(svgDocument.importNode(child, true));
    }

    root.appendChild(group);
  }

  return new XMLSerializer().serializeToString(svgDocument);
}

export function withCompositeElementIds(normalizedSvg: string, artObjectId: string) {
  const parser = new DOMParser();
  const document = parser.parseFromString(normalizedSvg, "image/svg+xml");
  const svg = document.querySelector("svg");
  if (!svg) {
    return normalizedSvg;
  }

  rewriteCompositeIds(svg, artObjectId);
  return new XMLSerializer().serializeToString(document);
}

export function getAutoPlacement(params: {
  settings: Settings | null;
  existingArtObjects: ArtObject[];
  widthMm: number;
  heightMm: number;
}) {
  const materialWidth = params.settings?.engraving.material_width ?? 300;
  const materialHeight = params.settings?.engraving.material_height ?? 300;
  let cursorX = IMPORT_GAP_MM;
  let cursorY = IMPORT_GAP_MM;
  let rowHeight = 0;

  const existing = [...params.existingArtObjects].sort((left, right) => left.id.localeCompare(right.id));
  for (const artObject of existing) {
    const nextX = artObject.placementX + artObject.widthMm + IMPORT_GAP_MM;
    rowHeight = Math.max(rowHeight, artObject.heightMm);

    if (nextX + params.widthMm <= materialWidth) {
      cursorX = nextX;
      cursorY = artObject.placementY;
    } else {
      cursorX = IMPORT_GAP_MM;
      cursorY = artObject.placementY + rowHeight + IMPORT_GAP_MM;
      rowHeight = 0;
    }
  }

  return clampPlacementToArtboard({
    artboardWidthMm: materialWidth,
    artboardHeightMm: materialHeight,
    placementX: cursorX,
    placementY: clamp(cursorY, 0, Math.max(0, materialHeight - params.heightMm)),
    svgWidthMm: params.widthMm,
    svgHeightMm: params.heightMm,
  });
}

export function resizeArtObjectWithAspect(
  artObject: ArtObject,
  width: number | null,
  height: number | null,
  settings: Settings,
) {
  const availableWidth = Math.max(1, settings.engraving.material_width - artObject.placementX);
  const availableHeight = Math.max(1, settings.engraving.material_height - artObject.placementY);

  if (artObject.aspectLocked) {
    const nextWidth = clamp(
      width ?? (height ? height * artObject.svgMetrics.aspectRatio : artObject.widthMm),
      1,
      Math.min(availableWidth, availableHeight * artObject.svgMetrics.aspectRatio),
    );
    return {
      widthMm: roundMm(nextWidth),
      heightMm: roundMm(nextWidth / artObject.svgMetrics.aspectRatio),
    };
  }

  return {
    widthMm: roundMm(clamp(width ?? artObject.widthMm, 1, availableWidth)),
    heightMm: roundMm(clamp(height ?? artObject.heightMm, 1, availableHeight)),
  };
}

export function localElementColor(artObject: ArtObject, compositeId: string) {
  const { elementId } = splitCompositeElementId(compositeId);
  return artObject.elementColors?.get(elementId) ?? null;
}

function rewriteCompositeIds(svgElement: SVGSVGElement, artObjectId: string) {
  for (const element of svgElement.querySelectorAll("[data-s2g-id]")) {
    const localId = element.getAttribute("data-s2g-id");
    if (!localId) {
      continue;
    }
    element.setAttribute("data-s2g-id", buildCompositeElementId(artObjectId, localId));
  }
}

function annotateAssignmentMetadata(svgElement: SVGSVGElement, artObject: ArtObject) {
  for (const element of svgElement.querySelectorAll("[data-s2g-id]")) {
    const compositeId = element.getAttribute("data-s2g-id");
    if (!compositeId) {
      continue;
    }
    const assignment = artObject.elementAssignments[compositeId];
    if (!assignment) {
      continue;
    }
    element.setAttribute("data-cut-depth", String(roundMm(assignment.targetDepthMm)));
    const engraveType = assignment.engraveType ?? fillModeToEngraveType(assignment.fillMode);
    element.setAttribute("data-engrave-type", engraveType);
  }
}
