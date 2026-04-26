import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS entries (
        id        SERIAL PRIMARY KEY,
        type      VARCHAR(10)    NOT NULL CHECK (type IN ('income','expense')),
        category  VARCHAR(60)    NOT NULL,
        description TEXT         NOT NULL,
        amount    DECIMAL(12,2)  NOT NULL,
        date      DATE           NOT NULL,
        recurring BOOLEAN        DEFAULT FALSE,
        notes     TEXT,
        created_at TIMESTAMPTZ   DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS budgets (
        id            SERIAL PRIMARY KEY,
        category      VARCHAR(60)   NOT NULL UNIQUE,
        monthly_limit DECIMAL(12,2) NOT NULL,
        updated_at    TIMESTAMPTZ   DEFAULT NOW()
      )
    `;
    res.status(200).json({ ok: true, message: 'Tabelas criadas com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
