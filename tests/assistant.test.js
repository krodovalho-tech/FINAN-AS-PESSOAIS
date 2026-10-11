import {mockPool} from './helpers/mock-pool.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const text=(await readFile(new URL('../api/assistant.js',import.meta.url),'utf8')).replace("import { sql } from '@vercel/postgres';","const sql=Object.assign((...args)=>globalThis.assistantSql(...args),{connect:()=>globalThis.assistantPool.connect()});").replace("import { requireAuth } from '../lib/auth.js';","const requireAuth=()=>true;").replace("'../lib/card.js'",JSON.stringify(new URL('../lib/card.js',import.meta.url).href)).replace("'../lib/verified-record.js'",JSON.stringify(new URL('../lib/verified-record.js',import.meta.url).href)).replace("'../src/travel.js'",JSON.stringify(new URL('../src/travel.js',import.meta.url).href));
const {default:handler}=await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);
async function call(action,body,token){const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(data){this.data=data;return this;}};await handler({method:'POST',query:{action},body,headers:{authorization:token?`Bearer ${token}`:undefined}},res);return res;}
test('troca exige prova, aceita uma vez e rejeita replay',async()=>{
 const code='A'.repeat(43),verifier='b'.repeat(64);let unused=true;
 globalThis.assistantSql=async(strings,...v)=>({rows:strings.join('').startsWith('UPDATE')&&unused&&v[1]===hash(code)&&v[2]===hash(verifier)?(unused=false,[{id:1}]):[]});
 assert.equal((await call('exchange',{code,verifier:'c'.repeat(64)})).statusCode,401);
 const valid=await call('exchange',{code,verifier});assert.equal(valid.statusCode,200);assert.match(valid.data.token,/^[A-Za-z0-9_-]{43}$/);
 assert.equal((await call('exchange',{code,verifier})).statusCode,401);
});
test('sem token ou valores inválidos não há confirmação de gravação',async()=>{
 assert.equal((await call('record',{})).statusCode,401);
 globalThis.assistantSql=async()=>({rows:[{id:1}]});
 const invalid=await call('record',{type:'expense',amount:-1},'D'.repeat(43));assert.equal(invalid.statusCode,400);assert.equal(invalid.data.saved,false);
});


test('edição altera o registro consultado, preserva metadados e rejeita conflito',async()=>{
 const entry={id:2217,type:'expense',category:'Alimentação',description:'Churros',amount:10,date:'2026-10-08'};
 let updates=0;
 globalThis.assistantSql=async(strings,...v)=>{const q=strings.join('');if(q.startsWith('SELECT id FROM assistant'))return {rows:[{id:1}]};if(q.startsWith('UPDATE entries')){updates++;assert.ok(!q.includes('bank='));assert.ok(!q.includes('recurring='));return {rows:[{...entry,category:v[1]}]};}return {rows:[entry]};};
 const body={id:entry.id,expected:{type:entry.type,category:entry.category,description:entry.description,amount:entry.amount,date:entry.date},changes:{category:'Alimentação — bares, restaurantes e lanches'}};
 const result=await call('edit',body,'D'.repeat(43));assert.equal(result.statusCode,200);assert.equal(result.data.saved,true);assert.equal(result.data.entry.id,2217);assert.equal(updates,1);
 globalThis.assistantSql=async(strings)=>({rows:strings.join('').startsWith('SELECT id FROM assistant')?[{id:1}]:strings.join('').startsWith('UPDATE entries')?[]:[{...entry,amount:11}]});
 assert.equal((await call('edit',body,'D'.repeat(43))).statusCode,409);
 assert.equal((await call('edit',{...body,changes:{amount:-1}},'D'.repeat(43))).statusCode,400);
 assert.equal((await call('edit',{...body,changes:{date:'2026-02-30'}},'D'.repeat(43))).statusCode,400);
 assert.equal((await call('edit',{...body,changes:{bank:'Outro'}},'D'.repeat(43))).statusCode,400);
 assert.equal((await call('edit',body)).statusCode,401);
});
test('edição repetida é idempotente e registro ausente retorna 404',async()=>{
 const expected={type:'expense',category:'Alimentação',description:'Churros',amount:10,date:'2026-10-08'};
 const body={id:2217,expected,changes:{category:'Lanches'}};
 globalThis.assistantSql=async(strings)=>({rows:strings.join('').startsWith('SELECT id FROM assistant')?[{id:1}]:strings.join('').startsWith('UPDATE entries')?[]:[{id:2217,...expected,category:'Lanches',date:new Date('2026-10-08')}]});
 const repeat=await call('edit',body,'D'.repeat(43));assert.equal(repeat.statusCode,200);assert.equal(repeat.data.unchanged,true);
 globalThis.assistantSql=async(strings)=>({rows:strings.join('').startsWith('SELECT id FROM assistant')?[{id:1}]:[]});
 assert.equal((await call('edit',body,'D'.repeat(43))).statusCode,404);
});


test('record endpoint rejects legacy individual parcels and unauthenticated purchases',async()=>{
 globalThis.assistantSql=async()=>({rows:[{id:1}]});
 const r=await call('record',{type:'expense',amount:10,date:'2026-10-10',description:'Tour parcela 1/3',category:'Other',request_id:'legacy-example'},'D'.repeat(43));
 assert.equal(r.statusCode,400);assert.equal(r.data.saved,false);
 assert.equal((await call('purchase',{})).statusCode,401);
});

test('authenticated purchase endpoint only confirms after transactional verification',async()=>{
 globalThis.assistantSql=async()=>({rows:[{id:1}]});globalThis.assistantPool=mockPool();
 const args={type:'expense',amount:100,date:'2026-10-10',purchase_date:'2026-10-10',description:'Tour',category:'Passeios',installment_count:3,request_id:'endpoint-example'};
 const result=await call('purchase',args,'D'.repeat(43));
 assert.equal(result.statusCode,201);assert.equal(result.data.saved,true);assert.equal(result.data.verified,true);assert.equal(result.data.entries.length,3);
 const repeat=await call('purchase',args,'D'.repeat(43));assert.equal(repeat.statusCode,200);assert.equal(repeat.data.duplicate,true);
 globalThis.assistantPool=mockPool([],e=>({...e,amount:999}));
 const bad=await call('purchase',args,'D'.repeat(43));assert.equal(bad.statusCode,409);assert.equal(bad.data.saved,false);assert.equal(globalThis.assistantPool.state().length,0);
});
