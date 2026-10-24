import { sql } from '@vercel/postgres';
import { randomBytes, createHash } from 'node:crypto';
import { requireAuth } from '../lib/auth.js';
import { cardDetails } from '../lib/card.js';
import { normalizeFoodCategory } from '../src/food-categories.js';
import { recordVerified, RecordError, auditPurchase, monthlySummary } from '../lib/verified-record.js';
import { editVerified } from '../lib/assistant-edit.js';
const CALLBACK = 'https://assistente-financeiro-kleber.krodovalho.chatgpt.site/connected';
const hash = x => createHash('sha256').update(x).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const dateOnly=v=>v==null?null:(v instanceof Date?v.toISOString():String(v)).slice(0,10);
const snapshot=e=>({...e,date:dateOnly(e.date),recurring:!!e.recurring,recurrence_end_date:dateOnly(e.recurrence_end_date)});
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  const action=req.query.action;
  try {
    if (action==='authorize' && req.method==='POST') {
      if (!requireAuth(req,res)) return;
      const { state, challenge }=req.body || {};
      if (!/^[a-f0-9]{64}$/.test(challenge || '') || !/^[a-f0-9]{64}$/.test(state || '')) return res.status(400).json({error:'Pedido de conexão inválido.'});
      await sql`CREATE TABLE IF NOT EXISTS assistant_connections (id SERIAL PRIMARY KEY, code_hash TEXT UNIQUE, challenge TEXT, code_expires TIMESTAMPTZ, token_hash TEXT UNIQUE, token_expires TIMESTAMPTZ, revoked BOOLEAN DEFAULT FALSE)`;
      const code=secret();
      await sql`INSERT INTO assistant_connections (code_hash,challenge,code_expires) VALUES (${hash(code)},${challenge},NOW()+INTERVAL '10 minutes')`;
      return res.status(200).json({redirect:`${CALLBACK}?code=${encodeURIComponent(code)}&state=${state}`});
    }
    if (action==='exchange' && req.method==='POST') {
      const {code,verifier}=req.body || {};
      if (!/^[A-Za-z0-9_-]{43}$/.test(code || '') || !/^[a-f0-9]{64}$/.test(verifier || '')) return res.status(400).json({error:'Conexão inválida.'});
      const token=secret();
      const {rows}=await sql`UPDATE assistant_connections SET token_hash=${hash(token)},token_expires=NOW()+INTERVAL '90 days',code_hash=NULL,challenge=NULL WHERE code_hash=${hash(code)} AND challenge=${hash(verifier)} AND code_expires>NOW() AND revoked=FALSE RETURNING id`;
      if (!rows.length) return res.status(401).json({error:'A autorização expirou ou já foi utilizada. Conecte novamente.'});
      return res.status(200).json({token,expires_in:90*86400});
    }
    if(action==='revoke' && req.method==='POST') {
      if (!requireAuth(req,res)) return;
      await sql`UPDATE assistant_connections SET revoked=TRUE WHERE revoked=FALSE`;
      return res.status(200).json({ok:true});
    }
    const token=req.headers.authorization?.replace(/^Bearer /,'');
    if(!/^[A-Za-z0-9_-]{43}$/.test(token || '')) return res.status(401).json({error:'Conecte seu painel ao assistente.'});
    const {rows:connections}=await sql`SELECT id FROM assistant_connections WHERE token_hash=${hash(token)} AND token_expires>NOW() AND revoked=FALSE`;
    if(!connections.length) return res.status(401).json({error:'A conexão foi revogada ou expirou. Autorize novamente pelo painel.'});
    if(['record','purchase','edit'].includes(action)) {
      await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS recurrence_end_date DATE`;
      await sql`CREATE TABLE IF NOT EXISTS recurrence_occurrences (source_id TEXT PRIMARY KEY)`;
    }
    if (action==='summary' && req.method==='GET') {
      const year=Number(req.query.year),month=Number(req.query.month);
      if (!Number.isInteger(year)||year<2000||year>2200||!Number.isInteger(month)||month<1||month>12) return res.status(400).json({error:'Informe mês e ano válidos.'});
      const {rows}=await sql`SELECT * FROM entries ORDER BY id`;
      const exists=await sql`SELECT to_regclass('public.recurrence_occurrences') AS name`;
      const excluded=exists.rows[0]?.name?(await sql`SELECT source_id FROM recurrence_occurrences`).rows.map(e=>e.source_id):[];
      const installments=monthlySummary(rows,year,month,'installments');
      const purchases=monthlySummary(rows,year,month,'purchases',excluded);
      const cash=monthlySummary(rows,year,month,'cash',excluded);
      const commitments=monthlySummary(rows,year,month,'commitments',excluded);
      return res.status(200).json({...installments,views:{installments,purchases,cash,commitments}});
    }

    if (action==='entries' && req.method==='GET') {
      const id=Number(req.query.id),year=Number(req.query.year),month=Number(req.query.month);
      if (req.query.id!==undefined) {
        if(!Number.isSafeInteger(id)||id<1) return res.status(400).json({error:'Identificador inválido.'});
        const {rows}=await sql`SELECT * FROM entries WHERE id=${id}`;
        const normalize=e=>({...e,date:e.date instanceof Date?e.date.toISOString().slice(0,10):String(e.date).slice(0,10)});
        const card=rows[0] && cardDetails(normalize(rows[0]));
        let purchase_verification;
        if(card) {
          const all=(await sql`SELECT * FROM entries ORDER BY id`).rows.map(normalize);
          const ids=all.filter(e=>cardDetails(e)?.purchase_id===card.purchase_id).map(e=>e.id);
          try { purchase_verification=auditPurchase(all,ids,card.total); }
          catch(error) { if(!(error instanceof RecordError))throw error;purchase_verification={verified:false,error:error.message}; }
        }
        return res.status(200).json({entries:rows.map(snapshot),purchase_verification});
      }
      if(!Number.isInteger(year)||year<2000||year>2200||!Number.isInteger(month)||month<1||month>12) return res.status(400).json({error:'Informe mês e ano válidos.'});
      const search=req.query.search || '';
      if(typeof search!=='string'||search.length>1000) return res.status(400).json({error:'Busca inválida.'});
      const {rows}=await sql`SELECT id,type,category,description,amount,date,recurring,(to_jsonb(entries)->>'recurrence_end_date') AS recurrence_end_date,bank,source_id FROM entries WHERE EXTRACT(YEAR FROM date)=${year} AND EXTRACT(MONTH FROM date)=${month} AND (${search}='' OR POSITION(LOWER(${search}) IN LOWER(description))>0) ORDER BY date DESC,id DESC LIMIT 100`;
      return res.status(200).json({entries:rows.map(snapshot),limit:100});
    }
    if (action==='audit' && req.method==='POST') {
      const {entry_ids,expected_amount,destination}=req.body || {};
      const {rows}=await sql`SELECT * FROM entries ORDER BY id`;
      return res.status(200).json(auditPurchase(rows,entry_ids,expected_amount,destination));
    }
    if (action==='edit' && req.method==='POST') {
      return res.status(200).json(await editVerified(req.body,sql));
    }
    if (['record','purchase'].includes(action) && req.method==='POST') {
      const result=await recordVerified(req.body,connections[0].id,action==='purchase',sql);
      return res.status(result.duplicate?200:201).json(result);
    }
    return res.status(405).json({error:'Operação não permitida.'});
  } catch(err) {if(err instanceof RecordError)return res.status(err.status).json({saved:false,verified:false,error:err.message});console.error('assistant',err.code || err.name);return res.status(500).json({error:'Não foi possível acessar o banco. Nenhuma confirmação de gravação disponível.'});}
}



