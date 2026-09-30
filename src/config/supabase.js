import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { config } from './index.js';
let supabaseClient = null;

export const getSupabaseClient = () => {
  if (supabaseClient) {
    return supabaseClient;
  }

  if (!config.supabaseUrl || !config.supabaseKey) {
    throw new Error(
      'Supabase credentials missing. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env'
    );
  }
supabaseClient = createClient(config.supabaseUrl, config.supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      transport: ws,
    },
});
  return supabaseClient;
};

export const isSupabaseConfigured = () => {
  return Boolean(config.supabaseUrl && config.supabaseKey);
};
