import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' — приложение работает из любой папки, в том числе
// https://<имя>.github.io/<репозиторий>/ на GitHub Pages.
export default defineConfig({
  base: './',
  plugins: [react()],
});
