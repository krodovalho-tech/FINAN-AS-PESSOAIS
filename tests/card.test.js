import test from 'node:test';
import assert from 'node:assert/strict';
import { installmentSchedule, purchaseCosts, cardDetails, reconciliationCandidates, isCardPayment, dashboardEntries } from '../lib/card.js';
import { travelPayload, travelDetails } from '../src/travel.js';
import { importBatch } from '../lib/import-batch.js';

const purchase = { type:'expense', category:'Viagem', description:'Hospedagem de exemplo', amount:1050, date:'2026-10-09', destination:'Cidade / UF' };
test('dashboard soma compra inteira em outubro e parcelas só na visão mensal',()=>{
  const installments=installmentSchedule(purchase,3,'Exemplo','purchase');
  const all=[...installments.reverse(),{...purchase,id:4,description:'Hospedagem anterior',date:'2026-10-08',amount:350},{type:'income',date:'2026-10-01',amount:2000}];
  const expenses=(list,month)=>list.filter(e=>e.type==='expense' && e.date.slice(0,7)===month).reduce((sum,e)=>sum+e.amount,0);
  assert.equal(expenses(dashboardEntries(all),'2026-10'),1400);
  assert.equal(expenses(dashboardEntries(all),'2026-11'),0);
  assert.equal(expenses(dashboardEntries(all,'installments'),'2026-10'),700);
  assert.equal(expenses(dashboardEntries(all,'installments'),'2026-11'),350);
  assert.equal(dashboardEntries(all).find(e=>e.card)?.card.installment,1);
  assert.equal(dashboardEntries(all).find(e=>e.type==='income').amount,2000);
});
test('compra conta uma vez na viagem e divide orçamento em três meses',()=>{
  const entries = installmentSchedule(travelPayload(purchase),3,'Cartão exemplo','purchase-example');
  assert.deepEqual(entries.map(e=>[e.date,e.amount]),[['2026-10-09',350],['2026-11-09',350],['2026-12-09',350]]);
  assert.equal(purchaseCosts(entries).reduce((sum,e)=>sum+e.amount,0),1050);
  assert.equal(travelDetails(entries[0]).destination,'Cidade / UF');
  assert.equal(cardDetails(entries[2]).installment,3);
});
test('parcelas somam todos os centavos e respeitam fim de mês',()=>{
  const entries=installmentSchedule({...purchase,amount:100,date:'2026-01-31'},3,'','example');
  assert.deepEqual(entries.map(e=>e.date),['2026-01-31','2026-02-28','2026-03-31']);
  assert.deepEqual(entries.map(e=>e.amount),[33.34,33.33,33.33]);
});
test('descrições antigas agrupam compra completa sem triplicar custo',()=>{
  const entries=['10','11','12'].map((m,i)=>({...purchase,date:`2026-${m}-09`,amount:350,description:`Hospedagem — viagem Cidade, UF — cartão de crédito — parcela ${i+1}/3 — compra total R$ 1.050,00`}));
  assert.equal(purchaseCosts(entries.reverse()).length,1);
  assert.equal(purchaseCosts(entries)[0].amount,1050);
});
test('número da parcela restringe candidatos e quitação não soma compras',()=>{
  const entries=installmentSchedule(purchase,3,'','example');
  assert.equal(reconciliationCandidates({type:'expense',amount:350,description:'Hotel 2/3'},entries).length,1);
  const payment={...purchase,reconciliation:{kind:'card_payment'}};
  assert.equal(isCardPayment(payment),true);assert.deepEqual(purchaseCosts([payment]),[]);
});

function mockPool(initial) {
  let state=structuredClone(initial), backup;
  const calls=[];
  const client={release(){calls.push('release');},async sql(strings,...v){
    const q=strings.join('');calls.push(q);
    if(q==='BEGIN')backup=structuredClone(state);
    if(q==='ROLLBACK')state=backup;
    if(q.startsWith('SELECT *'))return {rows:structuredClone(state)};
    if(q.startsWith('UPDATE')){const e=state.find(e=>e.id===v[1]);e.confirmed=true;e.reconciliation=JSON.parse(v[0]);return {rows:[structuredClone(e)]};}
    if(q.includes('INSERT INTO entries')){const e={id:state.length+1,type:v[0],category:v[1],description:v[2],amount:v[3],date:v[4],notes:v[6],source_id:v[7],bank:v[8],reconciliation:v[10]?JSON.parse(v[10]):null};state.push(e);return {rows:[e]};}
    return {rows:[]};
  }};
  return {connect:async()=>client,calls,state:()=>state};
}
const target={id:1,...purchase,amount:350,date:'2026-10-09',notes:'observação original'};
const item={...purchase,amount:350,bank:'Banco exemplo',source_id:'statement-1',description:'HOTEL EXEMPLO 1/3',match_id:1,match_expected:{...target}};
test('conciliação preserva compra, categoria e data; reimportação usa identidade da fatura',async()=>{
  const pool=mockPool([target]);
  const first=await importBatch([item],pool);assert.equal(first.reconciled,1);assert.equal(first.inserted,0);
  assert.equal(pool.state()[0].description,target.description);assert.equal(pool.state()[0].notes,target.notes);
  const again=await importBatch([item],pool);assert.equal(again.skipped,1);assert.equal(pool.state().length,1);
});
test('conflito ou dois vínculos à mesma parcela desfazem todo o lote',async()=>{
  for(const invalid of [{...item,amount:351},{...item,source_id:'another'}]){
    const pool=mockPool([target]);
    await assert.rejects(importBatch([{...purchase,source_id:'new',bank:'Banco'},item,invalid],pool));
    assert.deepEqual(pool.state(),[target]);assert.ok(pool.calls.includes('ROLLBACK'));assert.equal(pool.calls.at(-1),'release');
  }
});

test('assistant parcel IDs share one purchase, including already saved metadata', () => {
  const entries = [1,2,3].map((installment) => ({
    type:'expense', amount: installment === 3 ? 33.34 : 33.33,
    date:`2026-${9 + installment}-10`, description:`Tour — parcela ${installment}/3`,
    notes:'@finance-card:' + JSON.stringify({purchase_id:`assistant:1:tour-example-p${installment}`,installment,count:3,total:100,purchase_date:`2026-${9 + installment}-10`,card:''})
  }));
  const costs = purchaseCosts([...entries].reverse());
  assert.equal(costs.length,1);
  assert.equal(costs[0].amount,100);
  assert.equal(costs[0].date,'2026-10-10');
  assert.deepEqual(dashboardEntries(entries,'installments').map(e=>e.amount),[33.33,33.33,33.34]);
  const other = {...entries[0],notes:entries[0].notes.replace('tour-example','other-tour')};
  assert.equal(purchaseCosts([...entries,other]).length,2);
});
