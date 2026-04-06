import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'

import { Canvas } from './Canvas'
import { GenerateGcodePanel } from './components/GenerateGcodePanel'
import { LayerTree } from './components/LayerTree'
import { StudioInspector } from './components/StudioInspector'
import { TopBar } from './components/TopBar'
import { useGcodeGeneration } from './hooks/useGcodeGeneration'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { importSvgToScene } from './lib/svgImport'
import { exportToSVG } from './lib/svgExport'
import { DEFAULT_MATERIAL, MATERIAL_PRESETS } from './lib/materialPresets'
import type { MaterialPreset } from './lib/materialPresets'
import { useEditorStore } from './store'

type InspectorTab = 'design' | 'material'

function App() {
  const artboard = useEditorStore((state) => state.artboard)
  const nodesById = useEditorStore((state) => state.nodesById)
  const rootIds = useEditorStore((state) => state.rootIds)
  const selectStage = useEditorStore((state) => state.selectStage)
  const stagePendingImport = useEditorStore((state) => state.stagePendingImport)
  const setImportStatus = useEditorStore((state) => state.setImportStatus)
  const setMachiningSettings = useEditorStore((state) => state.setMachiningSettings)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('design')
  const [projectName, setProjectName] = useState('Untitled project')
  const [materialPreset, setMaterialPreset] = useState<MaterialPreset>(DEFAULT_MATERIAL)

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

  const handleSvgImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!file) return

    try {
      const svgText = await file.text()
      const pendingScene = importSvgToScene({
        artboardWidth: artboard.width,
        artboardHeight: artboard.height,
        fileName: file.name,
        svgText,
      })
      stagePendingImport(pendingScene)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'The SVG import failed unexpectedly.'
      setImportStatus({ tone: 'error', message })
    }
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

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <input
        ref={fileInputRef}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={handleSvgImport}
      />

      <Group orientation="horizontal" className="flex-1">
        {/* Left: Layer tree */}
        <Panel defaultSize="20%" minSize="14%" maxSize="30%">
          <div className="h-full overflow-hidden border-r border-border bg-background">
            <LayerTree
              projectName={projectName}
              onProjectNameChange={setProjectName}
              onAddClick={() => fileInputRef.current?.click()}
              onSelectMaterial={handleSelectMaterial}
            />
          </div>
        </Panel>

        <Separator className="w-px bg-border transition-colors hover:bg-primary/30" />

        {/* Center: Canvas */}
        <Panel defaultSize="56%" minSize="36%">
          <div className="relative flex h-full flex-col overflow-hidden bg-background">
            <TopBar
              onExport={handleSvgExport}
              onImport={() => fileInputRef.current?.click()}
              onGenerateGcode={handleGenerateGcode}
              isGenerating={gcode.isGenerating}
            />
            {(gcode.isGenerating || gcode.result || gcode.error) && (
              <div className="pointer-events-none absolute inset-x-0 top-24 z-30 flex justify-center px-4">
                <GenerateGcodePanel
                  state={gcode}
                  onDownload={handleDownloadGcode}
                  onDismiss={gcode.reset}
                />
              </div>
            )}
            <div className="min-h-0 flex-1">
              <Canvas
                allowStageSelection={inspectorTab === 'material'}
                materialPreset={materialPreset}
              />
            </div>
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
