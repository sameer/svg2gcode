import { useState } from 'react'
import { Button } from '@heroui/react'

import { resolveEffectiveMaxStepdown } from '../lib/bridgeSettingsAdapter'
import { useEditorStore } from '../store'
import type { MachiningSettings, RouterBitShape } from '../types/editor'
import type { CameraType } from '../types/preview'
import { MATERIAL_PRESETS } from '../lib/materialPresets'
import type { MaterialPreset } from '../lib/materialPresets'
import flatRouterBitImg from '../assets/router_bits/flat_router_bit.png'
import roundRouterBitImg from '../assets/router_bits/round_router_bit.png'
import vCarveBitImg from '../assets/router_bits/v_carve_bit.png'

interface MaterialTabContentProps {
  materialPreset: MaterialPreset
  onMaterialChange: (preset: MaterialPreset) => void
}

export function MaterialTabContent({ materialPreset, onMaterialChange }: MaterialTabContentProps) {
  const artboard = useEditorStore((s) => s.artboard)
  const selectedStage = useEditorStore((s) => s.selectedStage)
  const setArtboardSize = useEditorStore((s) => s.setArtboardSize)
  const machiningSettings = useEditorStore((s) => s.machiningSettings)
  const setMachiningSettings = useEditorStore((s) => s.setMachiningSettings)
  const nodesById = useEditorStore((s) => s.nodesById)
  const viewMode = useEditorStore((s) => s.preview.viewMode)
  const cameraType = useEditorStore((s) => s.preview.cameraType)
  const showStock = useEditorStore((s) => s.preview.showStock)
  const showSvgOverlay = useEditorStore((s) => s.preview.showSvgOverlay)
  const showRapidMoves = useEditorStore((s) => s.preview.showRapidMoves)
  const setCameraType = useEditorStore((s) => s.setCameraType)
  const setShowStock = useEditorStore((s) => s.setShowStock)
  const setShowSvgOverlay = useEditorStore((s) => s.setShowSvgOverlay)
  const setShowRapidMoves = useEditorStore((s) => s.setShowRapidMoves)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const setField = (patch: Partial<MachiningSettings>) => setMachiningSettings(patch)

  const maxCutDepth = Object.values(nodesById).reduce<number>((max, node) => {
    const d = node.cncMetadata?.cutDepth
    return d !== undefined && d > max ? d : max
  }, machiningSettings.defaultDepthMm)

  const depthPerPass =
    machiningSettings.passCount > 1
      ? Math.round((maxCutDepth / machiningSettings.passCount) * 100) / 100
      : null
  const effectiveMaxStepdown = resolveEffectiveMaxStepdown(machiningSettings, maxCutDepth)

  return (
    <div className="space-y-5">
      {/* Material selector */}
      <section className="space-y-3">
        <SectionHeading title="Material" />
        <div className="flex flex-wrap gap-2">
          <NumberPill label="W" value={artboard.width} unit="mm"
            onChange={(v) => { if (v !== null && v >= 1) setArtboardSize({ width: Math.round(v) }) }} />
          <NumberPill label="H" value={artboard.height} unit="mm"
            onChange={(v) => { if (v !== null && v >= 1) setArtboardSize({ height: Math.round(v) }) }} />
          <NumberPill label="T" value={artboard.thickness} unit="mm"
            onChange={(v) => { if (v !== null && v >= 0) setArtboardSize({ thickness: v }) }} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {MATERIAL_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`relative overflow-hidden rounded-lg border-2 transition ${
                materialPreset === preset.id
                  ? 'border-primary'
                  : 'border-border hover:border-border/80'
              }`}
              onClick={() => onMaterialChange(preset.id)}
            >
              <img
                src={preset.textureSrc}
                alt={preset.label}
                className="h-14 w-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-black/50 px-1 py-1 text-center text-xs font-medium text-white">
                {preset.label}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Router bit */}
      <section className="space-y-3">
        <SectionHeading title="Router bit" />
        <div className="flex items-end gap-3">
          <NumberField label="Diameter" unit="mm" value={machiningSettings.toolDiameter}
            onChange={(v) => { if (v !== null) setField({ toolDiameter: v }) }} />
          <NumberField label="Height" unit="mm" value={machiningSettings.defaultDepthMm}
            onChange={(v) => { if (v !== null) setField({ defaultDepthMm: v }) }} />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Shape</p>
          <div className="flex gap-3">
            {([['Flat', flatRouterBitImg], ['Ball', roundRouterBitImg], ['V', vCarveBitImg]] as [RouterBitShape, string][]).map(
              ([shape, img]) => (
                <button
                  key={shape}
                  type="button"
                  onClick={() => setField({ toolShape: shape })}
                  className={`flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-2 transition ${
                    machiningSettings.toolShape === shape
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-border/60'
                  }`}
                >
                  <img src={img} alt={shape} className="h-10 w-10 object-contain" />
                  <span className="text-xs text-foreground">{shape}</span>
                </button>
              ),
            )}
          </div>
        </div>
        <div className="flex items-end gap-3">
          <div className="grid gap-1">
            <p className="text-xs text-muted-foreground">Passes</p>
            <div className="inline-flex h-8 items-center rounded-md border border-border bg-content1 px-2">
              <input
                type="text"
                inputMode="numeric"
                className="w-10 border-0 bg-transparent px-0 text-sm text-foreground outline-none"
                value={String(machiningSettings.passCount)}
                onChange={(e) => {
                  const v = Math.max(1, Math.round(Number(e.target.value)))
                  if (Number.isFinite(v)) setField({ passCount: v })
                }}
              />
              <span className="pl-1 text-xs text-muted-foreground">x</span>
            </div>
          </div>
          {depthPerPass !== null && (
            <div className="flex h-8 flex-1 items-center justify-end gap-1 text-sm text-foreground">
              <span className="font-medium">
                {machiningSettings.maxStepdown != null ? effectiveMaxStepdown : depthPerPass} mm
              </span>
              <span className="text-xs text-muted-foreground">
                {machiningSettings.maxStepdown != null
                  ? `advanced override, total depth ${maxCutDepth} mm`
                  : `/ pass of ${maxCutDepth} mm`}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Tabs */}
      <section className="space-y-3">
        <SectionHeading title="Tabs" />
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={machiningSettings.tabsEnabled}
            onChange={(e) => setField({ tabsEnabled: e.target.checked })}
            className="rounded border-border"
          />
          Apply tabs on through-cuts
        </label>
        {machiningSettings.tabsEnabled && (
          <>
            <p className="text-xs text-muted-foreground">
              Tabs hold the part in place when cutting all the way through. Sand or snap them off after machining.
            </p>
            <div className="flex flex-wrap gap-3">
              <NumberField label="Width" unit="mm" value={machiningSettings.tabWidth}
                onChange={(v) => { if (v !== null && v > 0) setField({ tabWidth: v }) }} />
              <NumberField label="Height" unit="mm" value={machiningSettings.tabHeight}
                onChange={(v) => { if (v !== null && v > 0) setField({ tabHeight: v }) }} />
              <NumberField label="Spacing" unit="mm" value={machiningSettings.tabSpacing}
                onChange={(v) => { if (v !== null && v > 0) setField({ tabSpacing: v }) }} />
            </div>
          </>
        )}
      </section>

      {/* Advanced */}
      <section className="rounded-md border border-border bg-content1 px-3 py-3">
        <button
          type="button"
          className="flex w-full items-center gap-2 text-left"
          onClick={() => setAdvancedOpen((o) => !o)}
        >
          <span className="text-xs text-muted-foreground">{advancedOpen ? '▾' : '▸'}</span>
          <p className="text-sm font-medium text-foreground">Advanced</p>
        </button>
        {advancedOpen && (
          <div className="mt-3 flex flex-wrap gap-3">
            <NumberField label="Max Stepdown" unit="mm" value={machiningSettings.maxStepdown}
              onChange={(v) => setField({ maxStepdown: v })} />
            <div className="w-full -mt-1 text-xs text-muted-foreground">
              {machiningSettings.maxStepdown != null
                ? `Bridge uses the advanced max stepdown of ${effectiveMaxStepdown} mm.`
                : `Bridge derives max stepdown from Passes: ${effectiveMaxStepdown ?? maxCutDepth} mm.`}
            </div>
            <NumberField label="Stepover" unit="mm" value={machiningSettings.stepover}
              onChange={(v) => setField({ stepover: v })} />
            <NumberField label="Cut Feed" unit="mm/min" value={machiningSettings.cutFeedrate}
              onChange={(v) => setField({ cutFeedrate: v })} />
            <NumberField label="Plunge Feed" unit="mm/min" value={machiningSettings.plungeFeedrate}
              onChange={(v) => setField({ plungeFeedrate: v })} />
            <NumberField label="Travel Z" unit="mm" value={machiningSettings.travelZ}
              onChange={(v) => setField({ travelZ: v })} />
            <NumberField label="Cut Z" unit="mm" value={machiningSettings.cutZ}
              onChange={(v) => setField({ cutZ: v })} />
            <NumberField label="Machine W" unit="mm" value={machiningSettings.machineWidth}
              onChange={(v) => setField({ machineWidth: v })} />
            <NumberField label="Machine H" unit="mm" value={machiningSettings.machineHeight}
              onChange={(v) => setField({ machineHeight: v })} />
          </div>
        )}
      </section>

      {/* 3D Preview controls - only visible in preview mode */}
      {viewMode === 'preview3d' && (
        <section className="space-y-3">
          <SectionHeading title="3D Camera" />
          <div className="flex gap-2">
            {(['perspective', 'orthographic'] as CameraType[]).map((type) => (
              <Button
                key={type}
                size="sm"
                variant={cameraType === type ? 'primary' : 'secondary'}
                onPress={() => setCameraType(type)}
              >
                {type === 'perspective' ? 'Perspective' : 'Ortho'}
              </Button>
            ))}
          </div>

          <SectionHeading title="View options" />
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={showStock}
                onChange={(e) => setShowStock(e.target.checked)}
                className="rounded border-border"
              />
              Stock view (vs sweep volumes)
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={showSvgOverlay}
                onChange={(e) => setShowSvgOverlay(e.target.checked)}
                className="rounded border-border"
              />
              SVG path overlay
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={showRapidMoves}
                onChange={(e) => setShowRapidMoves(e.target.checked)}
                className="rounded border-border"
              />
              Show rapid moves
            </label>
          </div>
        </section>
      )}

      {/* Artboard position info */}
      <section className="space-y-3">
        <SectionHeading title="Artboard" />
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div className="rounded-md border border-border bg-content1 px-3 py-2">
            Offset X: {artboard.x}
          </div>
          <div className="rounded-md border border-border bg-content1 px-3 py-2">
            Offset Y: {artboard.y}
          </div>
        </div>
        <div className="rounded-md border border-border bg-content1 px-3 py-3 text-sm text-muted-foreground">
          {selectedStage
            ? 'Artboard selected — drag or resize on canvas.'
            : 'Click the stage to select the artboard.'}
        </div>
      </section>
    </div>
  )
}

// ── Shared UI components ──

function SectionHeading({
  title,
  rightContent,
}: {
  title: string
  rightContent?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {rightContent ? <div>{rightContent}</div> : null}
    </div>
  )
}

function NumberPill({
  label,
  value,
  unit,
  onChange,
}: {
  label: string
  value: number
  unit: string
  onChange: (value: number | null) => void
}) {
  const [editValue, setEditValue] = useState<string | null>(null)

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw)
    if (raw.trim() === '') {
      onChange(null)
    } else if (Number.isFinite(parsed)) {
      onChange(parsed)
    }
    setEditValue(null)
  }

  return (
    <div className="inline-flex h-8 items-center rounded-md border border-border bg-content1 px-2">
      <div className="shrink-0 text-xs text-muted-foreground">{label}</div>
      <input
        type="text"
        inputMode="decimal"
        className="w-12 border-0 bg-transparent px-1.5 text-sm text-foreground outline-none"
        value={editValue ?? String(value)}
        onFocus={(e) => {
          setEditValue(String(value))
          requestAnimationFrame(() => e.target.select())
        }}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') { setEditValue(null); e.currentTarget.blur() }
        }}
      />
      <div className="pl-1 text-xs text-muted-foreground">{unit}</div>
    </div>
  )
}

function NumberField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string
  unit: string
  value: number | null
  onChange: (value: number | null) => void
}) {
  const [editValue, setEditValue] = useState<string | null>(null)

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw)
    if (raw.trim() === '') {
      onChange(null)
    } else if (Number.isFinite(parsed)) {
      onChange(parsed)
    }
    setEditValue(null)
  }

  return (
    <div className="grid gap-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="inline-flex h-8 items-center rounded-md border border-border bg-content1 px-2">
        <input
          type="text"
          inputMode="decimal"
          placeholder="—"
          className="w-14 border-0 bg-transparent px-0 text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
          value={editValue ?? (value !== null ? String(value) : '')}
          onFocus={(e) => {
            setEditValue(value !== null ? String(value) : '')
            requestAnimationFrame(() => e.target.select())
          }}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') { setEditValue(null); e.currentTarget.blur() }
          }}
        />
        <div className="pl-1 text-xs text-muted-foreground">{unit}</div>
      </div>
    </div>
  )
}
