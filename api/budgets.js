import { sql } from '@vercel/postgres';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── LIST ──────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { rows } = await sql`SELECT * FROM budgets ORDER BY category`;
      return res.status(200).json(rows);
    }

    // ── UPSERT ────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { category, monthly_limit } = req.body;
      if (!category || !monthly_limit) {
        return res.status(400).json({ error: 'category e monthly_limit são obrigatórios' });
      }
      const { rows } = await sql`
        INSERT INTO budgets (category, monthly_limit)
        VALUES (${category}, ${parseFloat(monthly_limit)})
        ON CONFLICT (category) DO UPDATE SET monthly_limit=EXCLUDED.monthly_limit, updated_at=NOW()
        RETURNING *
      `;
      return res.status(200).json(rows[0]);
    }

    // ── DELETE ────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { category } = req.query;
      if (!category) return res.status(400).json({ error: 'category obrigatório' });
      await sql`DELETE FROM budgets WHERE category=${category}`;
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
