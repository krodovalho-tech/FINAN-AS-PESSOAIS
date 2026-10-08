import { sql } from '@vercel/postgres';
import { randomBytes, createHash } from 'node:crypto';
import { requireAuth } from '../lib/auth.js';
const CALLBACK = 'https://assistente-financeiro-kleber.krodovalho.chatgpt.site/connected';
const hash = x => createHash('sha256').update(x).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
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
    if (action==='summary' && req.method==='GET') {
      const year=Number(req.query.year),month=Number(req.query.month);
      if (!Number.isInteger(year)||year<2000||year>2200||!Number.isInteger(month)||month<1||month>12) return res.status(400).json({error:'Informe mês e ano válidos.'});
      const {rows}=await sql`SELECT id,type,category,description,amount,date,bank,source_id FROM entries WHERE EXTRACT(YEAR FROM date)=${year} AND EXTRACT(MONTH FROM date)=${month} ORDER BY amount DESC,id DESC`;
      let income=0,expense=0;const categories=Object.create(null);
      for(const e of rows){const cents=Math.round(Number(e.amount)*100);if(e.type==='income')income+=cents;else{expense+=cents;categories[e.category]=(categories[e.category]||0)+cents;}}
      return res.status(200).json({year,month,count:rows.length,income:income/100,expense:expense/100,balance:(income-expense)/100,expensesByCategory:Object.entries(categories).map(([category,cents])=>({category,amount:cents/100})).sort((a,b)=>b.amount-a.amount),largestExpenses:rows.filter(e=>e.type==='expense').slice(0,5)});
    }

    if (action==='entries' && req.method==='GET') {
      const id=Number(req.query.id),year=Number(req.query.year),month=Number(req.query.month);
      if (req.query.id!==undefined) {
        if(!Number.isSafeInteger(id)||id<1) return res.status(400).json({error:'Identificador inválido.'});
        const {rows}=await sql`SELECT id,type,category,description,amount,date FROM entries WHERE id=${id}`;
        return res.status(200).json({entries:rows});
      }
      if(!Number.isInteger(year)||year<2000||year>2200||!Number.isInteger(month)||month<1||month>12) return res.status(400).json({error:'Informe mês e ano válidos.'});
      const search=req.query.search || '';
      if(typeof search!=='string'||search.length>1000) return res.status(400).json({error:'Busca inválida.'});
      const {rows}=await sql`SELECT id,type,category,description,amount,date FROM entries WHERE EXTRACT(YEAR FROM date)=${year} AND EXTRACT(MONTH FROM date)=${month} AND (${search}='' OR POSITION(LOWER(${search}) IN LOWER(description))>0) ORDER BY date DESC,id DESC LIMIT 100`;
      return res.status(200).json({entries:rows,limit:100});
    }
    if (action==='edit' && req.method==='POST') {
      const {id,expected,changes}=req.body || {};
      const fields=['type','category','description','amount','date'];
      const dateText=d=>d instanceof Date?d.toISOString().slice(0,10):String(d).slice(0,10);
      const valid=e=>e && ['income','expense'].includes(e.type) && typeof e.category==='string' && !!e.category.trim() && e.category.length<=60 && typeof e.description==='string' && !!e.description.trim() && e.description.length<=1000 && Number.isFinite(Number(e.amount)) && Math.round(Number(e.amount)*100)>0 && Number(e.amount)<=9999999999.99 && typeof e.date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && !Number.isNaN(Date.parse(e.date+'T12:00:00Z')) && new Date(e.date+'T12:00:00Z').toISOString().slice(0,10)===e.date;
      if(!Number.isSafeInteger(id)||id<1||!valid(expected)||!changes||typeof changes!=='object'||Array.isArray(changes)||!Object.keys(changes).length||Object.keys(changes).some(k=>!fields.includes(k))) return res.status(400).json({error:'Confira o identificador, os dados consultados e os campos a alterar.'});
      const next={...expected,...changes};
      if(!valid(next)) return res.status(400).json({error:'Confira valor positivo, categoria, descrição e data válida.'});
      next.amount=Math.round(Number(next.amount)*100)/100;
      const {rows}=await sql`UPDATE entries SET type=${next.type},category=${next.category},description=${next.description},amount=${next.amount},date=${next.date} WHERE id=${id} AND type=${expected.type} AND category=${expected.category} AND description=${expected.description} AND amount=${Number(expected.amount)} AND date=${expected.date} RETURNING id,type,category,description,amount,date`;
      if(rows.length) return res.status(200).json({saved:true,entry:rows[0]});
      const {rows:existing}=await sql`SELECT id,type,category,description,amount,date FROM entries WHERE id=${id}`;
      if(!existing.length) return res.status(404).json({error:'Lançamento não encontrado.'});
      const e=existing[0];
      if(e.type===next.type && e.category===next.category && e.description===next.description && Number(e.amount)===next.amount && dateText(e.date)===next.date) return res.status(200).json({saved:true,unchanged:true,entry:e});
      return res.status(409).json({error:'O lançamento mudou desde a consulta. Consulte novamente antes de editar.'});
    }
    if (action==='record' && req.method==='POST') {
      const e=req.body || {};const amount=Number(e.amount);
      if(!['income','expense'].includes(e.type)||!Number.isFinite(amount)||amount<=0||amount>9999999999.99||!/^\d{4}-\d{2}-\d{2}$/.test(e.date||'')||typeof e.description!=='string'||!e.description.trim()||e.description.length>1000||typeof e.category!=='string'||!e.category.trim()||e.category.length>60||! /^[A-Za-z0-9_-]{8,100}$/.test(e.request_id||'')) return res.status(400).json({error:'Lançamento inválido. Confira valor, data, descrição, categoria e identificador.'});
      const source=`${connections[0].id}:${e.request_id}`;
      const notes=JSON.stringify({origin:'assistant',payment_account:e.payment_account || 'Não informado',reconciliation:'Aguardando conferência com o extrato bancário'});
      const {rows}=await sql`INSERT INTO entries (type,category,description,amount,date,notes,source_id,bank,confirmed) VALUES (${e.type},${e.category},${e.description},${Math.round(amount*100)/100},${e.date},${notes},${source},'Assistente',TRUE) ON CONFLICT (bank,source_id) WHERE source_id IS NOT NULL AND bank IS NOT NULL DO NOTHING RETURNING id,type,category,description,amount,date`;
      if(rows.length) return res.status(201).json({saved:true,duplicate:false,entry:rows[0],reconciliation:'Aguardando conferência com o extrato bancário'});
      const existing=await sql`SELECT id,type,category,description,amount,date FROM entries WHERE bank='Assistente' AND source_id=${source}`;
      const previous=existing.rows[0];
      if(!previous || previous.type!==e.type || previous.category!==e.category || previous.description!==e.description || Number(previous.amount)!==Math.round(amount*100)/100 || String(previous.date).slice(0,10)!==e.date) return res.status(409).json({error:'Este identificador já pertence a outro lançamento. Confira o pedido antes de enviar novamente.'});
      return res.status(200).json({saved:true,duplicate:true,entry:previous});
    }
    return res.status(405).json({error:'Operação não permitida.'});
  } catch(err) {console.error('assistant',err.code || err.name);return res.status(500).json({error:'Não foi possível acessar o banco. Nenhuma confirmação de gravação disponível.'});}
}

