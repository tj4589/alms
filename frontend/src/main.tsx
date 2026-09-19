import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/dm-sans'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './offline.ts'
import { initTheme } from './lib/theme'
import { dismissSplashAfterPaint } from './lib/splash'

initTheme()

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The shell is on screen as soon as this commits -- App decides between the
// landing page and the workspace from the stored token, with no fetch in
// between -- so the splash has nothing left to cover.
dismissSplashAfterPaint()
