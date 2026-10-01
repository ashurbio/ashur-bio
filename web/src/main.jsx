import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { initMotion } from '@/sb/motion'
import { initFonts } from '@/sb/fonts'

initMotion()
initFonts()

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
