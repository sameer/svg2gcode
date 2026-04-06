import {
  ensureWasmReady,
  loadDefaultSettings,
  type Settings,
} from "@svg2gcode/bridge"

// Vite resolves this to the asset URL at build time
import wasmUrl from "../wasm/pkg/svg2gcode_wasm_bg.wasm?url"

let bridgeSettings: Settings | null = null
let initPromise: Promise<Settings> | null = null

/**
 * Initialize the WASM bridge and load default settings.
 * Safe to call multiple times — subsequent calls return the cached promise.
 */
export function initBridge(): Promise<Settings> {
  if (!initPromise) {
    initPromise = (async () => {
      await ensureWasmReady(wasmUrl)
      bridgeSettings = await loadDefaultSettings()
      return bridgeSettings
    })()
  }
  return initPromise
}

/** Get the cached bridge default settings (null if not yet initialized). */
export function getBridgeSettings(): Settings | null {
  return bridgeSettings
}
