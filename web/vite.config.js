import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'node:path'
import { SUPABASE_URL } from './src/sb/config.js'

// Opens the connection to Supabase while the app script is still downloading: the first API call
// (and its CORS preflight) starts as soon as the script runs.
function preconnectSupabase() {
  return {
    name: 'preconnect-supabase',
    transformIndexHtml: () => [{ tag: 'link', attrs: { rel: 'preconnect', href: SUPABASE_URL, crossorigin: '' }, injectTo: 'head' }],
  }
}

export default defineConfig({
  base:'./', plugins:[react(), preconnectSupabase()], resolve:{ alias:{ '@': path.resolve('src') } },
  // Keep every font a separate file: inlined ones would be downloaded even when the page never uses them.
  build:{ assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined) },
})
