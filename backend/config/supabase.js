const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const baseClientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
};

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Warning: Supabase credentials not configured. Please set SUPABASE_URL and SUPABASE_ANON_KEY in .env file');
}

const dbKey = supabaseServiceRoleKey || supabaseAnonKey;

if (!supabaseServiceRoleKey) {
  console.warn('Warning: SUPABASE_SERVICE_ROLE_KEY is not configured. User provisioning and password reset flows may be limited.');
}

const supabase = createClient(supabaseUrl || '', dbKey || '', baseClientOptions);

const createSupabaseAuthClient = (accessToken = null) => createClient(
  supabaseUrl || '',
  supabaseAnonKey || '',
  {
    ...baseClientOptions,
    ...(accessToken
      ? {
          global: {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        }
      : {})
  }
);

const createSupabaseAdminClient = () => {
  if (!supabaseServiceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl || '', supabaseServiceRoleKey, baseClientOptions);
};

module.exports = supabase;
module.exports.createSupabaseAuthClient = createSupabaseAuthClient;
module.exports.createSupabaseAdminClient = createSupabaseAdminClient;
module.exports.hasSupabaseAdmin = Boolean(supabaseServiceRoleKey);
