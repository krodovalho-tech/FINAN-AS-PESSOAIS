import { requireAuth } from '../lib/auth.js';
import { sql } from '@vercel/postgres';
const dateOK = x => /^\d{4}-\d{2}-\d{2}$/.test(x || '') && !Number.isNaN(Date.parse(x+'T12:00:00Z'));
const valid = x => x && dateOK(x.date) && ['Café da manhã','Almoço','Lanche','Jantar','Ceia','Outro'].includes(x.meal) && typeof x.description==='string' && x.description.trim().length>0 && x.description.length<=240 && ['calories','protein','carbs','fat'].every(k=>Number.isFinite(Number(x[k])) && Number(x[k])>=0 && Number(x[k])<=10000);
export default async function handler(req,res) {
 if (!requireAuth(req,res)) return;
 res.setHeader('Cache-Control','no-store');
 if (!['GET','POST','DELETE','PUT'].includes(req.method)) return res.status(405).json({error:'Método não permitido'});
 try {
  await sql`CREATE TABLE IF NOT EXISTS nutrition_entries (
    id BIGSERIAL PRIMARY KEY, date DATE NOT NULL, meal VARCHAR(40) NOT NULL,
    description VARCHAR(240) NOT NULL, calories NUMERIC(9,2) NOT NULL CHECK (calories>=0),
    protein NUMERIC(9,2) NOT NULL CHECK (protein>=0), carbs NUMERIC(9,2) NOT NULL CHECK (carbs>=0),
    fat NUMERIC(9,2) NOT NULL CHECK (fat>=0), source VARCHAR(20) NOT NULL DEFAULT 'manual',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  if(req.method==='GET'){
   const from=req.query.from || req.query.date, to=req.query.to || req.query.date;
   if(!dateOK(from)||!dateOK(to)||from>to) return res.status(400).json({error:'Período inválido'});
   const {rows}=await sql`SELECT id,date::text AS date,meal,description,calories::float AS calories,protein::float AS protein,carbs::float AS carbs,fat::float AS fat,source FROM nutrition_entries WHERE date BETWEEN ${from} AND ${to} ORDER BY date DESC,created_at DESC,id DESC LIMIT 3000`;
   return res.json(rows);
  }
  if(req.method==='POST'){
   const x=req.body||{};if(!valid(x))return res.status(400).json({error:'Confira data, refeição e valores numéricos.'});
   const {rows}=await sql`INSERT INTO nutrition_entries(date,meal,description,calories,protein,carbs,fat,source) VALUES(${x.date},${x.meal},${x.description.trim()},${Number(x.calories)},${Number(x.protein)},${Number(x.carbs)},${Number(x.fat)},'manual') RETURNING id,date::text AS date,meal,description,calories::float AS calories,protein::float AS protein,carbs::float AS carbs,fat::float AS fat,source`;return res.status(201).json(rows[0]);
  }
  const id=Number(req.query.id);
  if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:'Identificador inválido'});
  if(req.method==='DELETE'){const {rowCount}=await sql`DELETE FROM nutrition_entries WHERE id=${id}`;return res.status(rowCount?200:404).json({ok:!!rowCount});}
  const x=req.body||{};if(!valid(x))return res.status(400).json({error:'Dados inválidos'});
  const {rows}=await sql`UPDATE nutrition_entries SET date=${x.date},meal=${x.meal},description=${x.description.trim()},calories=${Number(x.calories)},protein=${Number(x.protein)},carbs=${Number(x.carbs)},fat=${Number(x.fat)} WHERE id=${id} RETURNING id,date::text AS date,meal,description,calories::float AS calories,protein::float AS protein,carbs::float AS carbs,fat::float AS fat,source`;return res.status(rows.length?200:404).json(rows[0]||{error:'Não encontrado'});
 }catch(err){console.error('nutrition',err);return res.status(500).json({error:'Não foi possível acessar o diário nutricional.'});}
}