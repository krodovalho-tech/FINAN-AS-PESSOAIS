import { requireAuth, passwordMatches, sessionCookie, clearCookie } from '../lib/auth.js';
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST') {
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (origin && origin !== `https://${host}`) return res.status(403).json({ error: 'Origem não permitida.' });
    if (!process.env.FINANCE_PASSWORD || process.env.FINANCE_PASSWORD.length < 16) return res.status(503).json({ error: 'Configure FINANCE_PASSWORD com pelo menos 16 caracteres na Vercel.' });
    if (!passwordMatches(req.body?.password)) return res.status(401).json({ error: 'Senha incorreta.' });
    res.setHeader('Set-Cookie', sessionCookie());
    return res.status(200).json({ ok: true });
  }
  if (!requireAuth(req, res)) return;
  if (req.method === 'DELETE') { res.setHeader('Set-Cookie', clearCookie()); return res.status(200).json({ ok: true }); }
  if (req.method === 'GET') return res.status(200).json({ ok: true });
  return res.status(405).json({ error: 'Método não permitido.' });
}
