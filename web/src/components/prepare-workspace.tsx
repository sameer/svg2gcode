import type { DragEvent } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import { LayerTree } from "@/components/layer-tree";
import { MaterialInspector } from "@/components/material-inspector";
import { StudioInspector } from "@/components/studio-inspector";
import { SvgCanvas } from "@/components/svg-canvas";
import { TopBar } from "@/components/top-bar";
import type {
  AlignmentAction,
  ArtObject,
  AssignmentProfileGroup,
  DistributionAction,
  DiveRootScope,
  EditorFocusScope,
  EditorInteractionMode,
  EditorSelection,
  InspectorContext,
  InspectorTab,
} from "@/lib/types";
import type { AdvancedMachiningField, CuttingSettingsView, MaterialSettingsView } from "@/editor/use-machining-settings";
import type { MaterialPresetId } from "@/lib/material-presets";
import type { EngraveType, FillMode, Settings } from "@/lib/types";

interface PrepareWorkspaceProps {
  artObjects: ArtObject[];
  projectName: string;
  onProjectNameChange: (name: string) => void;
  selection: EditorSelection;
  activeDiveRoot: DiveRootScope | null;
  focusScope: EditorFocusScope | null;
  interactionMode: EditorInteractionMode;
  effectiveInteractionMode: EditorInteractionMode;
  selectedUnitIds: string[];
  onSelectMaterial: () => void;
  onClearSelection: () => void;
  onSelectArtObject: (artObjectId: string) => void;
  onSelectArtObjects: (artObjectIds: string[], additive: boolean) => void;
  onSelectIds: (artObjectId: string, ids: string[], additive: boolean) => void;
  onFocusTreeScope: (artObjectId: string, scopeNodeId: string) => void;
  onHoverIdsChange: (ids: string[]) => void;
  onAddClick: () => void;
  onFileDrop: (event: DragEvent<HTMLDivElement>) => void | Promise<void>;
  activeTab: "prepare" | "preview";
  canPreview: boolean;
  isBusy: boolean;
  processLabel: string;
  processDisabled: boolean;
  exportDisabled: boolean;
  onTabChange: (tab: "prepare" | "preview") => void;
  onProcess: () => void;
  onExport: () => void;
  onPreviewBlocked: () => void;
  derivedOperations: {
    id: string;
    name: string;
    target_depth_mm: number;
    assigned_element_ids: string[];
    color: string | null;
    fill_mode?: FillMode | null;
  }[];
  hoveredIds: string[];
  activeProfileKey: string | null;
  isDiveMode: boolean;
  modifierDirectPick: boolean;
  showOperationOutlines: boolean;
  materialWidth: number;
  materialHeight: number;
  paddingMm: number;
  paddingValidationMessage: string | null;
  materialPreset: MaterialPresetId;
  onInteractionModeChange: (mode: EditorInteractionMode) => void;
  onEnterSvgDiveMode: (artObjectId: string) => void;
  onDrillIntoElement: (artObjectId: string, elementId: string) => boolean;
  onExitSvgDiveMode: () => void;
  onMaterialSizeChange: (dimension: "width" | "height", value: number | null) => void;
  onArtObjectPlacementChange: (artObjectId: string, x: number, y: number) => void;
  onArtObjectSizeChange: (artObjectId: string, width: number | null, height: number | null) => void;
  onArtObjectsTransformChange: (
    transforms: { artObjectId: string; x: number; y: number; width: number; height: number }[],
  ) => void;
  onShowOperationOutlinesChange: (value: boolean) => void;
  inspectorTab: InspectorTab;
  onInspectorTabChange: (tab: InspectorTab) => void;
  material: MaterialSettingsView | null;
  cutting: CuttingSettingsView | null;
  selectedArtObjectCount: number;
  recommendedAdvanced: {
    maxStepdown?: number;
    stepover?: number;
    cutFeedrate?: number;
    plungeFeedrate?: number;
  };
  advancedOverrides: Record<string, boolean>;
  onMaterialThicknessChange: (value: number | null) => void;
  onPaddingChange: (value: number | null) => void;
  onAlign: (value: AlignmentAction) => void;
  onDistribute: (value: DistributionAction) => void;
  onToolDiameterChange: (value: number | null) => void;
  onToolShapeChange: (value: "Flat" | "Ball" | "V") => void;
  onDefaultDepthChange: (value: number | null) => void;
  onDefaultEngraveTypeChange: (value: EngraveType) => void;
  onPassCountChange: (value: number | null) => void;
  onAdvancedFieldChange: (field: AdvancedMachiningField, value: number | null) => void;
  onMaterialPresetChange: (value: MaterialPresetId) => void;
  onResetAdvancedRecommendations: () => void;
  context: InspectorContext;
  activeArtObject: ArtObject | null;
  allProfileGroups: AssignmentProfileGroup[];
  settings: Settings | null;
  onSvgDimensionChange: (dimension: "width" | "height", value: number | null) => void;
  onSvgAspectLockChange: (value: boolean) => void;
  onPlacementChange: (x: number, y: number) => void;
  onBatchDepthChange: (elementIds: string[], value: number) => void;
  onBatchFillModeChange: (elementIds: string[], value: FillMode) => void;
  onProfilePreview: (profileKey: string | null) => void;
  onProfilePreviewClear: () => void;
  onProfileSelect: (elementIds: string[]) => void;
}

export function PrepareWorkspace(props: PrepareWorkspaceProps) {
  return (
    <PanelGroup direction="horizontal" className="h-full gap-0">
      <Panel defaultSize={20} minSize={16} maxSize={28}>
        <div className="h-full overflow-hidden bg-content1">
          <LayerTree
            artObjects={props.artObjects}
            projectName={props.projectName}
            onProjectNameChange={props.onProjectNameChange}
            selection={props.selection}
            activeDiveRootId={props.activeDiveRoot?.id ?? null}
            focusScope={props.focusScope}
            interactionMode={props.effectiveInteractionMode}
            selectedUnitIds={props.selectedUnitIds}
            onSelectMaterial={props.onSelectMaterial}
            onSelectArtObject={props.onSelectArtObject}
            onSelectArtObjects={props.onSelectArtObjects}
            onSelectIds={props.onSelectIds}
            onFocusTreeScope={props.onFocusTreeScope}
            onEnterSvgDiveMode={props.onEnterSvgDiveMode}
            onDrillIntoElement={props.onDrillIntoElement}
            onHoverIdsChange={props.onHoverIdsChange}
            onAddClick={props.onAddClick}
          />
        </div>
      </Panel>
      <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-primary/30" />
      <Panel defaultSize={56} minSize={36}>
        <div
          className="relative flex h-full flex-col overflow-hidden bg-content1"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => void props.onFileDrop(event)}
        >
          <TopBar
            activeTab={props.activeTab}
            canPreview={props.canPreview}
            isBusy={props.isBusy}
            processLabel={props.processLabel}
            processDisabled={props.processDisabled}
            exportDisabled={props.exportDisabled}
            onTabChange={props.onTabChange}
            onProcess={props.onProcess}
            onExport={props.onExport}
            onPreviewBlocked={props.onPreviewBlocked}
          />
          <div className="min-h-0 flex-1">
            <SvgCanvas
              artObjects={props.artObjects}
              operations={props.derivedOperations}
              selection={props.selection}
              hoveredIds={props.hoveredIds}
              activeOperationId={null}
              activeProfileKey={props.activeProfileKey}
              isDiveMode={props.isDiveMode}
              activeDiveRoot={props.activeDiveRoot}
              modifierDirectPick={props.modifierDirectPick}
              showOperationOutlines={props.showOperationOutlines}
              materialWidth={props.materialWidth}
              materialHeight={props.materialHeight}
              paddingMm={props.paddingMm}
              paddingValidationMessage={props.paddingValidationMessage}
              materialPreset={props.materialPreset}
              interactionMode={props.interactionMode}
              onInteractionModeChange={props.onInteractionModeChange}
              onClearSelection={props.onClearSelection}
              onSelectIds={props.onSelectIds}
              onSelectArtObjects={props.onSelectArtObjects}
              onSelectArtObject={props.onSelectArtObject}
              onEnterSvgDiveMode={props.onEnterSvgDiveMode}
              onDrillIntoElement={props.onDrillIntoElement}
              onExitSvgDiveMode={props.onExitSvgDiveMode}
              onImportClick={props.onAddClick}
              onMaterialSizeChange={props.onMaterialSizeChange}
              onArtObjectPlacementChange={props.onArtObjectPlacementChange}
              onArtObjectSizeChange={props.onArtObjectSizeChange}
              onArtObjectsTransformChange={props.onArtObjectsTransformChange}
              onShowOperationOutlinesChange={props.onShowOperationOutlinesChange}
            />
          </div>
        </div>
      </Panel>
      <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-primary/30" />
      <Panel defaultSize={26} minSize={18} maxSize={34}>
        <div className="h-full overflow-hidden bg-content1">
          <StudioInspector
            activeTab={props.inspectorTab}
            onTabChange={props.onInspectorTabChange}
            materialContent={
              <MaterialInspector
                material={props.material}
                cutting={props.cutting}
                materialPreset={props.materialPreset}
                paddingMm={props.paddingMm}
                selectedArtObjectCount={props.selectedArtObjectCount}
                recommendedAdvanced={props.recommendedAdvanced}
                advancedOverrides={props.advancedOverrides}
                onMaterialSizeChange={props.onMaterialSizeChange}
                onMaterialThicknessChange={props.onMaterialThicknessChange}
                onPaddingChange={props.onPaddingChange}
                onAlign={props.onAlign}
                onDistribute={props.onDistribute}
                onToolDiameterChange={props.onToolDiameterChange}
                onToolShapeChange={props.onToolShapeChange}
                onDefaultDepthChange={props.onDefaultDepthChange}
                onDefaultEngraveTypeChange={props.onDefaultEngraveTypeChange}
                onPassCountChange={props.onPassCountChange}
                onAdvancedFieldChange={props.onAdvancedFieldChange}
                onMaterialPresetChange={props.onMaterialPresetChange}
                onResetAdvancedRecommendations={props.onResetAdvancedRecommendations}
              />
            }
            context={props.context}
            activeArtObject={props.activeArtObject}
            allProfileGroups={props.allProfileGroups}
            activeProfileKey={props.activeProfileKey}
            settings={props.settings}
            paddingValidationMessage={props.paddingValidationMessage}
            onSvgDimensionChange={props.onSvgDimensionChange}
            onSvgAspectLockChange={props.onSvgAspectLockChange}
            onPlacementChange={props.onPlacementChange}
            onAlign={props.onAlign}
            onBatchDepthChange={props.onBatchDepthChange}
            onBatchFillModeChange={props.onBatchFillModeChange}
            onProfilePreview={props.onProfilePreview}
            onProfilePreviewClear={props.onProfilePreviewClear}
            onProfileSelect={props.onProfileSelect}
          />
        </div>
      </Panel>
    </PanelGroup>
  );
}
