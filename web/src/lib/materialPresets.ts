import oakTexture from '../assets/wood_types/oak-veneered-mdf-400-mm-architextures.jpg'
import mdfTexture from '../assets/wood_types/mdf-medium-density-fibreboard-400-mm-architextures.jpg'
import osbTexture from '../assets/wood_types/osb-1498-mm-architextures.jpg'

export type MaterialPreset = 'oak' | 'mdf' | 'osb'

export interface MaterialPresetDef {
  id: MaterialPreset
  label: string
  textureSrc: string
  textureScale: number
  defaultDepthMm: number
}

export const MATERIAL_PRESETS: MaterialPresetDef[] = [
  { id: 'oak', label: 'Oak', textureSrc: oakTexture, textureScale: 0.11, defaultDepthMm: 3 },
  { id: 'mdf', label: 'MDF', textureSrc: mdfTexture, textureScale: 0.11, defaultDepthMm: 5 },
  { id: 'osb', label: 'OSB', textureSrc: osbTexture, textureScale: 0.14, defaultDepthMm: 4 },
]

export const DEFAULT_MATERIAL: MaterialPreset = 'oak'
