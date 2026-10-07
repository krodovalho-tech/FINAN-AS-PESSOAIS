import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validEntry,recurringDate,recurringPayload} from '../lib/entry-validation.js';
import {normalizeEntryForm} from '../src/entry-form.js';
test('edição preenche data ISO e mantém identidade e dados importados',()=>{
 const e={id:12,date:'2026-10-06T00:00:00.000Z',amount:'1156.88',bank:'Caixa',source_id:'original'};
 assert.deepEqual(normalizeEntryForm(e),{...e,date:'2026-10-06',recurring:false});
 assert.equal(validEntry({type:'expense',category:'Moradia',description:'Prestação',amount:1156.88,date:'2026-11-06'}),true);
 for(const change of [{amount:0},{amount:-12},{amount:'12abc'},{date:'2026-02-30'}])assert.equal(validEntry({type:'expense',category:'Moradia',description:'Prestação',amount:12,date:'2026-10-06',...change}),false);
});
test('recorrência limita vencimento ao fim de fevereiro e restaura dia original em março',()=>{
 assert.equal(recurringDate('2026-01-31',2026,1),'2026-02-28');
 assert.equal(recurringDate(new Date('2026-01-31T00:00:00Z'),2026,1),'2026-02-28');
 assert.equal(recurringDate('2024-01-31',2024,1),'2024-02-29');
 assert.equal(recurringDate('2026-01-31',2026,2),'2026-03-31');
});
test('geração mantém chave mensal estável e ignora mês original, futuros e cópias',()=>{
 const root={id:5,type:'expense',category:'Moradia',description:'Aluguel',amount:'1000',date:'2026-01-31',recurring:true};
 const roots=[root,{...root,id:6,date:'2026-02-01'},{...root,id:7,bank:'Recorrência'},{...root,id:8,recurring:false}];
 const generated=recurringPayload(roots,2026,1);assert.equal(generated.length,1);assert.equal(generated[0].source_id,'5:2026-02-01');assert.equal(generated[0].recurring,false);
 assert.deepEqual(recurringPayload(roots,2026,1),generated);
});
test('edição valida antes do SQL e devolve data utilizável no formulário',async()=>{
 const source=(await readFile(new URL('../api/entries.js',import.meta.url),'utf8'))
 .replace("import { sql } from '@vercel/postgres';","const sql=(...args)=>globalThis.entriesSql(...args);")
 .replace("import { requireAuth } from '../lib/auth.js';","const requireAuth=()=>true;")
 .replace("'../lib/entry-validation.js'",JSON.stringify(new URL('../lib/entry-validation.js',import.meta.url).href));
 const {default:handler}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 let calls=0;globalThis.entriesSql=async()=>{calls++;return {rows:[{id:5,date:'2026-11-06T00:00:00.000Z',amount:'24.90'}]};};
 const call=async(body)=>{const res={setHeader(){},status(n){this.code=n;return this;},json(d){this.data=d;return this;}};await handler({method:'PUT',query:{id:'5'},body},res);return res;};
 const body={type:'expense',category:'Lanches',description:'Lanche',amount:24.9,date:'2026-11-06'};
 assert.equal((await call({...body,date:'2026-02-30'})).code,400);assert.equal(calls,0);
 const saved=await call(body);assert.equal(saved.code,200);assert.equal(saved.data.date,'2026-11-06');assert.equal(calls,1);
});
test('aplicação mensal normaliza datas do banco, conta repetidos e rejeita mês inválido',async()=>{
 const source=(await readFile(new URL('../api/recurring.js',import.meta.url),'utf8'))
 .replace("import { sql } from '@vercel/postgres';","const sql=(...args)=>globalThis.recurringSql(...args);")
 .replace("import { requireAuth } from '../lib/auth.js';","const requireAuth=()=>true;")
 .replace("'../lib/entry-validation.js'",JSON.stringify(new URL('../lib/entry-validation.js',import.meta.url).href));
 const {default:handler}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 let calls=0;const processed=new Set();
 globalThis.recurringSql=async(strings,...values)=>{
 calls++;const q=strings.join('');
 if(q.startsWith('SELECT'))return {rows:[{id:2115,type:'expense',category:'Moradia',description:'Prestação',amount:1000,date:new Date('2026-10-06T00:00:00Z'),recurring:true}]};
 if(q.startsWith('WITH')){
 assert.match(q,/INSERT INTO recurrence_occurrences/);const candidates=JSON.parse(values[0]);const rows=[];
 for(const e of candidates){assert.equal(e.date,'2026-11-06');if(!processed.has(e.source_id)){processed.add(e.source_id);rows.push({id:1});}}
 return {rows};
 }
 return {rows:[]};
 };
 const call=async(body)=>{const res={setHeader(){},status(n){this.code=n;return this;},json(d){this.data=d;return this;}};await handler({method:'POST',body},res);return res;};
 assert.equal((await call({year:2026,month:12})).code,400);assert.equal(calls,0);
 assert.deepEqual((await call({year:2026,month:10})).data,{inserted:1,skipped:0});
 assert.deepEqual((await call({year:2026,month:10})).data,{inserted:0,skipped:1});
});
test('encerrar pela cópia identifica a série original e protege pagamentos confirmados',async()=>{
 const source=(await readFile(new URL('../api/recurring.js',import.meta.url),'utf8'))
 .replace("import { sql } from '@vercel/postgres';","const sql=(...args)=>globalThis.stopSql(...args);")
 .replace("import { requireAuth } from '../lib/auth.js';","const requireAuth=()=>true;")
 .replace("'../lib/entry-validation.js'",JSON.stringify(new URL('../lib/entry-validation.js',import.meta.url).href));
 const {default:handler}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 let count=0;globalThis.stopSql=async(strings,...values)=>{
 count++;const query=strings.join('');
 if(query.startsWith('SELECT'))return {rows:[{id:88,bank:'Recorrência',source_id:'42:2026-11-01'}]};
 assert.equal(values[0],42);assert.equal(values[1],'42:%');
 assert.match(query,/UPDATE entries SET recurring=FALSE/);
 assert.match(query,/bank='Recorrência'/);assert.match(query,/confirmed IS NOT TRUE/);
 return {rows:[{stopped:1,removed:3}]};
 };
 const call=async(id)=>{const res={setHeader(){},status(n){this.code=n;return this;},json(data){this.data=data;return this;}};await handler({method:'POST',body:{action:'stop',id}},res);return res;};
 assert.equal((await call('invalid')).code,400);assert.equal(count,0);
 const stopped=await call(88);assert.equal(stopped.code,200);assert.deepEqual(stopped.data,{ok:true,stopped:1,removed:3});
 globalThis.stopSql=async()=>{throw new Error('unavailable');};assert.equal((await call(88)).code,500);
});
