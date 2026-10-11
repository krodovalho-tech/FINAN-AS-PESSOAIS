const PREFIX = '@finance-travel:';

export function normalizeDestination(value) {
  return String(value || '').trim().replace(/\s*(?:,|\/|\s)\s*([A-Za-z]{2})\s*$/, ' / $1').replace(/\s+/g, ' ');
}

// Descriptions sent by voice/chat may use any dash or put payment in parentheses.
export function destinationFromDescription(description) {
  const match = /(?:^|[—–-]|\s)\s*viagem\s+(?:a\s+|para\s+)?([^—–()]+?)(?=\s*[—–(]|\s+-\s+|$)/i.exec(String(description || ''));
  return match ? normalizeDestination(match[1]) : '';
}

// Keep travel metadata in the existing notes field so exports and recurring
// forecasts retain it, without replacing the transaction's financial category.
export function travelDetails(entry) {
  const notes = typeof entry?.notes === 'string' ? entry.notes : '';
  if (!notes.startsWith(PREFIX)) {
    return { destination: destinationFromDescription(entry?.description), notes };
  }
  const end = notes.indexOf('\n');
  try {
    const metadata = JSON.parse(notes.slice(PREFIX.length, end < 0 ? undefined : end));
    if (typeof metadata.destination !== 'string') return { destination: '', notes };
    return { destination: normalizeDestination(metadata.destination), notes: end < 0 ? '' : notes.slice(end + 1) };
  } catch { return { destination: '', notes }; }
}

export function travelPayload(entry) {
  if (!Object.hasOwn(entry, 'destination')) return entry;
  const { destination, ...payload } = entry;
  const notes = typeof entry.notes === 'string' ? entry.notes : '';
  const value = normalizeDestination(destination);
  return { ...payload, notes: value ? PREFIX + JSON.stringify({ destination: value }) + '\n' + notes : notes };
}


// Dashboard groups linked expenses once; stored financial categories remain intact.
export function dashboardCategory(entry) {
  // Viagem é uma dimensão transversal: o dashboard mensal preserva a natureza
  // financeira (Combustível, Alimentação, Hospedagem etc.). O custo integral
  // por destino é calculado separadamente por travelDetails + purchaseCosts.
  return entry.category;
}

export const TRAVEL_FOOD_CATEGORY = "Alimentação — Bares, restaurantes e lanches";

export function travelCategory(entry) {
  const category = String(entry.category || "").trim();
  const normalized = category.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[—–-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (['alimentacao', 'alimentacao e lanches', 'alimentacao bares, restaurantes e lanches', 'bares, restaurantes e lanches'].includes(normalized)) return TRAVEL_FOOD_CATEGORY;
  if (category && !/^viagem$/i.test(category)) return category;
  const description = String(entry.description || "").toLowerCase();
  if (/hospedagem|hotel|pousada|diária/.test(description)) return "Hospedagem";
  if (/combustível|abastecimento|gasolina|etanol|diesel/.test(description)) return "Combustível";
  if (/alimentação|almoço|jantar|lanche|restaurante|churros|café da manhã/.test(description)) return TRAVEL_FOOD_CATEGORY;
  if (/presente|brinde|mimo|lembrancinha/.test(description)) return "Presentes e mimos";
  if (/entrada|ingresso|passeio|complexo novo banho|parque/.test(description)) return "Passeios";
  return "Outros / a classificar";
}
