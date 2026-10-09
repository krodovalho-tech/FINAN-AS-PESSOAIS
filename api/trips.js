import { requireAuth } from '../lib/auth.js';
import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Operação não permitida.' });
  const body = req.body || {};
  const deleteId = Number(req.query?.id);
  if (req.method === 'DELETE' && (!Number.isSafeInteger(deleteId) || deleteId <= 0)) return res.status(400).json({error:'Identificador inválido.'});
  const destination = typeof body.destination === 'string' ? body.destination.trim() : '';
  const date = body.start_date || null;
  if (req.method === 'POST' && (!destination || destination.length > 160 || (date && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T12:00:00Z')) || new Date(date + 'T12:00:00Z').toISOString().slice(0,10) !== date)))) {
    return res.status(400).json({ error: 'Informe um destino e uma data de partida válida.' });
  }
  try {
    await sql`CREATE TABLE IF NOT EXISTS trips (id SERIAL PRIMARY KEY, destination VARCHAR(160) NOT NULL UNIQUE, start_date DATE, created_at TIMESTAMPTZ DEFAULT NOW())`;
    if (req.method === 'DELETE') {
      const deleted = await sql`DELETE FROM trips WHERE id = ${deleteId} RETURNING id`;
      if (!deleted.rows.length) return res.status(404).json({error:'Viagem não encontrada.'});
      return res.status(200).json({deleted:true});
    }
    const { rows } = req.method === 'GET'
      ? await sql`SELECT id, destination, start_date FROM trips ORDER BY destination`
      : await sql`INSERT INTO trips (destination, start_date) VALUES (${destination}, ${date}) ON CONFLICT (destination) DO UPDATE SET start_date=COALESCE(EXCLUDED.start_date, trips.start_date) RETURNING id, destination, start_date`;
    const normalized = rows.map(row => ({ ...row, start_date: row.start_date ? (row.start_date instanceof Date ? row.start_date.toISOString() : String(row.start_date)).slice(0,10) : null }));
    return res.status(req.method === 'GET' ? 200 : 201).json(req.method === 'GET' ? normalized : normalized[0]);
  } catch {
    return res.status(500).json({ error: 'Não foi possível salvar ou consultar os destinos.' });
  }
}
