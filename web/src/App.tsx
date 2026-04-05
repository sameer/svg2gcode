import { PrepareWorkspace } from "@/components/prepare-workspace";
import { PreviewWorkspace } from "@/components/preview-workspace";
import { usePreviewController } from "@/editor/use-preview-controller";
import { useStudioController } from "@/editor/use-studio-controller";

function App() {
  const {
    fileInputRef,
    settings,
    artObjects,
    hoveredLayerIds,
    setHoveredLayerIds,
    generated,
    generatedOperationsSnapshot,
    error,
    showPreviewBlockedNotice,
    activeTab,
    setActiveTab,
    inspectorTab,
    selection,
    clearSelection,
    isDiveMode,
    activeDiveRoot,
    focusScope,
    interactionMode,
    setInteractionMode,
    effectiveInteractionMode,
    selectedUnitIds,
    modifierDirectPick,
    designActiveProfileKey,
    showOperationOutlines,
    setShowOperationOutlines,
    projectName,
    setProjectName,
    materialPreset,
    activeArtObject,
    selectedArtObjects,
    derivedOperations,
    allProfileGroups,
    inspectorContext,
    paddingValidationMessage,
    machining,
    handleSvgImport,
    handleFileDrop,
    handlePlacementChange,
    handleArtObjectPlacementChange,
    handleArtObjectSizeChange,
    handleArtObjectsTransformChange,
    handleSvgDimensionChange,
    handleSvgAspectLockChange,
    handleAlign,
    handleDistribute,
    selectMaterial,
    selectArtObject,
    selectArtObjects,
    selectIds,
    focusTreeScope,
    enterSvgDiveMode,
    drillIntoElement,
    exitSvgDiveMode,
    handleInspectorTabChange,
    changeBatchDepth,
    changeBatchFillMode,
    handleProfilePreview,
    handleProfileSelect,
    handleMakePath,
    downloadNc,
    notifyPreviewRequiresProcessing,
    isGenerating,
    isPreviewReady,
    processLabel,
    processDisabled,
    exportDisabled,
  } = useStudioController();
  const {
    parsedProgram,
    previewOperations,
    previewActiveOperationId,
    setPreviewActiveOperationId,
    previewCameraMode,
    setPreviewCameraMode,
    previewShowStock,
    setPreviewShowStock,
    previewCurrentDistance,
    setPreviewCurrentDistance,
    previewPlaying,
    setPreviewPlaying,
    previewLiveCutSimulation,
    activePreviewLineNumber,
    focusPreviewLine,
    stepPreviewLine,
    togglePreviewPlaying,
  } = usePreviewController(
    generated,
    generatedOperationsSnapshot,
    derivedOperations,
  );

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <input
        ref={fileInputRef}
        type="file"
        accept=".svg,image/svg+xml"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.length) {
            void handleSvgImport(event.target.files);
          }
        }}
      />

      {error && activeTab === "prepare" ? (
        <div className="absolute left-1/2 top-4 z-40 -translate-x-1/2 rounded-md border border-danger/30 bg-danger/15 px-3 py-2 text-xs text-danger-foreground">
          {error}
        </div>
      ) : null}
      {showPreviewBlockedNotice ? (
        <div className="absolute left-1/2 top-16 z-40 -translate-x-1/2 rounded-md border border-warning/30 bg-warning/15 px-3 py-2 text-xs text-warning-foreground">
          Process first to preview GCODE
        </div>
      ) : null}

      <div className="relative z-10 min-h-0 flex-1 p-0">
        {activeTab === "prepare" ? (
          <PrepareWorkspace
            artObjects={artObjects}
            projectName={projectName}
            onProjectNameChange={setProjectName}
            selection={selection}
            activeDiveRoot={activeDiveRoot}
            focusScope={focusScope}
            interactionMode={interactionMode}
            effectiveInteractionMode={effectiveInteractionMode}
            selectedUnitIds={selectedUnitIds}
            onSelectMaterial={selectMaterial}
            onClearSelection={clearSelection}
            onSelectArtObject={selectArtObject}
            onSelectArtObjects={selectArtObjects}
            onSelectIds={selectIds}
            onFocusTreeScope={focusTreeScope}
            onHoverIdsChange={setHoveredLayerIds}
            onAddClick={() => fileInputRef.current?.click()}
            onFileDrop={handleFileDrop}
            activeTab={activeTab}
            canPreview={isPreviewReady}
            isBusy={isGenerating}
            processLabel={processLabel}
            processDisabled={processDisabled}
            exportDisabled={exportDisabled}
            onTabChange={setActiveTab}
            onProcess={() => void handleMakePath()}
            onExport={downloadNc}
            onPreviewBlocked={notifyPreviewRequiresProcessing}
            derivedOperations={derivedOperations}
            hoveredIds={hoveredLayerIds}
            activeProfileKey={designActiveProfileKey}
            isDiveMode={isDiveMode}
            modifierDirectPick={modifierDirectPick}
            showOperationOutlines={showOperationOutlines}
            materialWidth={settings?.engraving.material_width ?? 300}
            materialHeight={settings?.engraving.material_height ?? 300}
            paddingMm={machining.paddingMm}
            paddingValidationMessage={paddingValidationMessage}
            materialPreset={materialPreset}
            onInteractionModeChange={setInteractionMode}
            onEnterSvgDiveMode={enterSvgDiveMode}
            onDrillIntoElement={drillIntoElement}
            onExitSvgDiveMode={exitSvgDiveMode}
            onMaterialSizeChange={machining.setMaterialDimension}
            onArtObjectPlacementChange={handleArtObjectPlacementChange}
            onArtObjectSizeChange={handleArtObjectSizeChange}
            onArtObjectsTransformChange={handleArtObjectsTransformChange}
            onShowOperationOutlinesChange={setShowOperationOutlines}
            inspectorTab={inspectorTab}
            onInspectorTabChange={handleInspectorTabChange}
            material={machining.material}
            cutting={machining.cutting}
            selectedArtObjectCount={selectedArtObjects.length}
            recommendedAdvanced={machining.recommendedAdvanced}
            advancedOverrides={machining.advancedOverrides}
            onMaterialThicknessChange={machining.setMaterialThickness}
            onPaddingChange={machining.setPaddingMm}
            onAlign={handleAlign}
            onDistribute={handleDistribute}
            onToolDiameterChange={machining.setToolDiameter}
            onToolShapeChange={machining.setToolShape}
            onDefaultDepthChange={machining.setDefaultDepth}
            onDefaultEngraveTypeChange={machining.setDefaultEngrave}
            onPassCountChange={machining.setPassCount}
            onAdvancedFieldChange={machining.setAdvancedField}
            onMaterialPresetChange={machining.setMaterialType}
            onResetAdvancedRecommendations={machining.resetAdvancedRecommendations}
            context={inspectorContext}
            activeArtObject={activeArtObject}
            allProfileGroups={allProfileGroups}
            settings={settings}
            onSvgDimensionChange={handleSvgDimensionChange}
            onSvgAspectLockChange={handleSvgAspectLockChange}
            onPlacementChange={handlePlacementChange}
            onBatchDepthChange={changeBatchDepth}
            onBatchFillModeChange={changeBatchFillMode}
            onProfilePreview={handleProfilePreview}
            onProfilePreviewClear={() => handleProfilePreview(null)}
            onProfileSelect={handleProfileSelect}
          />
        ) : (
          <PreviewWorkspace
            projectName={projectName}
            projectSubtitle="3D Design Project"
            generated={generated}
            parsedProgram={parsedProgram}
            previewOperations={previewOperations}
            error={error}
            activePreviewLineNumber={activePreviewLineNumber}
            previewActiveOperationId={previewActiveOperationId}
            onLineSelect={focusPreviewLine}
            onStepLine={stepPreviewLine}
            onOperationSelect={setPreviewActiveOperationId}
            activeTab={activeTab}
            canPreview={isPreviewReady}
            isBusy={isGenerating}
            processLabel={processLabel}
            processDisabled={processDisabled}
            exportDisabled={exportDisabled}
            onTabChange={setActiveTab}
            onProcess={() => void handleMakePath()}
            onExport={downloadNc}
            onPreviewBlocked={notifyPreviewRequiresProcessing}
            previewCurrentDistance={previewCurrentDistance}
            previewShowStock={previewShowStock}
            previewLiveCutSimulation={previewLiveCutSimulation}
            previewCameraMode={previewCameraMode}
            isPlaying={previewPlaying}
            onDistanceChange={(distance) => {
              setPreviewPlaying(false);
              setPreviewCurrentDistance(distance);
            }}
            onTogglePlaying={togglePreviewPlaying}
            onCameraModeChange={setPreviewCameraMode}
            onShowStockChange={setPreviewShowStock}
          />
        )}
      </div>
    </div>
  );
}

export default App;
