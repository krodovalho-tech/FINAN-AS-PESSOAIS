import { sql } from '@vercel/postgres';
import { reconciliationCandidates } from './card.js';
const cents = x => Math.round(Number(x) * 100);
const date = x => String(x instanceof Date ? x.toISOString() : x).slice(0,10);
export function hasSource(entry, item) {
  if (!item.bank || !item.source_id) return false;
  return (entry.bank === item.bank && entry.source_id === item.source_id) || (Array.isArray(entry.reconciliation?.imports) && entry.reconciliation.imports.some(s => s.bank === item.bank && s.source_id === item.source_id));
}
export function validateMatch(entry, item) {
  const expected = item.match_expected;
  if (!entry || !expected || entry.type !== expected.type || entry.category !== expected.category || entry.description !== expected.description || cents(entry.amount) !== cents(expected.amount) || date(entry.date) !== expected.date || entry.type !== item.type || cents(entry.amount) !== cents(item.amount) || !reconciliationCandidates(item, [entry]).length) throw new Error('A parcela mudou ou não corresponde ao valor importado. Atualize e confira a conciliação.');
}
export async function importBatch(bulk, pool = sql) {
  const client = await pool.connect();
  try {
    await client.sql`BEGIN`;
    // Serialize imports including aliases, which do not have their own DB index.
    await client.sql`SELECT pg_advisory_xact_lock(61830427)`;
    const { rows } = await client.sql`SELECT * FROM entries FOR UPDATE`;
    let inserted = 0, skipped = 0, reconciled = 0;
    const used = new Set();
    const saved = [];
    for (const item of bulk) {
      if (item.import_action === 'skip') { skipped++; continue; }
      const prior = rows.find(e => hasSource(e, item));
      if (prior) {
        if (prior.type !== item.type || cents(prior.amount) !== cents(item.amount)) throw new Error('O valor deste item da fatura mudou. Confira a conciliação.');
        if (item.match_id && prior.id !== item.match_id) throw new Error('Este item da fatura já está vinculado a outro lançamento.');
        skipped++; continue;
      }
      if (item.match_id) {
        if (used.has(item.match_id)) throw new Error('Duas linhas da fatura foram vinculadas à mesma parcela. Confira a prévia.');
        used.add(item.match_id);
        const target = rows.find(e => e.id === item.match_id);
        validateMatch(target, item);
        const old = target.reconciliation && typeof target.reconciliation === 'object' && !Array.isArray(target.reconciliation) ? target.reconciliation : {};
        const reconciliation = { ...old, status: 'conciliado', imports: [...(Array.isArray(old.imports) ? old.imports : []), { bank: item.bank || null, source_id: item.source_id || null, date: item.date, description: item.description, amount: Number(item.amount) }] };
        const result = await client.sql`UPDATE entries SET confirmed=TRUE, reconciliation=${JSON.stringify(reconciliation)}::jsonb WHERE id=${item.match_id} RETURNING *`;
        Object.assign(target, result.rows[0]); saved.push(target); reconciled++; continue;
      }
      if (reconciliationCandidates(item, rows).length && item.reviewed_new !== true) {
        throw new Error('Possível duplicidade: revise a prévia e vincule, ignore ou confirme que é um lançamento distinto.');
      }
      const reconciliation = item.import_action === 'card_payment' ? { kind: 'card_payment', status: 'quitação do cartão' } : item.reconciliation || null;
      const result = await client.sql`
        INSERT INTO entries (type, category, description, amount, date, recurring, notes, source_id, bank, confirmed, reconciliation)
        VALUES (${item.type},${item.category},${item.description},${Number(item.amount)},${item.date},${!!item.recurring},${item.notes || null},${item.source_id || null},${item.bank || null},${item.confirmed === true},${reconciliation ? JSON.stringify(reconciliation) : null}::jsonb)
        ON CONFLICT (bank, source_id) WHERE source_id IS NOT NULL AND bank IS NOT NULL DO NOTHING RETURNING *`;
      if (result.rows.length) { rows.push(result.rows[0]); saved.push(result.rows[0]); inserted++; } else skipped++;
    }
    await client.sql`COMMIT`;
    return { inserted, skipped, reconciled, entries: saved };
  } catch (err) { await client.sql`ROLLBACK`; throw err; }
  finally { client.release(); }
}
