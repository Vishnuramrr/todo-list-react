
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',

  plugins: [
    react(),

    VitePWA({
      registerType: 'autoUpdate',

      manifest: {
        name: 'My Daily Task Manager',
        short_name: 'Task Manager',
        description: 'Manage your daily tasks easily',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: './',
      },

      workbox: {
        navigateFallback: 'index.html',
      },
    }),
  ],
})
