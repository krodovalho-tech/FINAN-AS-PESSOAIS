import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnicredRows } from '../src/unicred-pdf.js';
import { dashboardCategory, travelDetails } from '../src/travel.js';
const rows=[
 '09/10/2026 15:44:45',
 'Coop: 566 - AG: 1738 - Conta: 134279',
 'Saldo em 30/09/2026: R$ 740,12',
 '01/10/2026 CREDITO DE COBRANCA ( Doc.: JEiTDwIt1U / Créditos R$ 1.325,42 R$ 2.065,54',
 'Cobrança )',
 '01/10/2026 PF PCT PADRONIZADO I ( Doc.: 0 ) - R$ 15,50 R$ 2.050,04',
 'CENTRAL DE RELACIONAMENTO Pág. 1 /3',
 '0800 200 7302',
 'Data Lançamentos Valor (R$) Saldo (R$)',
 '01/10/2026 LIQUIDACAO DE TITULO - IB ( Doc.: 0421301260 / Qd - R$ 524,09 R$ 1.525,95',
 '30 17 )',
 'Saldo no final do período R$ 1.525,95',
 'Lançamentos futuros - R$ 2.724,06',
 '20/10/2026 DEBITO CONSORCIO - R$ 627,70',
];
test('extrato Unicred aceita descrições em várias linhas e mudança de página, valida saldo e exclui futuros',()=>{
 const entries=parseUnicredRows(rows);
 assert.equal(entries.length,3);
 assert.equal(entries[0].amount,1325.42);
 assert.equal(entries[0].description,'CREDITO DE COBRANCA ( Doc.: JEiTDwIt1U / Créditos Cobrança )');
 assert.equal(entries[2].description,'LIQUIDACAO DE TITULO - IB ( Doc.: 0421301260 / Qd 30 17 )');
 assert.equal(entries[2].type,'expense');
 assert.throws(()=>parseUnicredRows(rows.map(x=>x.replace('R$ 1.525,95','R$ 1.525,94'))),/Divergência/);
});
test('viagem soma todas as naturezas e dashboard conserva categoria original',()=>{
 const entries=[{type:'expense',category:'Viagem',amount:2180.72,description:'Hotel — viagem Carolina/MA'},{type:'expense',category:'Alimentação',amount:260.70,description:'Almoço — viagem Carolina/MA'},{type:'expense',category:'Alimentação',amount:25.98,description:'Lanche — viagem Carolina/MA'}];
 assert.equal(Math.round(entries.filter(e=>travelDetails(e).destination==='Carolina / MA').reduce((s,e)=>s+e.amount,0)*100),246740);
 assert.equal(dashboardCategory(entries[1]),'Alimentação');
 assert.equal(Math.round(entries.filter(e=>dashboardCategory(e)==='Viagem').reduce((s,e)=>s+e.amount,0)*100),218072);
 assert.ok(entries.every(e=>travelDetails(e).destination==='Carolina / MA'));
 assert.equal(dashboardCategory({type:'expense',category:'Alimentação',description:'Almoço SESC'}),'Alimentação');
});


test('cabeçalho com data e hora não vira movimentação nem contamina a descrição',()=>{
 const entries=parseUnicredRows([...rows.slice(0,7),'09/10/2026 15:44:45',...rows.slice(7)]);
 assert.equal(entries.length,3);
 assert.ok(entries.every(e=>!e.description.includes('15:44:45')));
});
