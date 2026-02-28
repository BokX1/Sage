// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  site: 'https://bokx1.github.io',
  base: '/Sage/',
  vite: {
    plugins: [tailwindcss()]
  },

  integrations: [react()]
});