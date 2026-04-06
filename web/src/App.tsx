import { useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'

import { Canvas } from './Canvas'
import { GenerateGcodePanel } from './components/GenerateGcodePanel'
import { LayerTree } from './components/LayerTree'
import { StudioInspector } from './components/StudioInspector'
import { TopBar } from './components/TopBar'
import { PreviewCanvas } from './components/preview/PreviewCanvas'
import { PlaybackTimeline } from './components/preview/PlaybackTimeline'
import { GcodeViewer } from './components/preview/GcodeViewer'
import { useGcodeGeneration } from './hooks/useGcodeGeneration'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { importSvgToScene } from './lib/svgImport'
import { exportToSVG } from './lib/svgExport'
import { DEFAULT_MATERIAL, MATERIAL_PRESETS } from './lib/materialPresets'
import type { MaterialPreset } from './lib/materialPresets'
import { useEditorStore } from './store'
import type { ViewMode } from './types/preview'

type InspectorTab = 'design' | 'material'

function App() {
  const artboard = useEditorStore((state) => state.artboard)
  const nodesById = useEditorStore((state) => state.nodesById)
  const rootIds = useEditorStore((state) => state.rootIds)
  const selectStage = useEditorStore((state) => state.selectStage)
  const stagePendingImport = useEditorStore((state) => state.stagePendingImport)
  const placePendingImport = useEditorStore((state) => state.placePendingImport)
  const setImportStatus = useEditorStore((state) => state.setImportStatus)
  const setMachiningSettings = useEditorStore((state) => state.setMachiningSettings)
  const viewMode = useEditorStore((state) => state.preview.viewMode)
  const setViewMode = useEditorStore((state) => state.setViewMode)
  const initPreview = useEditorStore((state) => state.initPreview)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('design')
  const [projectName, setProjectName] = useState('Untitled project')
  const [materialPreset, setMaterialPreset] = useState<MaterialPreset>(DEFAULT_MATERIAL)
  const [isDragOver, setIsDragOver] = useState(false)

  const isCanvasEmpty = rootIds.length === 0

  const gcode = useGcodeGeneration()

  useKeyboardShortcuts()

  const handleSvgExport = () => {
    const svgString = exportToSVG(nodesById, rootIds, artboard)
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'cnc-export.svg'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const processSvgFile = async (file: File, autoPlace = false) => {
    try {
      const svgText = await file.text()
      const pendingScene = importSvgToScene({
        artboardWidth: artboard.width,
        artboardHeight: artboard.height,
        fileName: file.name,
        svgText,
      })
      if (autoPlace) {
        stagePendingImport(pendingScene)
        placePendingImport({ x: 0, y: 0 })
      } else {
        stagePendingImport(pendingScene)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'The SVG import failed unexpectedly.'
      setImportStatus({ tone: 'error', message })
    }
  }

  const handleSvgImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!file) return
    await processSvgFile(file, false)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = Array.from(e.dataTransfer.files).find(
      (f) => f.type === 'image/svg+xml' || f.name.toLowerCase().endsWith('.svg'),
    )
    if (!file) return
    await processSvgFile(file, true)
  }

  const handleGenerateGcode = async () => {
    const result = await gcode.generate()
    if (result) {
      setImportStatus({
        tone: 'success',
        message: `GCode generated: ${result.gcode.split('\n').length.toLocaleString()} lines`,
      })
    }
  }

  const handleDownloadGcode = () => {
    if (gcode.result) {
      gcode.downloadGcode(gcode.result.gcode, `${projectName || 'output'}.gcode`)
    }
  }

  const handleSelectMaterial = () => {
    selectStage()
    setInspectorTab('material')
  }

  const handleMaterialChange = (preset: MaterialPreset) => {
    setMaterialPreset(preset)

    const presetDef = MATERIAL_PRESETS.find((entry) => entry.id === preset)
    if (presetDef) {
      setMachiningSettings({ defaultDepthMm: presetDef.defaultDepthMm })
    }
  }

  const handleViewModeChange = (mode: ViewMode) => {
    if (mode === 'preview' && gcode.result) {
      initPreview(gcode.result)
    } else {
      setViewMode(mode)
    }
  }

  const handlePreview = () => {
    if (gcode.result) {
      initPreview(gcode.result)
    }
  }

  const isPreview = viewMode === 'preview'

  return (
    <div
      className="flex h-screen flex-col bg-background text-foreground"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={handleSvgImport}
      />

      <Group orientation="horizontal" className="flex-1">
        {/* Left sidebar */}
        <Panel defaultSize="20%" minSize="14%" maxSize="30%">
          <div className="h-full overflow-hidden border-r border-border bg-background">
            {isPreview ? (
              <GcodeViewer />
            ) : (
              <LayerTree
                projectName={projectName}
                onProjectNameChange={setProjectName}
                onAddClick={() => fileInputRef.current?.click()}
                onSelectMaterial={handleSelectMaterial}
              />
            )}
          </div>
        </Panel>

        <Separator className="w-px bg-border transition-colors hover:bg-primary/30" />

        {/* Center: Canvas or 3D Preview */}
        <Panel defaultSize="56%" minSize="36%">
          <div className="relative flex h-full flex-col overflow-hidden bg-background">
            <TopBar
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              onExport={handleSvgExport}
              onImport={() => fileInputRef.current?.click()}
              onGenerateGcode={handleGenerateGcode}
              onPreview={handlePreview}
              isGenerating={gcode.isGenerating}
              progress={gcode.progress}
              hasGcodeResult={!!gcode.result}
            />
            {!isPreview && (gcode.result || gcode.error) && (
              <div className="pointer-events-none absolute inset-x-0 top-24 z-30 flex justify-center px-4">
                <GenerateGcodePanel
                  state={gcode}
                  onDownload={handleDownloadGcode}
                  onDismiss={gcode.reset}
                />
              </div>
            )}
            <div className="min-h-0 flex-1 relative">
              {isPreview ? (
                <PreviewCanvas />
              ) : (
                <Canvas
                  allowStageSelection={inspectorTab === 'material'}
                  materialPreset={materialPreset}
                />
              )}

              {/* Empty-state drop zone — only shown when the artboard has no content */}
              {!isPreview && isCanvasEmpty && !isDragOver && (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                  <div
                    className="pointer-events-auto flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-border bg-background/80 px-12 py-10 text-center backdrop-blur-sm"
                    onClick={() => fileInputRef.current?.click()}
                    style={{ cursor: 'pointer' }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="40"
                      height="40"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-muted-foreground"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <div>
                      <p className="text-base font-semibold text-foreground">
                        Import or drag an SVG to begin
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Drop a file anywhere, or click to browse
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Drag-over highlight */}
              {isDragOver && (
                <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
                  <div className="absolute inset-2 rounded-2xl border-2 border-dashed border-primary bg-primary/5" />
                  <div className="relative flex flex-col items-center gap-3 rounded-xl bg-background/90 px-10 py-8 text-center shadow-lg backdrop-blur-sm">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="36"
                      height="36"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-primary"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <p className="text-base font-semibold text-foreground">Drop to import SVG</p>
                  </div>
                </div>
              )}
            </div>

            {/* Playback timeline at bottom in preview mode */}
            {isPreview && <PlaybackTimeline />}
          </div>
        </Panel>

        <Separator className="w-px bg-border transition-colors hover:bg-primary/30" />

        {/* Right: Studio inspector */}
        <Panel defaultSize="24%" minSize="18%" maxSize="34%">
          <div className="h-full overflow-hidden border-l border-border bg-background">
            <StudioInspector
              activeTab={inspectorTab}
              onTabChange={setInspectorTab}
              materialPreset={materialPreset}
              onMaterialChange={handleMaterialChange}
            />
          </div>
        </Panel>
      </Group>
    </div>
  )
}

export default App
