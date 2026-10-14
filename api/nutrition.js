import { requireAuth } from '../lib/auth.js';
import { sql } from '@vercel/postgres';

const meals = new Set(['Café da manhã','Almoço','Lanche','Jantar','Ceia']);
const dateOK = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s||'')) && !Number.isNaN(Date.parse(s+'T12:00:00Z'));
const num = n => Number.isFinite(Number(n)) && Number(n)>=0 && Number(n)<=10000;
const clean = r => ({ ...r, date: String(r.date).slice(0,10) });
async function setup(){
  await sql`CREATE TABLE IF NOT EXISTS nutrition_meals (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL,
    meal VARCHAR(40) NOT NULL,
    description TEXT NOT NULL,
    calories NUMERIC(9,2) NOT NULL CHECK (calories >= 0),
    protein NUMERIC(9,2) NOT NULL CHECK (protein >= 0),
    carbs NUMERIC(9,2) NOT NULL CHECK (carbs >= 0),
    fat NUMERIC(9,2) NOT NULL CHECK (fat >= 0),
    source_id VARCHAR(120) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}
function validate(v){
  return dateOK(v?.date) && meals.has(v?.meal) && typeof v?.description==='string'
    && v.description.trim().length>0 && v.description.length<=2000
    && ['calories','protein','carbs','fat'].every(k=>num(v[k]));
}
export default async function handler(req,res){
  if(!requireAuth(req,res)) return;
  if(!['GET','POST','PUT','DELETE'].includes(req.method)) return res.status(405).json({error:'Método não permitido'});
  try {
    await setup();
    if(req.method==='GET'){
      const date=String(req.query.date||'');
      if(!dateOK(date)) return res.status(400).json({error:'Data inválida'});
      const {rows}=await sql`SELECT * FROM nutrition_meals WHERE date=${date} ORDER BY created_at,id`;
      return res.status(200).json(rows.map(clean));
    }
    if(req.method==='POST'){
      const v=req.body||{};
      if(!validate(v)) return res.status(400).json({error:'Confira refeição, descrição e nutrientes'});
      if(v.source_id && (typeof v.source_id!=='string'||v.source_id.length>120)) return res.status(400).json({error:'Identificador inválido'});
      const {rows}=await sql`INSERT INTO nutrition_meals(date,meal,description,calories,protein,carbs,fat,source_id)
        VALUES(${v.date},${v.meal},${v.description.trim()},${Number(v.calories)},${Number(v.protein)},${Number(v.carbs)},${Number(v.fat)},${v.source_id||null})
        ON CONFLICT(source_id) DO NOTHING RETURNING *`;
      if(!rows.length) return res.status(409).json({error:'Este registro já existe; não foi duplicado.'});
      return res.status(201).json(clean(rows[0]));
    }
    const id=String(req.query.id||'');
    if(!/^[1-9]\d*$/.test(id)) return res.status(400).json({error:'ID inválido'});
    if(req.method==='DELETE'){
      const {rowCount}=await sql`DELETE FROM nutrition_meals WHERE id=${id}::bigint`;
      return res.status(rowCount?200:404).json(rowCount?{ok:true}:{error:'Registro não encontrado'});
    }
    const v=req.body||{};
    if(!validate(v)) return res.status(400).json({error:'Dados inválidos'});
    const {rows}=await sql`UPDATE nutrition_meals SET date=${v.date},meal=${v.meal},
      description=${v.description.trim()},calories=${Number(v.calories)},
      protein=${Number(v.protein)},carbs=${Number(v.carbs)},fat=${Number(v.fat)}
      WHERE id=${id}::bigint RETURNING *`;
    return res.status(rows.length?200:404).json(rows.length?clean(rows[0]):{error:'Registro não encontrado'});
  } catch(e) {
    console.error('nutrition',e);
    return res.status(500).json({error:'Não foi possível gravar ou consultar o diário nutricional'});
  }
}