import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(() => {
  // Managed OAuth issues sessions for Cloud. Legacy production overrides must
  // not send those sessions to a different authentication service.
  const cloudEnv = loadEnv('', process.cwd(), 'VITE_SUPABASE_');
  const cloudUrl = cloudEnv.VITE_SUPABASE_URL;
  const cloudKey = cloudEnv.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!cloudUrl || !cloudKey) throw new Error('Lovable Cloud authentication configuration is missing.');

  return {
  define: {
    'import.meta.env.VITE_AUTH_SUPABASE_URL': JSON.stringify(cloudUrl),
    'import.meta.env.VITE_AUTH_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(cloudKey),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(cloudUrl),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(cloudKey),
  },
  plugins: [react()],
  server: {
    port: 3000,
    open: false,
    host: true
  }
  };
})
