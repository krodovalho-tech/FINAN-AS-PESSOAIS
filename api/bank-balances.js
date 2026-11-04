import { sql } from '@vercel/postgres';
import { requireAuth } from '../lib/auth.js';
import { listBalances,recordBalance,setBalanceExcluded } from '../lib/balances.js';
export default async function handler(req,res){
 if(!requireAuth(req,res))return;
 res.setHeader('Cache-Control','no-store');
 try{
  const through=req.query?.through;
  if(through!==undefined && (typeof through!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(through)||!Number.isFinite(Date.parse(through))||new Date(through).toISOString().slice(0,10)!==through)){
   return res.status(400).json({error:'Data de fechamento inválida.'});
  }
  if(req.method==='GET')return res.status(200).json(await listBalances(sql,through??null));
  if(req.method==='POST')return res.status(201).json(await recordBalance(req.body,sql));
  if(req.method==='PATCH')return res.status(200).json(await setBalanceExcluded(req.body,sql,through??null));
  return res.status(405).json({error:'Método não permitido'});
 }catch(error){return res.status(error.status||500).json({error:error.status?error.message:'Não foi possível salvar ou consultar os saldos.',saved:false,verified:false});}
}
