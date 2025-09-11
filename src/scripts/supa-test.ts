import 'dotenv/config';
import { supa } from '@/lib/supabase';

const id = 'TESTROOM';
const state = { id, mode: 'lobby' };

await supa.from('rooms').upsert([{ id, version: 1, state_json: state }], {
  onConflict: 'id', ignoreDuplicates: false
});
const { data } = await supa.from('rooms').select('id,version').eq('id', id).maybeSingle();
console.log('[supa-test]', data);
