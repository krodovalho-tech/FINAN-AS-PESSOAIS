import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {validEntry,recurringPayload} from '../lib/entry-validation.js';
import {recurrenceCount,normalizeEntryForm} from '../src/entry-form.js';
import {normalizeImport} from '../src/import.js';
const root={type:'expense',category:'Empréstimos / financiamentos',description:'Empréstimo fictício',amount:100,date:'2026-01-31',recurring:true,recurrence_end_date:'2026-03-30'};

test('prazo inclusivo valida datas, conta pagamentos e preserva exportação/edição',()=>{
 assert.equal(validEntry(root),true);
 for(const end of ['2026-01-30','2026-02-30','inválida'])assert.equal(validEntry({...root,recurrence_end_date:end}),false);
 assert.equal(validEntry({...root,recurrence_end_date:null}),true);
 assert.equal(recurrenceCount(root.date,root.recurrence_end_date),2);
 assert.equal(recurrenceCount(root.date,'2026-03-31'),3);
 assert.equal(recurrenceCount('2024-01-31','2024-02-29'),2);
 assert.equal(recurringPayload([{...root,id:1}],2026,1).length,1);
 assert.equal(recurringPayload([{...root,id:1}],2026,2).length,0);
 assert.equal(recurringPayload([{...root,id:1,recurrence_end_date:'2026-03-31'}],2026,2).length,1);
 assert.equal(normalizeEntryForm({...root,recurrence_end_date:'2026-03-30T00:00:00Z'}).recurrence_end_date,'2026-03-30');
 assert.equal(normalizeImport([root])[0].recurrence_end_date,'2026-03-30');
});

test('Postgres: prazo é salvo, impede geração, remove só previsões e permite prorrogar',async()=>{
 const db=new PGlite();
 globalThis.endDateSql=async(strings,...values)=>{
  const query=strings.reduce((s,part,i)=>s+(i?`$${i}`:'')+part,'');
  return db.query(query,values);
 };
 async function handler(path){
  let source=await readFile(new URL(`../api/${path}.js`,import.meta.url),'utf8');
  source=source.replace("import { sql } from '@vercel/postgres';","const sql=(...args)=>globalThis.endDateSql(...args);")
   .replace("import { requireAuth } from '../lib/auth.js';","const requireAuth=()=>true;")
   .replace(/from '(\.\.[^']+)'/g,(_,p)=>`from ${JSON.stringify(new URL(p,new URL(`../api/${path}.js`,import.meta.url)).href)}`);
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
 }
 async function call(fn,body={},method='POST',query={}){
  const res={setHeader(){},status(n){this.code=n;return this;},json(d){this.data=d;return this;}};
  await fn({method,body,query},res);assert.ok(res.code<300,JSON.stringify(res.data));return res.data;
 }
 try{
  const setup=await handler('setup'),entries=await handler('entries'),recurring=await handler('recurring');
  await call(setup);await call(setup); // migration is idempotent
  const e=await call(entries,{...root,recurrence_end_date:'2026-06-30'});
  assert.equal(e.recurrence_end_date,'2026-06-30');
  assert.deepEqual(await call(recurring,{year:2026,month:1}),{inserted:1,skipped:0});
  assert.deepEqual(await call(recurring,{year:2026,month:1}),{inserted:0,skipped:1});
  for(const month of [2,3,4])await call(recurring,{year:2026,month});
  await db.exec("UPDATE entries SET confirmed=TRUE WHERE bank='Recorrência' AND date='2026-04-30'");
  await call(entries,{...root,recurrence_end_date:'2026-02-28'},'PUT',{id:String(e.id)});
  assert.deepEqual((await db.query("SELECT to_char(date,'YYYY-MM-DD') AS date FROM entries WHERE bank='Recorrência' ORDER BY date")).rows.map(e=>e.date),['2026-02-28','2026-04-30']);
  assert.equal((await call(recurring,{year:2026,month:2})).inserted,0);
  // Extend through the series editor; removed months must become eligible again.
  await call(recurring,{action:'edit',id:e.id,entry:{...root,recurrence_end_date:'2026-05-31'}});
  assert.equal((await call(recurring,{year:2026,month:2})).inserted,1);
  assert.equal((await call(recurring,{year:2026,month:4})).inserted,1);
  await call(recurring,{action:'edit',id:e.id,entry:{...root,recurrence_end_date:'2026-02-28'}});
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM entries WHERE bank='Recorrência' AND confirmed IS NOT TRUE AND date>'2026-02-28'")).rows[0].n,0);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM entries WHERE confirmed=TRUE')).rows[0].n,1);
  await call(recurring,{action:'edit',id:e.id,entry:{...root,recurrence_end_date:'2026-03-31'}});
  assert.equal((await call(recurring,{year:2026,month:2})).inserted,1);
  assert.equal((await call(recurring,{year:2026,month:4})).inserted,0);
  const march=(await db.query("SELECT id FROM entries WHERE bank='Recorrência' AND date='2026-03-31'")).rows[0];
  await call(entries,{},'DELETE',{id:String(march.id)});
  await call(entries,{...root,recurrence_end_date:'2026-06-30'},'PUT',{id:String(e.id)});
  assert.equal((await call(recurring,{year:2026,month:2})).inserted,0); // manual exclusion stays excluded
  const invalid={...root,recurrence_end_date:'2026-01-01'};
  const response={setHeader(){},status(n){this.code=n;return this;},json(){return this;}};
  await entries({method:'PUT',query:{id:String(e.id)},body:invalid},response);assert.equal(response.code,400);
 }finally{await db.close();delete globalThis.endDateSql;}
});
