import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev the game server runs on :3000 and Vite proxies the socket to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/socket.io': { target: 'http://localhost:3000', ws: true } },
  },
});
