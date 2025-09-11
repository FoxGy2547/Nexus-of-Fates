import { createClient } from '@supabase/supabase-js';

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!; // server เท่านั้น

export const supa = createClient(url, key, {
  auth: { persistSession: false },
});
