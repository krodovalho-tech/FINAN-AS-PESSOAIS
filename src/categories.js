import { normalizeFoodCategory } from './food-categories.js';
// Equivalent legacy spellings share one reporting category; amounts and identities stay intact.
export function normalizeCategory(category,description=''){
 const key=String(category||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
 if(key==='investimento'||key==='investimentos')return 'Investimento';
 return normalizeFoodCategory(category,description);
}
