const PREFIX = '@finance-card:';
const cents = value => Math.round(Number(value) * 100);
// Assistant request IDs identify a parcel; the shared prefix identifies its purchase.
export function normalizeAssistantCard(card, date) {
  const match = /^assistant:(.+)-p(\d+)$/.exec(card.purchase_id || '');
  if (!match || Number(match[2]) !== card.installment) return card;
  const d = new Date(String(date).slice(0, 10) + 'T12:00:00Z');
  if (!Number.isFinite(d.getTime())) return card;
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - (card.installment - 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return { ...card, purchase_id: `assistant:${match[1]}`, purchase_date: d.toISOString().slice(0, 10) };
}
export function cardDetails(entry) {
  const line = String(entry?.notes || '').split('\n').find(s => s.startsWith(PREFIX));
  if (line) { try {
    const c = JSON.parse(line.slice(PREFIX.length));
    if (c.purchase_id && Number.isInteger(c.installment) && Number.isInteger(c.count) && c.installment >= 1 && c.installment <= c.count && cents(c.total) > 0) return normalizeAssistantCard(c, entry.date);
  } catch {} }
  // Compatibility with installments previously entered by the assistant.
  const description = String(entry?.description || '');
  const part = /parcela\s+(\d+)\/(\d+)/i.exec(description);
  const total = /compra total R\$\s*([\d.]+,\d{2})/i.exec(description);
  if (!part || !total || +part[1] < 1 || +part[1] > +part[2]) return null;
  const d = new Date(String(entry.date).slice(0, 10) + 'T12:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - (+part[1] - 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
  d.setUTCDate(Math.min(day,last));
  const base = description.replace(/parcela\s+\d+\/\d+/i, 'parcelas').trim();
  return { purchase_id: `legacy:${base}:${d.toISOString().slice(0,7)}`, installment: +part[1], count: +part[2], total: Number(total[1].replaceAll('.', '').replace(',', '.')), purchase_date: d.toISOString().slice(0,10), card: '' };
}
export function cardNotes(notes, card) {
  const rest = String(notes || '').split('\n').filter(s => !s.startsWith(PREFIX)).join('\n');
  return rest + '\n' + PREFIX + JSON.stringify(card);
}
export function isCardPayment(entry) { return entry?.reconciliation?.kind === 'card_payment'; }
export function purchaseCosts(entries) {
  const seen = new Set();
  return entries.filter(e => e.type === 'expense' && !isCardPayment(e)).flatMap(e => {
    const card = cardDetails(e);
    if (!card) return [e];
    if (seen.has(card.purchase_id)) return [];
    seen.add(card.purchase_id);
    return [{ ...e, amount: card.total, date: card.purchase_date, card }];
  });
}
export function dashboardEntries(entries, mode = 'purchases') {
  if (mode === 'installments') return entries.filter(e => !isCardPayment(e));
  const ordered = [...entries].sort((a,b) => (cardDetails(a)?.installment || 0) - (cardDetails(b)?.installment || 0));
  return [...entries.filter(e => e.type === 'income' && !isCardPayment(e)), ...purchaseCosts(ordered)];
}
export function installmentSchedule(entry, count, card, purchaseId) {
  const total = cents(entry.amount);
  if (!Number.isInteger(count) || count < 1 || count > 60 || total < count || !purchaseId || !entry.date) throw new Error('Confira valor, data e quantidade de parcelas (1 a 60).');
  const first = new Date(entry.date + 'T12:00:00Z');
  if (!Number.isFinite(first.getTime())) throw new Error('Data inválida.');
  return Array.from({ length: count }, (_, i) => {
    const month = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1, 12));
    const last = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
    month.setUTCDate(Math.min(first.getUTCDate(), last));
    const info = { purchase_id: purchaseId, total: total / 100, count, installment: i + 1, purchase_date: entry.purchase_date || entry.date, card: String(card || '').trim() };
    return { ...entry, amount: (Math.floor(total / count) + (i < total % count ? 1 : 0)) / 100, date: month.toISOString().slice(0,10), recurring: false, bank: 'Cartão · ' + (info.card || 'Não informado'), source_id: `${purchaseId}:${i+1}`, notes: cardNotes(entry.notes, info), confirmed: false };
  });
}
// Explicit aliases for this account; never match arbitrary account suffixes.
export function canonicalAccount(bank) {
  const value = String(bank || '').trim();
  if (/^Unicred(?: 566 • 1738)?\s*•\s*(?:4279|134279)$/i.test(value)) return 'Unicred 566 • 1738 • 134279';
  return value;
}
export function reconciliationCandidates(item, entries) {
  const cents = value => Math.round(Number(value) * 100);
  const normalized = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const dayDiff = (a,b) => Math.abs((Date.parse(String(a).slice(0,10)+'T12:00:00Z')-Date.parse(String(b).slice(0,10)+'T12:00:00Z'))/86400000);
  const part = /(?:parcela\s*)?(\d+)\s*\/\s*(\d+)/i.exec(item.description || '');
  return entries.filter(e => {
    if (e.type !== item.type || isCardPayment(e) || cents(e.amount) !== cents(item.amount)) return false;

    if (part && cardDetails(e) && cardDetails(e).installment !== +part[1]) return false;
    if (dayDiff(e.date,item.date)>15) return false;
    // Assistant/manual/card labels are origins, not identified bank accounts.
    const knownAccount = bank => bank && !/^(Assistente|Manual|Cartão ·|Recorrência|Não informado)$/i.test(bank) && !/^Cartão · /i.test(bank);
    const account = bank => { const m=/(?:conta\s*[:•-]?\s*|[•])([\d.-]+)\s*$/i.exec(String(bank).replace(/\s+/g,'')); return m?.[1].replace(/\D/g,''); };
    if (knownAccount(item.bank) && knownAccount(e.bank) && canonicalAccount(e.bank) !== canonicalAccount(item.bank)) {
      const a=account(item.bank),b=account(e.bank);
      // Different known accounts remain separate; aliases of the same account can match.
      if (!a || !b || a!==b) return false;
    }
    return true;
  }).sort((a,b)=>{
    const rank=e=>{
      const sameAccount=!!(item.bank && e.bank===item.bank);
      const sameDescription=normalized(e.description)===normalized(item.description);
      return (sameAccount?100:0)+(sameDescription?40:0)-dayDiff(e.date,item.date);
    };
    return rank(b)-rank(a);
  });
}
