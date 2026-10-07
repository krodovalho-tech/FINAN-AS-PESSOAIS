import { sql } from '@vercel/postgres';
import { requireAuth } from '../lib/auth.js';
import { recurringPayload } from '../lib/entry-validation.js';
export default async function handler(req,res) {
 if(!requireAuth(req,res))return;
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Operação não permitida.'});
 const {year,month}=req.body || {};
 if(!Number.isInteger(year)||year<2000||year>2099||!Number.isInteger(month)||month<0||month>11)return res.status(400).json({error:'Mês inválido.'});
 try {
 const roots=await sql`SELECT * FROM entries WHERE recurring=TRUE AND bank IS DISTINCT FROM 'Recorrência'`;
 const payload=recurringPayload(roots.rows,year,month);
 if(!payload.length)return res.status(200).json({inserted:0,skipped:0});
 const json=JSON.stringify(payload);
 const result=await sql`INSERT INTO entries (type,category,description,amount,date,notes,source_id,bank,recurring,confirmed)
 SELECT type,category,description,amount,date,notes,source_id,bank,recurring,confirmed
 FROM jsonb_to_recordset(${json}::jsonb) AS x(type text,category text,description text,amount numeric,date date,notes text,source_id text,bank text,recurring boolean,confirmed boolean)
 ON CONFLICT (bank,source_id) WHERE source_id IS NOT NULL AND bank IS NOT NULL DO NOTHING RETURNING id`;
 return res.status(200).json({inserted:result.rows.length,skipped:payload.length-result.rows.length});
 }catch{return res.status(500).json({error:'Não foi possível aplicar os recorrentes. Tente novamente.'});}
}
