import { sql } from '@vercel/postgres';
import { requireAuth } from '../lib/auth.js';
import { listBalances,recordBalance } from '../lib/balances.js';
export default async function handler(req,res){
 if(!requireAuth(req,res))return;
 res.setHeader('Cache-Control','no-store');
 try{
  if(req.method==='GET')return res.status(200).json(await listBalances(sql));
  if(req.method==='POST')return res.status(201).json(await recordBalance(req.body,sql));
  return res.status(405).json({error:'Método não permitido'});
 }catch(error){return res.status(error.status||500).json({error:error.status?error.message:'Não foi possível salvar ou consultar os saldos.',saved:false,verified:false});}
}
