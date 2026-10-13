import { sql } from '@vercel/postgres';
import { requireAuth } from '../lib/auth.js';
export default async function handler(req,res) {
 if(!requireAuth(req,res)) return;
 res.setHeader('Cache-Control','no-store');
 try {
  await sql`CREATE TABLE IF NOT EXISTS bank_balance_snapshots (id BIGSERIAL PRIMARY KEY,bank TEXT NOT NULL,balance NUMERIC(14,2) NOT NULL,as_of TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW())`;
  if(req.method==='GET') {
   const {rows}=await sql`SELECT DISTINCT ON (bank) bank,balance,as_of FROM bank_balance_snapshots ORDER BY bank,as_of DESC,id DESC`;
   return res.status(200).json({balances:rows});
  }
  if(req.method==='POST') {
   const {bank,balance,as_of}=req.body||{};
   const amount=Number(balance),d=new Date(as_of);
   if(!['Caixa','Unicred'].includes(bank)||!Number.isFinite(amount)||!Number.isFinite(d.getTime())||d.getTime()>Date.now()+60000||Math.abs(amount)>1e11) return res.status(400).json({error:'Saldo ou data inválidos.'});
   const {rows}=await sql`INSERT INTO bank_balance_snapshots (bank,balance,as_of) VALUES (${bank},${amount},${d.toISOString()}) RETURNING bank,balance,as_of`;
   return res.status(201).json(rows[0]);
  }
  return res.status(405).json({error:'Método não permitido'});
 }catch(err){console.error(err);return res.status(500).json({error:'Não foi possível consultar saldos.'});}
}