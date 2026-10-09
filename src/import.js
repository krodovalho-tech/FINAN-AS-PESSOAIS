export function normalizeImport(data) {
  const items = Array.isArray(data) ? data : data?.transactions;
  if (!Array.isArray(items)) throw new Error('O JSON deve conter lançamentos ou transactions.');
  return items.map((e, i) => {
    const amount = Number(e.amount);
    const rawDate = String(e.date || "");
    const date = /^\d{8}$/.test(rawDate) ? `${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}` : rawDate.slice(0,10);
    const reviewed = !Array.isArray(data);
    const entry = { ...e, date, type: reviewed ? (amount >= 0 ? 'income' : 'expense') : e.type,
      amount: Math.abs(amount), description: e.description || e.memo,
      source_id: e.source_id || (reviewed && e.id != null ? String(e.id) : null),
      bank: e.bank || null, confirmed: e.confirmed === true, recurring: !!e.recurring };
    if (!['income','expense'].includes(entry.type) || !Number.isFinite(amount) || amount === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date || '') || !entry.description || !entry.category) throw new Error(`Lançamento ${i+1} inválido. Revise data, valor, descrição e categoria.`);
    if (!entry.notes && e.reconciliation) entry.notes = JSON.stringify(e.reconciliation);
    return entry;
  });
}


export async function detectImportFormat(file) {
  if (!file.size) throw new Error('O arquivo está vazio. Baixe o extrato novamente antes de importar.');
  const header = await file.slice(0, 1024).text();
  if (header.includes('%PDF-')) return 'pdf';
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    throw new Error('O arquivo selecionado não contém um PDF válido. Baixe o extrato novamente.');
  }
  if (/\.ofx$/i.test(file.name) || /<OFX[\s>]|OFXHEADER:/i.test(header)) return 'ofx';
  if (/\.csv$/i.test(file.name)) return 'csv';
  if (/^[\s\uFEFF]*[\[{]/.test(header)) return 'json';
  throw new Error('Formato não reconhecido. Selecione um extrato PDF da Unicred, OFX, CSV ou JSON.');
}

export function parseImportJSON(content) {
  let data;
  try { data = JSON.parse(content.replace(/^\uFEFF/, '')); }
  catch { throw new Error('O arquivo JSON está incompleto ou inválido. Baixe ou exporte o arquivo novamente.'); }
  return normalizeImport(data);
}
