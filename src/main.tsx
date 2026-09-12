import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from '@/src/App'
import { initTheme } from '@/src/lib/theme'
import '@/src/index.css'

/* The inline script in index.html has already painted the right palette to
 * avoid a flash; this re-applies it through the real module, which also wires
 * the 'system' listener and brings every theme-color meta in line. */
initTheme()

const container = document.getElementById('root')
if (!container) {
  throw new Error('AnemiaScan failed to mount: #root is missing from the document.')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
