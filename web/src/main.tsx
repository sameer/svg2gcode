import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import "@fontsource/inter/index.css";
import './index.css'
import App from './App.tsx'

document.documentElement.classList.add("dark");

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
