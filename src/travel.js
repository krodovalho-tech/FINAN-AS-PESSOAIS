const PREFIX = '@finance-travel:';

// Keep travel metadata in the existing notes field so exports and recurring
// forecasts retain it, without replacing the transaction's financial category.
export function travelDetails(entry) {
  const notes = typeof entry?.notes === 'string' ? entry.notes : '';
  if (!notes.startsWith(PREFIX)) {
    const legacy = entry?.category === 'Viagem' && /(?:^|—)\s*viagem\s+(?:a\s+)?([^—]+?)(?:\s*—|$)/i.exec(entry.description || '');
    return { destination: legacy ? legacy[1].trim().replace(/,\s*([A-Z]{2})$/, ' / $1') : '', notes };
  }
  const end = notes.indexOf('\n');
  try {
    const metadata = JSON.parse(notes.slice(PREFIX.length, end < 0 ? undefined : end));
    if (typeof metadata.destination !== 'string') return { destination: '', notes };
    return { destination: metadata.destination, notes: end < 0 ? '' : notes.slice(end + 1) };
  } catch { return { destination: '', notes }; }
}

export function travelPayload(entry) {
  if (!Object.hasOwn(entry, 'destination')) return entry;
  const { destination, ...payload } = entry;
  const notes = typeof entry.notes === 'string' ? entry.notes : '';
  const value = String(destination || '').trim();
  return { ...payload, notes: value ? PREFIX + JSON.stringify({ destination: value }) + '\n' + notes : notes };
}

