import { sql } from '@vercel/postgres';
import { requireAuth } from '../lib/auth.js';
import { recurringPayload } from '../lib/entry-validation.js';
export default async function handler(req,res) {
 if(!requireAuth(req,res))return;
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Operação não permitida.'});
 const {year,month,action,id}=req.body || {};
 if(action==='stop') {
  if(!/^[1-9]\d*$/.test(String(id || '')))return res.status(400).json({error:'Lançamento inválido.'});
  try {
   const selected=await sql`SELECT id,bank,source_id FROM entries WHERE id=${Number(id)}`;
   const e=selected.rows[0];
   if(!e)return res.status(404).json({error:'Lançamento não encontrado.'});
   const rootId=e.bank==='Recorrência' ? Number(String(e.source_id).split(':')[0]) : Number(e.id);
   if(!Number.isSafeInteger(rootId)||rootId<=0)return res.status(400).json({error:'Origem da recorrência inválida.'});
   const prefix=`${rootId}:%`;
   const result=await sql`WITH stopped AS (
    UPDATE entries SET recurring=FALSE WHERE id=${rootId} AND bank IS DISTINCT FROM 'Recorrência' RETURNING id
   ), removed AS (
    DELETE FROM entries WHERE bank='Recorrência' AND source_id LIKE ${prefix} AND confirmed IS NOT TRUE AND EXISTS (SELECT 1 FROM stopped) RETURNING id
   ) SELECT (SELECT COUNT(*)::int FROM stopped) AS stopped, (SELECT COUNT(*)::int FROM removed) AS removed`;
   return res.status(200).json({ok:true,...result.rows[0]});
  }catch{return res.status(500).json({error:'Não foi possível encerrar a recorrência. Nenhuma exclusão confirmada.'});}
 }

 if(!Number.isInteger(year)||year<2000||year>2099||!Number.isInteger(month)||month<0||month>11)return res.status(400).json({error:'Mês inválido.'});
 try {
 await sql`CREATE TABLE IF NOT EXISTS recurrence_occurrences (source_id TEXT PRIMARY KEY)`;
 const roots=await sql`SELECT * FROM entries WHERE recurring=TRUE AND bank IS DISTINCT FROM 'Recorrência'`;
 const payload=recurringPayload(roots.rows,year,month);
 if(!payload.length)return res.status(200).json({inserted:0,skipped:0});
 const json=JSON.stringify(payload);
 const result=await sql`WITH candidates AS (
 SELECT x.* FROM jsonb_to_recordset(${json}::jsonb) AS x(type text,category text,description text,amount numeric,date date,notes text,source_id text,bank text,recurring boolean,confirmed boolean)
 JOIN entries root ON root.id=split_part(x.source_id,':',1)::integer
 WHERE root.recurring=TRUE AND root.bank IS DISTINCT FROM 'Recorrência'
 ORDER BY root.id FOR UPDATE OF root
 ), first_occurrences AS (
 INSERT INTO recurrence_occurrences (source_id) SELECT source_id FROM candidates ON CONFLICT DO NOTHING RETURNING source_id
 ) INSERT INTO entries (type,category,description,amount,date,notes,source_id,bank,recurring,confirmed)
 SELECT c.type,c.category,c.description,c.amount,c.date,c.notes,c.source_id,c.bank,c.recurring,c.confirmed
 FROM candidates c JOIN first_occurrences f ON f.source_id=c.source_id
 ON CONFLICT (bank,source_id) WHERE source_id IS NOT NULL AND bank IS NOT NULL DO NOTHING RETURNING id`;
 return res.status(200).json({inserted:result.rows.length,skipped:payload.length-result.rows.length});
 }catch{return res.status(500).json({error:'Não foi possível aplicar os recorrentes. Tente novamente.'});}
}
