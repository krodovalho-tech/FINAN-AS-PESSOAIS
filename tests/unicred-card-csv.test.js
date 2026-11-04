import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUnicredCardCSV} from '../src/import.js';
import {reconciliationCandidates} from '../lib/card.js';
import {monthlyViews} from '../src/monthly-views.js';

const header='Data;Horário;Descrição;Valor;Portador;Final do cartão;Valor em dólar;Cotação';
const csv=header+'\n09/10/2026;10:22;"HOTEL; CENTRO (1/3)";350.00;Cliente;6654\n05/10/2026;10:15;Anuidade - bonificação;-39,58;Cliente;2173';
const parse=(content=csv)=>parseUnicredCardCSV(content,'FaturaUnicred_CLIENTE_NOVEMBRO_2026.csv',()=> 'Viagem');

test('CSV Unicred identifica colunas, cartão, referência e sinal da bonificação',()=>{
 const [purchase,credit]=parse();
 assert.equal(purchase.description,'HOTEL; CENTRO (1/3)');
 assert.deepEqual(purchase.reconciliation.invoice,{cycle:'2026-11',date:'2026-10-09',last_four:'6654',installment:1,count:3});
 assert.equal(credit.type,'income');
 assert.equal(credit.amount,39.58);
 assert.equal(purchase.source_id,parse()[0].source_id);
 assert.notEqual(parse(csv+'\n'+csv.split('\n')[1])[2].source_id,purchase.source_id);
 assert.equal(parse('date;description;amount\n2026-10-01;Compra;10'),null);
 assert.throws(()=>parse(csv.replace('09/10/2026','31/02/2026')),/linha 2/);
});

test('parcela da fatura não é vinculada a gasto à vista nem vira compra integral',()=>{
 const [purchase,credit]=parse();
 assert.deepEqual(reconciliationCandidates(purchase,[{...purchase,id:1,reconciliation:null}]),[]);
 assert.deepEqual(monthlyViews([purchase,credit],2026,10).purchases,[]);
 assert.deepEqual(monthlyViews([purchase,credit],2026,11).cash,[]);
 assert.deepEqual(monthlyViews([purchase,credit],2026,11).commitments,[credit,purchase]);
});

test('compra à vista na fatura pode conciliar um registro de parcela única',()=>{
 const [item]=parse(csv.replace(' (1/3)',''));
 const target={...item,id:1,reconciliation:null,notes:'@finance-card:'+JSON.stringify({
  purchase_id:'teste',installment:1,count:1,total:350,purchase_date:item.date,card:'Visa final 6654'
 })};
 assert.deepEqual(reconciliationCandidates(item,[target]),[target]);
 const multi={...target,notes:target.notes.replace('"count":1','"count":2')};
 assert.deepEqual(reconciliationCandidates(item,[multi]),[]);
});

test('conciliação aceita datas Date do banco em parcelas antigas',()=>{
 const [item]=parse();
 const old={...item,id:1,bank:'Assistente',date:new Date('2026-10-09T00:00:00Z'),
  description:'Hospedagem parcela 1/3 — compra total R$ 1.050,00',reconciliation:null};
 assert.deepEqual(reconciliationCandidates(item,[old]),[old]);
 assert.deepEqual(reconciliationCandidates(item,[{...old,date:new Date(NaN)}]),[]);
});
