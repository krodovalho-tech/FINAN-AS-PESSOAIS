import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCategory} from '../src/categories.js';
import {dashboardCategory} from '../src/travel.js';
import {monthlyViews} from '../src/monthly-views.js';
import {monthlySummary} from '../lib/verified-record.js';
const entries=[
 {id:1,type:'expense',category:'Investimento',description:'Parcela imóvel — débito',amount:1000,date:'2026-10-15',recurring:true},
 {id:2,type:'expense',category:'Investimento',description:'Consórcio 1',amount:100,date:'2026-10-20',recurring:true,bank:'Unicred'},
 {id:3,type:'expense',category:'Investimento',description:'Consórcio 2',amount:100,date:'2026-10-20',recurring:true,bank:'Unicred'},
 {id:4,type:'expense',category:'Investimentos',description:'Lote',amount:50,date:'2026-10-01',recurring:true,bank:'Unicred'},
 {id:5,type:'expense',category:'Investimentos',description:'Lote',amount:50,date:'2026-11-01',bank:'Recorrência',source_id:'4:2026-11-01',confirmed:false}
];
test('investimento e investimentos somam uma categoria em gastos e compromissos, inclusive previsões antigas',()=>{
 for(const mode of ['cash','commitments'])for(const month of [10,11]){
  const summary=monthlySummary(entries,2026,month,mode);
  assert.deepEqual(summary.expensesByCategory,[{category:'Investimento',amount:1250}]);
  const byCategory=monthlyViews(entries,2026,month)[mode].reduce((out,e)=>{const category=dashboardCategory(e);out[category]=(out[category]||0)+Math.round(e.amount*100);return out;},{});
  assert.deepEqual(byCategory,{Investimento:125000});
 }
 assert.equal(entries[3].category,'Investimentos');assert.equal(entries[4].category,'Investimentos');
 assert.equal(normalizeCategory(' INVESTIMENTOS '),'Investimento');
 assert.equal(normalizeCategory('Empréstimos concedidos'),'Empréstimos concedidos');
});
