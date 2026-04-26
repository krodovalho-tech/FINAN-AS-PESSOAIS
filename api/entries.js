import { sql } from '@vercel/postgres';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── LIST ──────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { month, year, all } = req.query;

      if (all === 'true') {
        const { rows } = await sql`
          SELECT * FROM entries ORDER BY date DESC
        `;
        return res.status(200).json(rows);
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
        return res.status(200).json(rows);
      }

      const { rows } = await sql`SELECT * FROM entries ORDER BY date DESC`;
      return res.status(200).json(rows);
    }

    // ── CREATE ────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { type, category, description, amount, date, recurring, notes } = req.body;
      if (!type || !category || !description || !amount || !date) {
        return res.status(400).json({ error: 'Campos obrigatórios: type, category, description, amount, date' });
      }
      const { rows } = await sql`
        INSERT INTO entries (type, category, description, amount, date, recurring, notes)
        VALUES (${type}, ${category}, ${description}, ${parseFloat(amount)}, ${date}, ${!!recurring}, ${notes||null})
        RETURNING *
      `;
      return res.status(201).json(rows[0]);
    }

    // ── UPDATE ────────────────────────────────────────────────────────────
    if (req.method === 'PUT') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id obrigatório' });
      const { type, category, description, amount, date, recurring, notes } = req.body;
      const { rows } = await sql`
        UPDATE entries
        SET type=${type}, category=${category}, description=${description},
            amount=${parseFloat(amount)}, date=${date}, recurring=${!!recurring}, notes=${notes||null}
        WHERE id=${parseInt(id, 10)}
        RETURNING *
      `;
      if (!rows.length) return res.status(404).json({ error: 'Lançamento não encontrado' });
      return res.status(200).json(rows[0]);
    }

    // ── DELETE ────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id obrigatório' });
      await sql`DELETE FROM entries WHERE id=${parseInt(id, 10)}`;
      return res.status(200).json({ ok: true });
    }

    // ── BULK INSERT (importação) ──────────────────────────────────────────
    if (req.method === 'PATCH') {
      const { entries: bulk } = req.body;
      if (!Array.isArray(bulk) || !bulk.length) {
        return res.status(400).json({ error: 'Array entries obrigatório' });
      }
      const inserted = [];
      for (const e of bulk) {
        const { rows } = await sql`
          INSERT INTO entries (type, category, description, amount, date, recurring, notes)
          VALUES (${e.type}, ${e.category}, ${e.description}, ${parseFloat(e.amount)}, ${e.date}, ${!!e.recurring}, ${e.notes||null})
          RETURNING *
        `;
        inserted.push(rows[0]);
      }
      return res.status(201).json(inserted);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
