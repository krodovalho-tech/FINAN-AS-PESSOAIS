import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source=(await readFile(new URL('../api/trips.js',import.meta.url),'utf8'))
 .replace("import { sql } from '@vercel/postgres';",'const sql=(...args)=>globalThis.tripsSql(...args);')
 .replace("import { requireAuth } from '../lib/auth.js';",'const requireAuth=()=>globalThis.tripsAuthorized;');
const {default:handler}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const call=async(method,body)=>{const res={setHeader(){},status(n){this.code=n;return this;},json(data){this.data=data;return this;}};await handler({method,body},res);return res;};
test('destinos exigem sessão e validam destino/data antes de gravar',async()=>{
 let calls=0;globalThis.tripsSql=async()=>{calls++;return {rows:[]};};
 globalThis.tripsAuthorized=false;await call('POST',{destination:'Cidade / UF'});assert.equal(calls,0);
 globalThis.tripsAuthorized=true;
 for(const body of [{destination:' '},{destination:'x'.repeat(161)},{destination:'Cidade / UF',start_date:'2026-02-30'}])assert.equal((await call('POST',body)).code,400);
 assert.equal(calls,0);
});
test('destino é devolvido após confirmação do banco e falha não confirma salvamento',async()=>{
 globalThis.tripsAuthorized=true;
 globalThis.tripsSql=async(strings,...values)=>{if(strings.join('').startsWith('CREATE'))return {rows:[]};assert.deepEqual(values,['Cidade / UF','2026-10-08']);return {rows:[{id:1,destination:'Cidade / UF',start_date:new Date('2026-10-08T00:00:00Z')}]};};
 const saved=await call('POST',{destination:' Cidade / UF ',start_date:'2026-10-08'});assert.equal(saved.code,201);assert.equal(saved.data.start_date,'2026-10-08');
 globalThis.tripsSql=async()=>{throw new Error('offline');};assert.equal((await call('POST',{destination:'Cidade / UF'})).code,500);
});
