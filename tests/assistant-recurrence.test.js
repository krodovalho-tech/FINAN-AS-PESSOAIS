import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {editVerified} from '../lib/assistant-edit.js';
import {recordVerified} from '../lib/verified-record.js';
const base={type:'expense',category:'Investimento',description:'Contrato de teste',amount:627.7,date:'2026-10-20'};
function poolFor(db){const sql=async(strings,...values)=>db.query(strings.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values);return {connect:async()=>({sql,release(){}}),sql};}
async function setup(db){await db.exec(`CREATE TABLE entries(id SERIAL PRIMARY KEY,type TEXT,category TEXT,description TEXT,amount NUMERIC(12,2),date DATE,recurring BOOLEAN DEFAULT FALSE,recurrence_end_date DATE,notes TEXT,source_id TEXT,bank TEXT,confirmed BOOLEAN DEFAULT FALSE,reconciliation JSONB);CREATE TABLE recurrence_occurrences(source_id TEXT PRIMARY KEY);`);}
const day=v=>(v instanceof Date?v.toISOString():String(v)).slice(0,10);
const view=e=>({...e,date:day(e.date),recurrence_end_date:e.recurrence_end_date?day(e.recurrence_end_date):null,amount:Number(e.amount)});

test('recorrência futura é gravada, relida e conferida; retry não duplica e rejeita prazo alterado',async()=>{
 const db=new PGlite();try{
 await setup(db);const pool=poolFor(db);
 const input={...base,request_id:'test-recurring-contract',recurring:true,recurrence_end_date:'2027-10-20'};
 const first=await recordVerified(input,1,false,pool);
 assert.equal(first.verified,true);assert.equal(first.entry.recurring,true);assert.equal(first.entry.recurrence_end_date,'2027-10-20');
 const repeated=await recordVerified(input,1,false,pool);assert.equal(repeated.duplicate,true);
 await assert.rejects(recordVerified({...input,recurrence_end_date:'2028-10-20'},1,false,pool),/Conferência/);
 assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM entries')).rows[0].n,1);
 await assert.rejects(recordVerified({...input,request_id:'other-request',recurrence_end_date:'2026-10-19'},1,false,pool),e=>e.status===400);
 }finally{await db.close();}
});

test('ativa passado sem duplicar, mantém banco/valor/conciliação e protege snapshot e pagamentos',async()=>{
 const db=new PGlite();try{
 await setup(db);const pool=poolFor(db);
 const first=await recordVerified({...base,request_id:'test-historical-contract'},1,false,pool),id=first.entry.id;
 await db.query(`UPDATE entries SET bank='Unicred',confirmed=TRUE,reconciliation='{"status":"conciliado"}' WHERE id=$1`,[id]);
 const old=view((await db.query('SELECT * FROM entries WHERE id=$1',[id])).rows[0]);
 const changed=await editVerified({id,expected:old,changes:{recurring:true,recurrence_end_date:'2027-10-20'}},pool);
 assert.equal(changed.verified,true);assert.equal(changed.entry.recurring,true);assert.equal(changed.entry.amount,627.7);
 assert.equal(changed.entry.bank,'Unicred');assert.deepEqual(changed.entry.reconciliation,{status:'conciliado'});assert.equal(changed.entry.confirmed,true);
 assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM entries')).rows[0].n,1);
 assert.equal((await editVerified({id,expected:old,changes:{recurring:true,recurrence_end_date:'2027-10-20'}},pool)).unchanged,true);
 await assert.rejects(editVerified({id,expected:old,changes:{recurrence_end_date:'2028-10-20'}},pool),e=>e.status===409);
 const current=changed.entry;
 await assert.rejects(editVerified({id,expected:{...base},changes:{recurring:true}},pool),/Consulte/);
 await assert.rejects(editVerified({id,expected:current,changes:{recurrence_end_date:'2026-02-30'}},pool),e=>e.status===400);
 // Three forecasts: one inside the shortened limit, one paid outside, one unconfirmed outside.
 for(const [date,confirmed] of [['2026-11-20',false],['2026-12-20',true],['2027-01-20',false]]){
 const key=`${id}:${date.slice(0,7)}-01`;
 await db.query("INSERT INTO entries(type,category,description,amount,date,bank,source_id,confirmed) VALUES('expense','Investimento','Previsão',627.7,$1,'Recorrência',$2,$3)",[date,key,confirmed]);
 await db.query('INSERT INTO recurrence_occurrences(source_id) VALUES($1)',[key]);
 }
 const shorter=await editVerified({id,expected:current,changes:{recurrence_end_date:'2026-11-20'}},pool);
 assert.equal(shorter.verification.removed_forecasts,1);
 assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM entries WHERE bank='Recorrência'")).rows[0].n,2);
 const simple=await editVerified({id,expected:base,changes:{amount:627.69}},pool);
 assert.equal(simple.entry.recurring,true);assert.equal(simple.entry.recurrence_end_date,'2026-11-20');
 const disabled=await editVerified({id,expected:simple.entry,changes:{recurring:false}},pool);
 assert.equal(disabled.entry.recurring,false);assert.equal(disabled.entry.recurrence_end_date,null);
 assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM entries WHERE bank='Recorrência'")).rows[0].n,1);
 }finally{await db.close();}
});

test('API autenticada migra nas escritas e devolve snapshot de recorrência nas consultas',async()=>{
 const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto');
 const db=new PGlite();try{
 await setup(db);await db.exec('ALTER TABLE entries DROP COLUMN recurrence_end_date; CREATE TABLE assistant_connections(id SERIAL PRIMARY KEY,token_hash TEXT,token_expires TIMESTAMPTZ,revoked BOOLEAN DEFAULT FALSE);');
 const token='x'.repeat(43);await db.query("INSERT INTO assistant_connections(token_hash,token_expires) VALUES($1,NOW()+INTERVAL '1 hour')",[createHash('sha256').update(token).digest('hex')]);
 globalThis.apiRecurrencePool=poolFor(db);
 let source=await readFile(new URL('../api/assistant.js',import.meta.url),'utf8');
 source=source.replace("import { sql } from '@vercel/postgres';","const sql=Object.assign((...args)=>globalThis.apiRecurrencePool.sql(...args),{connect:()=>globalThis.apiRecurrencePool.connect()});")
  .replace(/from '(\.\.[^']+)'/g,(_,p)=>`from ${JSON.stringify(new URL(p,new URL('../api/assistant.js',import.meta.url)).href)}`);
 const {default:handler}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 const call=async(action,method,body,query={})=>{const r={setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};await handler({query:{action,...query},method,body,headers:{authorization:`Bearer ${token}`}},r);assert.ok(r.code<300,JSON.stringify(r.data));return r.data;};
 const list=await call('entries','GET',undefined,{year:2026,month:10});assert.deepEqual(list.entries,[]);
 const e=await call('record','POST',{...base,request_id:'api-recurrence-test',recurring:true,recurrence_end_date:'2027-10-20'});
 assert.equal(e.entry.recurring,true);assert.equal(e.entry.recurrence_end_date,'2027-10-20');
 const found=await call('entries','GET',undefined,{year:2026,month:10});assert.equal(found.entries[0].recurrence_end_date,'2027-10-20');
 const result=await call('edit','POST',{id:e.entry.id,expected:e.entry,changes:{recurrence_end_date:'2026-12-20'}});assert.equal(result.verified,true);assert.equal(result.entry.recurrence_end_date,'2026-12-20');
 }finally{delete globalThis.apiRecurrencePool;await db.close();}
});
