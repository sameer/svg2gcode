/**
 * WASM bridge — wraps the three core svg2gcode-wasm functions.
 *
 * Before using any function, call `ensureWasmReady()` with a URL pointing to
 * your svg2gcode_wasm_bg.wasm file. The WASM init module must be importable
 * at the path configured by your bundler.
 *
 * To wire this up, re-export `ensureWasmReady` from your app entry and call it
 * once during startup with the correct WASM URL for your build setup.
 */

import init, {
  default_settings as wasmDefaultSettings,
  generate_engraving_job as wasmGenerateEngravingJob,
  prepare_svg_document as wasmPrepareSvgDocument,
} from "../../wasm/pkg/svg2gcode_wasm";

import type {
  GenerateJobRequest,
  GenerateJobResponse,
  JobProgress,
  PreparedSvgDocument,
  Settings,
} from "./types";

let wasmReadyPromise: Promise<void> | null = null;

interface WasmEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Initialize the WASM module. Call once at app startup.
 * @param wasmUrl - URL to the .wasm binary. Your bundler controls where this lives.
 */
export async function ensureWasmReady(wasmUrl?: string | URL) {
  if (!wasmReadyPromise) {
    wasmReadyPromise = init(wasmUrl).then(() => undefined);
  }
  await wasmReadyPromise;
}

export async function loadDefaultSettings() {
  await ensureWasmReady();
  return unwrapEnvelope<Settings>(wasmDefaultSettings());
}

export async function prepareSvgDocument(svg: string) {
  await ensureWasmReady();
  return unwrapEnvelope<PreparedSvgDocument>(wasmPrepareSvgDocument(svg));
}

/**
 * Generate a GCode engraving job from an SVG + settings + operations.
 *
 * @param request - The full job request (normalized SVG, settings, operations).
 * @param onProgress - Optional callback for progress updates.
 */
export async function generateEngravingJob(
  request: GenerateJobRequest,
  onProgress?: (progress: JobProgress) => void,
) {
  await ensureWasmReady();

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
    wasmGenerateEngravingJob(JSON.stringify(request), progressFn),
  );
}

function unwrapEnvelope<T>(payload: string) {
  const parsed = JSON.parse(payload) as WasmEnvelope<T>;
  if (!parsed.ok || parsed.data === undefined) {
    throw new Error(parsed.error ?? "Unknown WASM error");
  }
  return parsed.data;
}
