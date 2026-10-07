import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
const COOKIE = 'finance_session';
const ttl = 7 * 24 * 60 * 60;
const sign = value => createHmac('sha256', process.env.FINANCE_PASSWORD).update(value).digest('hex');
export function passwordMatches(value) {
  return timingSafeEqual(createHash('sha256').update(String(value || '')).digest(), createHash('sha256').update(process.env.FINANCE_PASSWORD || '').digest());
}
export function sessionCookie() {
  const expires = String(Math.floor(Date.now() / 1000) + ttl);
  return `${COOKIE}=${expires}.${sign(expires)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ttl}`;
}
export function clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`; }
export function requireAuth(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.FINANCE_PASSWORD || process.env.FINANCE_PASSWORD.length < 16) {
    res.status(503).json({ error: 'Configure FINANCE_PASSWORD com pelo menos 16 caracteres na Vercel.' }); return false;
  }
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (origin && origin !== `https://${host}`) { res.status(403).json({ error: 'Origem não permitida.' }); return false; }
  const value = (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1) || '';
  const [expires, signature] = value.split('.');
  if (!/^\d+$/.test(expires || '') || Number(expires) <= Date.now()/1000 || !/^[a-f0-9]{64}$/.test(signature || '') || !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(expires), 'hex'))) {
    res.status(401).json({ error: 'Entre com sua senha para acessar os dados.' }); return false;
  }
  return true;
}
