import { requireAuth } from '../lib/auth.js';
import { sql } from '@vercel/postgres';
import { validEntry } from '../lib/entry-validation.js';



// Normaliza datas para "YYYY-MM-DD" antes de devolver ao frontend
function normDate(d) {
  if (!d) return d;
  const s = d instanceof Date ? d.toISOString() : String(d);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}
function normalizeRows(rows) {
  return rows.map(r => ({ ...r, date: normDate(r.date) }));
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  try {
    // ── LIST ──────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { month, year, all } = req.query;

      if (all === 'true') {
        const { rows } = await sql`
          SELECT * FROM entries ORDER BY date DESC
        `;
        return res.status(200).json(normalizeRows(rows));
      }

      if (month !== undefined && year !== undefined) {
        const m = parseInt(month, 10) + 1; // JS month is 0-indexed
        const y = parseInt(year, 10);
        const { rows } = await sql`
          SELECT * FROM entries
          WHERE EXTRACT(MONTH FROM date) = ${m}
            AND EXTRACT(YEAR  FROM date) = ${y}
          ORDER BY date DESC, created_at DESC
        `;
        return res.status(200).json(normalizeRows(rows));
      }

      const { rows } = await sql`SELECT * FROM entries ORDER BY date DESC`;
      return res.status(200).json(normalizeRows(rows));
    }

    // ── CREATE ────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { type, category, description, amount, date, recurring, notes, source_id, bank, confirmed, reconciliation } = req.body;
      if (!validEntry(req.body)) {
        return res.status(400).json({ error: 'Campos obrigatórios: type, category, description, amount, date' });
      }
      const { rows } = await sql`
        INSERT INTO entries (type, category, description, amount, date, recurring, notes, source_id, bank, confirmed, reconciliation)
        VALUES (${type}, ${category}, ${description}, ${parseFloat(amount)}, ${date}, ${!!recurring}, ${notes||null}, ${source_id||null}, ${bank||null}, ${confirmed===true}, ${reconciliation ? JSON.stringify(reconciliation) : null}::jsonb)
        RETURNING *
      `;
      return res.status(201).json(normalizeRows(rows)[0]);
    }

    // ── UPDATE ────────────────────────────────────────────────────────────
    if (req.method === 'PUT') {
      const { id } = req.query;
      if (!/^[1-9]\d*$/.test(String(id || ''))) return res.status(400).json({ error: 'Identificador inválido' });
      const { type, category, description, amount, date, recurring, notes } = req.body || {};
      if (!validEntry(req.body)) return res.status(400).json({ error: 'Confira descrição, categoria, valor positivo e data válida.' });
      const { rows } = await sql`
        UPDATE entries
        SET type=${type}, category=${category}, description=${description},
            amount=${parseFloat(amount)}, date=${date}, recurring=${!!recurring}, notes=${notes||null}
        WHERE id=${parseInt(id, 10)}
        RETURNING *
      `;
      if (!rows.length) return res.status(404).json({ error: 'Lançamento não encontrado' });
      return res.status(200).json(normalizeRows(rows)[0]);
    }

    // ── DELETE ────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!/^[1-9]\d*$/.test(String(id || ''))) return res.status(400).json({ error: 'Identificador inválido' });
      await sql`DELETE FROM entries WHERE id=${parseInt(id, 10)}`;
      return res.status(200).json({ ok: true });
    }

    // ── BULK INSERT (importação) ──────────────────────────────────────────
    if (req.method === 'PATCH') {
      const { entries: bulk } = req.body;
      if (!Array.isArray(bulk) || !bulk.length) {
        return res.status(400).json({ error: 'Array entries obrigatório' });
      }
      const valid = bulk.every(e => ['income','expense'].includes(e.type) && typeof e.category === 'string' && e.category.length <= 60 && typeof e.description === 'string' && e.description.trim() && Number.isFinite(Number(e.amount)) && Number(e.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(e.date || ''));
      if (!valid || bulk.length > 5000) return res.status(400).json({ error: 'Importação inválida. Revise os lançamentos.' });
      // Um único comando: falhas não deixam uma importação parcial.
      const payload = JSON.stringify(bulk.map(e=>({ ...e, amount:Number(e.amount), recurring:!!e.recurring, source_id:e.source_id || null, bank:e.bank || null, confirmed:e.confirmed === true, reconciliation:e.reconciliation || null })));
      const { rows } = await sql`
        INSERT INTO entries (type, category, description, amount, date, recurring, notes, source_id, bank, confirmed, reconciliation)
        SELECT type, category, description, amount, date, recurring, notes, source_id, bank, confirmed, reconciliation
        FROM jsonb_to_recordset(${payload}::jsonb) AS x(type text, category text, description text, amount numeric, date date, recurring boolean, notes text, source_id text, bank text, confirmed boolean, reconciliation jsonb)
        ON CONFLICT (bank, source_id) WHERE source_id IS NOT NULL AND bank IS NOT NULL DO NOTHING
        RETURNING *
      `;
      return res.status(201).json({ inserted:rows.length, skipped:bulk.length-rows.length, entries:normalizeRows(rows) });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Não foi possível acessar o banco. Verifique a conexão e a configuração das tabelas.' });
  }
}

