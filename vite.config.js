import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(() => {
  // Managed OAuth issues sessions for Cloud. Legacy production overrides must
  // not send those sessions to a different authentication service.
  const cloudEnv = loadEnv('', process.cwd(), 'VITE_SUPABASE_');
  // Publishing may omit the sandbox's .env file. These are public client
  // settings, not secrets; retain the same issuing service in that environment.
  const cloudUrl = 'https://emlggkmtbosahpzrxaul.supabase.co';
  const cloudKey = cloudEnv.VITE_SUPABASE_URL === cloudUrl && cloudEnv.VITE_SUPABASE_PUBLISHABLE_KEY
    ? cloudEnv.VITE_SUPABASE_PUBLISHABLE_KEY
    : 'sb_publishable_9pB5Iuh6ERnbH-div9g3SA_rOWuQWX6';

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
