export const FOOD_SUPERMARKET = 'Alimentação — supermercado';
export const FOOD_RESTAURANTS = 'Alimentação — bares, restaurantes e lanches';
const clean = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[—–-]/g,' ').replace(/\s+/g,' ').trim();
export function normalizeFoodCategory(category, description = '') {
  const c = clean(category), d = clean(description);
  if (c === 'alimentacao supermercado' || c === 'supermercado') return FOOD_SUPERMARKET;
  if (c === 'alimentacao bares, restaurantes e lanches' || c === 'bares, restaurantes e lanches' || c === 'alimentacao fora de casa') return FOOD_RESTAURANTS;
  if (c !== 'alimentacao' && c !== 'alimentacao e lanches') return category;
  if (/supermercado|mercado|compras de mercado|hortifruti|acougue|atacadao|assai|feira livre|mercearia|rancho de supermercado/.test(d)) return FOOD_SUPERMARKET;
  return FOOD_RESTAURANTS;
}
export function normalizeFoodEntry(entry) {
  return entry?.type === 'expense' ? {...entry,category:normalizeFoodCategory(entry.category,entry.description)} : entry;
}
