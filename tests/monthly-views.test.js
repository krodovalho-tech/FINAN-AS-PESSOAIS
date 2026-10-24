import test from 'node:test';
import assert from 'node:assert/strict';
import {monthlyViews,monthlyTotals,paymentMethod,paymentPayload} from '../src/monthly-views.js';
import {installmentSchedule} from '../lib/card.js';
const expense=(id,amount,date,description,method)=>({id,type:'expense',category:'Teste',description,amount,date,notes:method?JSON.stringify({payment_method:method}):''});

test('compras integrais, gastos fora do crédito e compromissos mensais têm bases distintas',()=>{
 const card=installmentSchedule({...expense(1,300,'2026-11-10','Compra no cartão'),purchase_date:'2026-10-24'},3,'Teste','purchase-test').map((e,i)=>({...e,id:i+1}));
 const rows=[...card,expense(4,50,'2026-10-24','Mercado','debit'),expense(5,25,'2026-10-24','Almoço','credit'),expense(6,10,'2026-10-24','Refeição','ticket'),expense(7,20,'2026-10-24','Despesa não identificada'),{...expense(8,200,'2026-10-15','Contrato','bank'),recurring:true,recurrence_end_date:'2026-12-15'}];
 assert.deepEqual(monthlyTotals(rows,2026,10),{purchases:605,cash:260,commitments:225,unknown:20,unknownCount:1});
 assert.deepEqual(monthlyTotals(rows,2026,11),{purchases:0,cash:200,commitments:300,unknown:0,unknownCount:0});
 assert.equal(monthlyTotals(rows,2026,12).commitments,300);
 assert.equal(monthlyTotals(rows,2027,1).commitments,100);
 assert.equal(monthlyTotals(rows,2027,2).commitments,0);
 assert.equal(rows.length,8); // Projection is read-only.
});

test('recorrência existente, duas cobranças iguais e crédito recorrente contam só uma vez por registro',()=>{
 const root={...expense(1,100,'2026-10-20','Assinatura','credit'),recurring:true};
 const generated={...expense(2,100,'2026-11-20','Assinatura','credit'),bank:'Recorrência',source_id:'1:2026-11-01',confirmed:false};
 const second={...expense(3,100,'2026-10-20','Segundo contrato','bank'),recurring:true};
 const rows=[root,generated,second];
 assert.equal(monthlyTotals(rows,2026,11).commitments,200);
 assert.equal(monthlyTotals(rows,2026,11).purchases,0);
 assert.equal(monthlyViews(rows,2026,11).forecasts.length,1);
 assert.equal(monthlyTotals([root,second],2026,11,['1:2026-11-01']).commitments,100);
 assert.equal(monthlyTotals([{...root,recurring:false}],2026,11).commitments,0);
 assert.equal(monthlyTotals([{...root,recurrence_end_date:'2026-11-19'}],2026,11).commitments,0);
});

test('legados usam evidência explícita; cartão Visa de extrato não é automaticamente crédito',()=>{
 assert.equal(paymentMethod(expense(1,20,'2026-10-24','Almoço — crédito')),'credit');
 assert.equal(paymentMethod({...expense(1,20,'2026-10-24','COMPRA CARTAO VISA'),bank:'Unicred • 4279'}),'bank');
 assert.equal(paymentMethod(expense(1,20,'2026-10-24','Compra supermercado')),'unknown');
 const e={...expense(1,20,'2026-10-24','Almoço — crédito','credit'),notes:'@finance-travel:{"destination":"Cidade / UF"}\n{"payment_method":"credit"}'};
 const saved=paymentPayload({...e,payment_method:'debit'});
 assert.equal(paymentMethod(saved),'debit');assert.ok(saved.notes.startsWith('@finance-travel:'));
 assert.throws(()=>paymentPayload({...e,payment_method:'invalid'}));
 const payment={...e,reconciliation:{kind:'card_payment'}};
 assert.equal(monthlyTotals([payment],2026,10).purchases,0);assert.equal(monthlyTotals([payment],2026,10).commitments,0);
});
