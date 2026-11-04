import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {planStatementImport,reconciliationCandidates} from '../lib/card.js';
const text=(await readFile(new URL('../lib/import-batch.js',import.meta.url),'utf8')).replace("import { sql } from '@vercel/postgres';",'const sql=null;').replace("'./card.js'",JSON.stringify(new URL('../lib/card.js',import.meta.url).href));
const {importBatch}=await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);
const old={id:1,type:'expense',amount:47.91,date:'2026-10-08',category:'Supermercado',description:'Compra supermercado',bank:'Assistente',notes:'observação e viagem preservadas'};
const incoming={type:'expense',amount:47.91,date:'2026-10-08',category:'Alimentação',description:'COMPRA CARTAO VISA AtacadaoDosPrecos',bank:'Unicred 566 • 1738 • 134279',source_id:'PDF-2026-10-08-D-4791-645288',import_action:'new'};
function pool(initial){let state=structuredClone(initial),backup;const calls=[];const client={release(){},async sql(strings,...v){const q=strings.join('');calls.push(q);if(q==='BEGIN')backup=structuredClone(state);if(q==='ROLLBACK')state=backup;if(q.startsWith('SELECT *'))return{rows:structuredClone(state)};if(q.startsWith('UPDATE')){const e=state.find(e=>e.id===v[1]);e.confirmed=true;e.reconciliation=JSON.parse(v[0]);return{rows:[structuredClone(e)]};}if(q.includes('INSERT INTO')){const e={id:state.length+1,type:v[0],category:v[1],description:v[2],amount:v[3],date:v[4],bank:v[9],source_id:v[8]};state.push(e);return{rows:[e]};}return{rows:[]};}};return{connect:async()=>client,state:()=>state,calls};}
test('PDF encontra voz/manual apesar do rótulo de origem e conserva limites de valor/data/conta',()=>{
 assert.equal(reconciliationCandidates(incoming,[old,{...old,id:2,bank:null}]).length,2);
 assert.equal(reconciliationCandidates(incoming,[{...old,amount:47.92},{...old,date:'2026-09-01'},{...old,bank:'Unicred 566 • 1738 • 999999'}]).length,0);
 assert.equal(reconciliationCandidates(incoming,[{...old,bank:'Unicred • 134279'}]).length,1);
 assert.equal(reconciliationCandidates(incoming,[{...old,reconciliation:{status:'conciliado'}}]).length,1);
});
test('servidor bloqueia novo com possível repetido e desfaz lote',async()=>{
 const db=pool([old]);
 await assert.rejects(importBatch([incoming],db),/duplicidade/);
 assert.deepEqual(db.state(),[old]);assert.ok(db.calls.includes('ROLLBACK'));
});
test('vínculo preserva classificação, descrição e notas e reimportação ignora alias',async()=>{
 const db=pool([old]);const item={...incoming,import_action:'match',match_id:1,match_expected:old};
 assert.equal((await importBatch([item],db)).reconciled,1);
 assert.equal(db.state()[0].category,old.category);assert.equal(db.state()[0].notes,old.notes);assert.equal(db.state()[0].description,old.description);
 assert.equal((await importBatch([incoming],db)).skipped,1);assert.equal(db.state().length,1);
});
test('decisão explícita permite gasto distinto de mesmo valor e ignorar não grava',async()=>{
 const db=pool([old]);assert.equal((await importBatch([{...incoming,reviewed_new:true}],db)).inserted,1);
 const ignored=pool([old]);assert.equal((await importBatch([{...incoming,import_action:'skip'}],ignored)).skipped,1);assert.equal(ignored.state().length,1);
});
test('vínculo com conta diferente ou data distante é rejeitado no servidor',async()=>{
 for(const target of [{...old,date:'2026-09-01'},{...old,bank:'Banco diferente'}]){
 const db=pool([target]);await assert.rejects(importBatch([{...incoming,import_action:'match',match_id:1,match_expected:target}],db),/não corresponde/);
 }
});

test('aliases explícitos da Unicred permitem conciliar sem confundir outras contas', () => {
  const item = {type:'income',amount:3541,date:'2026-10-08',bank:'Unicred 566 • 1738 • 134279',description:'Crédito de cobrança'};
  const manual = {...item,id:90,bank:'Unicred • 4279',category:'Aluguéis recebidos',description:'Aluguel'};
  assert.equal(reconciliationCandidates(item,[manual]).length,1);
  assert.equal(reconciliationCandidates(item,[{...manual,bank:'Unicred • 9999'}]).length,0);
  assert.equal(reconciliationCandidates(item,[{...manual,bank:'Caixa • 4279'}]).length,0);
});

test('prévia escolhe vínculo forte único e separa origens bancárias distintas',()=>{
 const pix={...incoming,description:'DEBITO PAGAMENTO PIX ( Doc.: PGTO PIX / NEW CENTER HOTEL LTDA )',source_id:'20261008597757',amount:350,payment_method:'pix'};
 const hotel={...old,amount:350,description:'Hospedagem New Center Hotel Ltda',payment_method:'pix'};
 const credit={...hotel,id:2,payment_method:'credit'};
 const method=entry=>entry.payment_method || 'unknown';
 const preview=(items,entries)=>planStatementImport(items,entries,method).map(e=>e.import_action);
 assert.deepEqual(preview([pix],[hotel,credit]),['match:1']);
 assert.deepEqual(preview([pix],[{...hotel,payment_method:'unknown'},credit]),['pending']);
 assert.deepEqual(preview([pix],[{...hotel,description:'Hotel desconhecido'},credit]),['pending']);
 assert.deepEqual(preview([pix,{...pix,source_id:'20261008597758'}],[hotel]),['pending','pending']);
 assert.deepEqual(preview([pix],[{...hotel,id:3,bank:'Unicred • 0000134279',source_id:pix.source_id}]),['skip']);
 assert.deepEqual(preview([pix],[{...hotel,bank:'Unicred • 134279',source_id:'20261008597758'}]),['new']);
 assert.deepEqual(preview([pix],[{...hotel,bank:'Unicred • 134279',source_id:'PDF-2026-10-08-D-35000-10000'}]),['pending']);
 assert.deepEqual(preview([pix],[{...hotel,description:'Hospedagem — FITID '+pix.source_id,payment_method:'unknown'}]),['match:1']);
});

test('servidor grava tarifas de mesmo valor com FITIDs distintos e reimporta sem duplicar',async()=>{
 const tariff={...incoming,bank:'Unicred • 134279',description:'DÉBITO TARIFA DE COBRANÇA COMPE',amount:2.46,source_id:'20261008597767'};
 const prior={...tariff,id:1,bank:'Unicred • 4279',date:new Date('2026-10-07T00:00:00Z'),source_id:'20261007597772'};
 const rows=[tariff,{...tariff,date:'2026-10-19',source_id:'20261019597740'}];
 const db=pool([prior]);
 assert.deepEqual(planStatementImport(rows,[prior],()=> 'unknown').map(e=>e.import_action),['new','new']);
 assert.equal((await importBatch(rows,db)).inserted,2);
 assert.equal((await importBatch(rows,db)).skipped,2);
 assert.equal(db.state().length,3);
});

test('validação final detecta lançamento manual recente com data do banco e informa a linha',async()=>{
 const db=pool([{...old,date:new Date('2026-10-08T00:00:00Z')}]);
 await assert.rejects(importBatch([incoming],db),/duplicidade em 2026-10-08.*47.91/);
 assert.ok(db.calls.includes('ROLLBACK'));
});

test('o servidor compara novos com o estado prévio, sem sugerir duplicidade entre linhas do mesmo arquivo',async()=>{
 const first={...incoming,source_id:'ofc-tarifa-a',amount:2.46};
 const second={...first,source_id:'ofc-tarifa-b',date:'2026-10-19'};
 const db=pool([]);
 assert.equal((await importBatch([first,second],db)).inserted,2);
 assert.equal((await importBatch([first,second],db)).skipped,2);
});
