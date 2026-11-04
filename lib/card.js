const PREFIX = '@finance-card:';
const cents = value => Math.round(Number(value) * 100);
// Assistant request IDs identify a parcel; the shared prefix identifies its purchase.
export function normalizeAssistantCard(card, date) {
  const match = /^assistant:(.+)-p(\d+)$/.exec(card.purchase_id || '');
  if (!match || Number(match[2]) !== card.installment) return card;
  const d = new Date(statementDay(date) + 'T12:00:00Z');
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
  const d = new Date(statementDay(entry.date) + 'T12:00:00Z');
  if (!Number.isFinite(d.getTime())) return null;
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
export function invoiceDetails(entry) {
  const {invoice,imports}=entry.reconciliation || {};
  return invoice || (Array.isArray(imports) ? imports.find(source=>source.invoice)?.invoice : undefined);
}
export function purchaseCosts(entries) {
  const seen = new Set();
  return entries.filter(e => e.type === 'expense' && !isCardPayment(e)).flatMap(e => {
    const card = cardDetails(e);
    if (!card) return e.reconciliation?.invoice?.installment ? [] : [e];
    if (seen.has(card.purchase_id)) return [];
    seen.add(card.purchase_id);
    const imports = e.reconciliation?.imports;
    const correctedSinglePayment = card.count===1 && Array.isArray(imports) && imports.some(source=>source.previous_amount!=null);
    return [{ ...e, amount: correctedSinglePayment ? e.amount : card.total, date: card.purchase_date, card }];
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
  const value = String(bank || '').trim().replace(/(•\s*)0+(?=\d+$)/, '$1');
  if (/^Unicred(?: 566 • 1738)?\s*•\s*(?:4279|134279)$/i.test(value)) return 'Unicred 566 • 1738 • 134279';
  return value;
}
export function reconciliationCandidates(item, entries, allowAmountCorrection = false) {
  const cents = value => Math.round(Number(value) * 100);

  const invoice = item.reconciliation?.invoice;
  const part = /(?:parcela\s*)?(\d+)\s*\/\s*(\d+)/i.exec(item.description || '');
  return entries.filter(e => {
    if (e.type !== item.type || isCardPayment(e)) return false;

    const card = cardDetails(e);
    if (part && card && card.installment !== +part[1]) return false;
    if (invoice) {
      const previousInvoice = invoiceDetails(e);
      if (previousInvoice) return false;
      if (invoice.installment && (!card || card.count!==invoice.count)) return false;
      if (!invoice.installment && card && card.count !== 1) return false;
      const lastFour = /(?:final|Unicred)\s*(\d{4})\b/i.exec([card?.card,e.bank,e.description].join(' '))?.[1];
      if (lastFour && lastFour!==invoice.last_four) return false;
      const payment = /"payment_method"\s*:\s*"([^"]+)"/i.exec(e.notes || '')?.[1];
      if (payment && !['credit','unknown'].includes(payment)) return false;
      if (/^(Caixa|Unicred)\s*[^]*•/i.test(e.bank || '')) return false;
    }
    const days = dayDiff(invoice?.installment ? card.purchase_date : e.date,item.date);
    if (days>15) return false;
    if (cents(e.amount)!==cents(item.amount)) {
      const manual = !e.bank || /^(?:Assistente$|Manual$|Cartão · )/i.test(e.bank);
      const alreadyImported = e.reconciliation?.imports?.length || e.reconciliation?.invoice;
      const payment = /"payment_method"\s*:\s*"([^"]+)"/i.exec(e.notes || '')?.[1];
      if (!allowAmountCorrection || !item.bank || !item.source_id || !manual || alreadyImported ||
          !(days<=2) || (!invoice && (card || payment==='credit' || /^Cartão · /i.test(e.bank || '')))) return false;
    }
    if (distinctStatementSources(item,e)) return false;
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
      const sameDescription=normalizeDescription(e.description)===normalizeDescription(item.description);
      return (sameAccount?100:0)+(sameDescription?40:0)-dayDiff(e.date,item.date);
    };
    return rank(b)-rank(a);
  });
}

const statementDay = value => String(value instanceof Date ? (Number.isFinite(value.getTime()) ? value.toISOString() : '') : value).slice(0,10);
const dayDiff = (a,b) => Math.abs(Date.parse(statementDay(a)) - Date.parse(statementDay(b))) / 86400000;
const normalizeDescription = value => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();

const statementSource = source => /^PDF-/.test(source || '') ? 'pdf' : /^\d+$/.test(source || '') ? 'ofc' : null;
const sameBankAccount = (a,b) => !!a && !!b && canonicalAccount(a)===canonicalAccount(b);

export function hasSource(entry,item) {
  if (!item.bank || !item.source_id) return false;
  const sameSource = source => sameBankAccount(source.bank,item.bank) && source.source_id===item.source_id;
  return sameSource(entry) || (Array.isArray(entry.reconciliation?.imports) && entry.reconciliation.imports.some(sameSource));
}

function distinctStatementSources(item,entry) {
  const format = statementSource(item.source_id);
  if (!format || !item.bank?.includes('•')) return false;
  const sources = [entry, ...(Array.isArray(entry.reconciliation?.imports) ? entry.reconciliation.imports : [])];
  return sources.some(source => sameBankAccount(item.bank,source.bank) &&
    statementSource(source.source_id)===format && source.source_id!==item.source_id);
}

export function planStatementImport(items,entries,paymentMethod) {
  const rows = items.map(item => {
    const previous = entries.find(entry=>hasSource(entry,item));
    if (previous) {
      const sameAmount = previous.type===item.type && cents(previous.amount)===cents(item.amount);
      return {...item,import_action:sameAmount?'skip':'pending'};
    }
    const candidates = reconciliationCandidates(item,entries);
    const needsReview = candidates.length || item.reconciliation?.invoice?.installment || /fatura|pagamento.*cart[aã]o/i.test(item.description) || !item.source_id;
    const row = {...item,import_action:needsReview?'pending':'new'};
    if (!item.bank?.includes('•') || !item.source_id || /fatura|pagamento.*cart[aã]o/i.test(item.description)) return row;

    const merchant = normalizeDescription(item.description.match(/\/\s*([^/]+?)\s*\)?$/)?.[1] || item.description);
    const method = paymentMethod(item);
    const strong = candidates.filter(entry => {
      if (cardDetails(entry) || paymentMethod(entry)==='credit' || entry.reconciliation?.imports?.length) return false;
      const idInDescription = /\bFITID\s*[:#]?\s*([a-z0-9-]+)\b/i.exec(entry.description || '')?.[1];
      if (statementSource(item.source_id)==='ofc' && idInDescription===item.source_id && dayDiff(item.date,entry.date)===0) return true;
      if (!/^(Assistente|Manual)$/i.test(entry.bank || '') && entry.bank) return false;
      if (!['pix','debit','bank'].includes(method) || method!==paymentMethod(entry) || !(dayDiff(item.date,entry.date)<=2)) return false;
      const text = normalizeDescription(entry.description);
      return merchant.length>=6 && /[a-z]/.test(merchant) &&
        (text===merchant || (merchant.includes(' ') && (' '+text+' ').includes(' '+merchant+' ')));
    });
    return strong.length===1 ? {...row,automatic_match:strong[0].id} : row;
  });
  const count = new Map();
  for (const row of rows) {
    if (row.automatic_match!=null) count.set(row.automatic_match,(count.get(row.automatic_match)||0)+1);
  }
  return rows.map(({automatic_match,...row}) => count.get(automatic_match)===1
    ? {...row,import_action:'match:'+automatic_match} : row);
}
