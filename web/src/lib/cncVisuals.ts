import type { CncMetadata, EngraveType } from '../types/editor'

const MAX_CUT_DEPTH = 20
export type NormalizedEngraveType = 'contour' | 'pocket'

export interface CncVisualOverrides {
  stroke?: string
  strokeWidth?: number
  fill?: string
  shadowColor?: string
  shadowBlur?: number
  shadowOffsetX?: number
  shadowOffsetY?: number
  shadowEnabled?: boolean
}

const previewAlphaForDepth = (cutDepth: number): number => {
  const ratio = Math.min(1, Math.max(0, cutDepth / MAX_CUT_DEPTH))
  return 0.34 + ratio * 0.42
}

export function getEngravePreviewFill(depth: number): string {
  return `rgba(30, 14, 5, ${previewAlphaForDepth(depth).toFixed(2)})`
}

export function getEngravePreviewStroke(depth: number): string {
  const ratio = Math.min(1, Math.max(0, depth / MAX_CUT_DEPTH))
  return `rgba(18, 8, 2, ${(0.34 + ratio * 0.34).toFixed(2)})`
}

export function normalizeEngraveType(type?: EngraveType): NormalizedEngraveType | undefined {
  if (!type) {
    return undefined
  }

  return type === 'pocket' || type === 'raster' ? 'pocket' : 'contour'
}

export function resolveEngraveType(
  type: EngraveType | undefined,
  fallback: NormalizedEngraveType = 'pocket',
): NormalizedEngraveType {
  return normalizeEngraveType(type) ?? fallback
}

export function getCncVisualOverrides(
  cncMetadata?: CncMetadata,
  parentCncMetadata?: CncMetadata,
): CncVisualOverrides {
  if (!cncMetadata) return {}

  const { cutDepth, engraveType } = cncMetadata

  if (cutDepth === undefined || cutDepth === null) return {}

  if (
    parentCncMetadata?.cutDepth !== undefined &&
    parentCncMetadata.cutDepth === cutDepth
  ) {
    return {}
  }

  const ratio = Math.min(1, Math.max(0, cutDepth / MAX_CUT_DEPTH))
  const type = resolveEngraveType(engraveType, 'contour')

  if (type === 'pocket') {
    const fillAlpha = 0.30 + ratio * 0.65
    return {
      fill: `rgba(15, 8, 3, ${fillAlpha.toFixed(2)})`,
      stroke: `rgba(0, 0, 0, ${(0.4 + ratio * 0.5).toFixed(2)})`,
      strokeWidth: 4,
      shadowColor: 'rgba(0, 0, 0, 0.9)',
      shadowBlur: 2 + ratio * 12,
      shadowOffsetX: 0,
      shadowOffsetY: 1 + ratio * 3,
      shadowEnabled: true,
    }
  }

  const hue = Math.round(60 * (1 - ratio))
  return {
    stroke: `hsl(${hue}, 100%, 45%)`,
    strokeWidth: 1 + ratio * 1.5,
    shadowColor: 'rgba(0, 0, 0, 0.75)',
    shadowBlur: 1 + ratio * 5,
    shadowOffsetX: 0,
    shadowOffsetY: 1,
    shadowEnabled: true,
  }
}
