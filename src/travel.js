const PREFIX = '@finance-travel:';

export function normalizeDestination(value) {
  return String(value || '').trim().replace(/\s*[,/]\s*([A-Za-z]{2})\s*$/, ' / $1').replace(/\s+/g, ' ');
}

// Keep travel metadata in the existing notes field so exports and recurring
// forecasts retain it, without replacing the transaction's financial category.
export function travelDetails(entry) {
  const notes = typeof entry?.notes === 'string' ? entry.notes : '';
  if (!notes.startsWith(PREFIX)) {
    const legacy = entry?.category === 'Viagem' && /(?:^|—)\s*viagem\s+(?:a\s+)?([^—]+?)(?:\s*—|$)/i.exec(entry.description || '');
    return { destination: legacy ? normalizeDestination(legacy[1]) : '', notes };
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

