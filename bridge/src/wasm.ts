/**
 * WASM bridge — wraps the three core svg2gcode-wasm functions.
 *
 * The bridge does NOT import the WASM module directly — the consumer
 * is responsible for loading it. Call `ensureWasmReady(bindings, wasmUrl)`
 * once at app startup before using any other bridge function.
 *
 * Example setup in your app:
 *
 *   import init, {
 *     default_settings,
 *     prepare_svg_document,
 *     generate_engraving_job,
 *   } from "./wasm/pkg/svg2gcode_wasm"
 *   import wasmUrl from "./wasm/pkg/svg2gcode_wasm_bg.wasm?url"
 *
 *   await ensureWasmReady(
 *     { default_settings, prepare_svg_document, generate_engraving_job },
 *     init,
 *     wasmUrl,
 *   )
 */

import type {
  GenerateJobRequest,
  GenerateJobResponse,
  JobProgress,
  PreparedSvgDocument,
  Settings,
} from "./types";

export interface WasmBindings {
  default_settings: () => string;
  prepare_svg_document: (svg: string) => string;
  generate_engraving_job: (input: string, on_progress?: Function) => string;
}

type WasmInitFn = (url?: string | URL) => Promise<unknown>;

let _bindings: WasmBindings | null = null;
let wasmReadyPromise: Promise<void> | null = null;

interface WasmEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Initialize the WASM module. Call once at app startup.
 *
 * @param bindings - The exported functions from the WASM module.
 * @param initFn   - The default export (init function) from the WASM module.
 * @param wasmUrl  - Optional URL to the .wasm binary (passed to init).
 */
export async function ensureWasmReady(
  bindings: WasmBindings,
  initFn: WasmInitFn,
  wasmUrl?: string | URL,
) {
  if (!wasmReadyPromise) {
    _bindings = bindings;
    wasmReadyPromise = initFn(wasmUrl).then(() => undefined);
  }
  await wasmReadyPromise;
}

function bindings(): WasmBindings {
  if (!_bindings) {
    throw new Error("WASM not initialized. Call ensureWasmReady() first.");
  }
  return _bindings;
}

export async function loadDefaultSettings() {
  await wasmReadyPromise;
  return unwrapEnvelope<Settings>(bindings().default_settings());
}

export async function prepareSvgDocument(svg: string) {
  await wasmReadyPromise;
  return unwrapEnvelope<PreparedSvgDocument>(bindings().prepare_svg_document(svg));
}

/**
 * Generate a GCode engraving job from an SVG + settings + operations.
 *
 * @param request    - The full job request (normalized SVG, settings, operations).
 * @param onProgress - Optional callback for progress updates.
 */
export async function generateEngravingJob(
  request: GenerateJobRequest,
  onProgress?: (progress: JobProgress) => void,
) {
  await wasmReadyPromise;

  if (onProgress) {
    onProgress({ phase: "processing", current: 0, total: request.operations.length });
  }

  const progressFn = onProgress
    ? (phaseStr: string, current: number, total: number) => {
        onProgress({
          phase: phaseStr as JobProgress["phase"],
          current,
          total,
        });
      }
    : undefined;

  return unwrapEnvelope<GenerateJobResponse>(
    bindings().generate_engraving_job(JSON.stringify(request), progressFn),
  );
}

function unwrapEnvelope<T>(payload: string) {
  const parsed = JSON.parse(payload) as WasmEnvelope<T>;
  if (!parsed.ok || parsed.data === undefined) {
    throw new Error(parsed.error ?? "Unknown WASM error");
  }
  return parsed.data;
}
