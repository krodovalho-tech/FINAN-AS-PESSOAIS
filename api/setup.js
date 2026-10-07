import { requireAuth } from '../lib/auth.js';
import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
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
    await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS notes TEXT, ADD COLUMN IF NOT EXISTS source_id TEXT, ADD COLUMN IF NOT EXISTS bank TEXT, ADD COLUMN IF NOT EXISTS confirmed BOOLEAN DEFAULT FALSE, ADD COLUMN IF NOT EXISTS reconciliation JSONB`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS entries_source_unique ON entries (bank, source_id) WHERE source_id IS NOT NULL AND bank IS NOT NULL`;
    await sql`CREATE TABLE IF NOT EXISTS recurrence_occurrences (source_id TEXT PRIMARY KEY)`;
    res.status(200).json({ ok: true, message: 'Tabelas criadas com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: 'Não foi possível preparar o banco.' });
  }
}

