import test from 'node:test';
import assert from 'node:assert/strict';
import {recordPlan, recordVerified, verificationReceipt, financialMetrics, auditPurchase, monthlySummary} from '../lib/verified-record.js';
import {cardDetails,cardNotes} from '../lib/card.js';
const input={type:'expense',amount:100,date:'2026-10-10',purchase_date:'2026-10-09',description:'Passeios',category:'Viagem',destination:'Cidade / UF',installment_count:3,request_id:'example-purchase'};
import {mockPool} from './helpers/mock-pool.js';
test('atomic purchase has cent-exact schedule and independently checked month/trip deltas',async()=>{
 const prior={id:1,type:'expense',amount:25,date:'2026-10-08',category:'Viagem',description:'Passeios — viagem Cidade / UF'};
 const pool=mockPool([prior]);const r=await recordVerified(input,1,true,pool);
 assert.equal(r.saved,true);assert.equal(r.verified,true);assert.equal(r.verification.installment_sum,100);
 assert.deepEqual(r.entries.map(e=>e.amount),[33.34,33.33,33.33]);
 const trip=r.verification.impact.find(i=>JSON.stringify(i.scope)===JSON.stringify(['trip','Cidade / UF']));
 assert.deepEqual([trip.before,trip.after,trip.delta],[25,125,100]);
 assert.deepEqual(r.verification.impact.filter(i=>i.scope.length===3&&i.scope[0]==='installments').map(i=>i.delta),[33.34,33.33,33.33]);
 assert.equal(r.verification.impact.find(i=>i.scope[0]==='purchases').scope[1],'2026-10');
 assert.ok(pool.queries.indexOf('LOCK TABLE entries IN SHARE ROW EXCLUSIVE MODE')<pool.queries.findIndex(q=>q.startsWith('INSERT')));
 assert.equal(pool.queries.at(-2),'COMMIT');assert.ok(r.entries.every(e=>!e.confirmed));
});
test('retry returns checked zero impact; same ID with different input or mode is rejected',async()=>{
 const pool=mockPool();await recordVerified(input,1,true,pool);
 const replay=await recordVerified(input,1,true,pool);
 assert.equal(replay.duplicate,true);assert.equal(pool.state().length,3);assert.ok(replay.verification.impact.every(i=>i.delta===0));
 await assert.rejects(recordVerified({...input,amount:101},1,true,pool),/Conferência/);
 const {installment_count,purchase_date,...single}=input;
 await assert.rejects(recordVerified(single,1,false,pool),/Conferência/);
 assert.equal(pool.state().length,3);
});
test('partial insert failure rolls everything back',async()=>{
 const pool=mockPool([],(_,n)=>{if(n===2)throw new Error('database failure');return _;});
 await assert.rejects(recordVerified(input,1,true,pool),/database failure/);
 assert.equal(pool.state().length,0);assert.ok(pool.queries.includes('ROLLBACK'));
});
test('saved amount, metadata, date or category corruption never gets a success receipt',async()=>{
 for(const mutate of [e=>({...e,amount:99}),e=>({...e,notes:cardNotes(e.notes,{...cardDetails(e),purchase_id:'wrong'})}),e=>({...e,date:'2026-11-20'}),e=>({...e,category:'Other'})]) {
  const pool=mockPool([],mutate);await assert.rejects(recordVerified(input,1,true,pool),/Conferência/);assert.equal(pool.state().length,0);
 }
});
test('tripling total or changing unrelated entries is detected by snapshot verification',()=>{
 const plan=recordPlan(input,1,true),saved=plan.entries;
 const phantom={...saved[0],source_id:'other',notes:cardNotes(saved[0].notes,{...cardDetails(saved[0]),purchase_id:'phantom'})};
 assert.throws(()=>verificationReceipt(plan,[],[...saved,phantom],saved),/impacto/);
 const prior={type:'income',amount:200,date:'2026-10-10',category:'Income',description:'Example'};
 assert.throws(()=>verificationReceipt(plan,[prior],[...saved,{...prior,amount:201}],saved),/impacto/);
});
test('invalid inputs are rejected without connecting to database',async()=>{
 const pool={connect(){throw new Error('must not connect');}};
 for(const patch of [{amount:0},{amount:1.001},{date:'2026-02-30'},{installment_count:0},{installment_count:61},{installment_count:3.5},{type:'income'},{destination:''},{purchase_date:'2026-11-01'},{description:'Passeios parcela 1/3'}]) await assert.rejects(recordVerified({...input,...patch},1,true,pool),e=>e.status===400);
});
test('end of month, separate purchase date, and single income/expense all verify',async()=>{
 const plan=recordPlan({...input,date:'2027-01-31',purchase_date:'2026-12-30'},1,true);
 assert.deepEqual(plan.entries.map(e=>e.date),['2027-01-31','2027-02-28','2027-03-31']);
 assert.ok(plan.entries.every(e=>cardDetails(e).purchase_date==='2026-12-30'));
 for(const type of ['expense','income']) {
  const r=await recordVerified({type,amount:12.34,date:'2026-10-10',description:'Example',category:'Other',request_id:'single-example'},1,false,mockPool());
  assert.equal(r.verification.installment_sum,12.34);assert.equal(r.verified,true);
 }
});
test('two distinct purchases remain separate, and missing saved installment rejects retry',async()=>{
 const pool=mockPool();await recordVerified(input,1,true,pool);await recordVerified({...input,request_id:'another-purchase'},1,true,pool);
 assert.equal(financialMetrics(pool.state())[JSON.stringify(['trip','Cidade / UF'])],20000);
 const partial=mockPool(pool.state().slice(0,2));await assert.rejects(recordVerified(input,1,true,partial),/quantidade/);assert.equal(partial.state().length,2);
});

test('read-only audit checks legacy purchase and detects unexpected totals',()=>{
 const plan=recordPlan(input,1,true);const rows=plan.entries.map((e,i)=>({...e,id:i+1}));
 assert.equal(auditPurchase(rows,[1,2,3],100,'Cidade / UF').verified,true);
 assert.throws(()=>auditPurchase(rows,[1,2,3],101),/divergentes/);
 assert.throws(()=>auditPurchase(rows,[1,2],100),/incompleta/);
 assert.throws(()=>auditPurchase(rows,[1,2,3],100,'Outro / UF'),/destino/);
});

test('summary explicitly separates purchase month from installment months',()=>{
 const rows=recordPlan({...input,date:'2026-11-10'},1,true).entries;
 assert.equal(monthlySummary(rows,2026,10,'purchases').expense,100);
 assert.equal(monthlySummary(rows,2026,10,'installments').expense,0);
 assert.equal(monthlySummary(rows,2026,11,'installments').expense,33.34);
 assert.equal(monthlySummary(rows,2026,11,'purchases').expense,0);
});
