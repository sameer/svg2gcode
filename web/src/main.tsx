import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import './index.css'
import { initBridge } from './lib/bridge'

// Start WASM initialization in the background (non-blocking)
initBridge().catch((err) =>
  console.error('Failed to initialize svg2gcode WASM bridge:', err),
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
