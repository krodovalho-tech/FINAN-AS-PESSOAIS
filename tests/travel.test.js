import test from 'node:test';
import assert from 'node:assert/strict';
import { travelDetails, travelPayload, normalizeDestination } from '../src/travel.js';
import { normalizeEntryForm } from '../src/entry-form.js';
import { normalizeImport } from '../src/import.js';
import { recurringPayload } from '../lib/entry-validation.js';

test('destino preserva categoria e observações ao salvar, editar e remover marcação',()=>{
  const form={id:1,type:'expense',category:'Transporte',description:'Combustível',amount:100,date:'2026-10-08',destination:'Cidade / UF',notes:'Observação\nem duas linhas',recurring:true};
  const saved=travelPayload(form);
  assert.equal(saved.category,'Transporte');
  assert.deepEqual(travelDetails(saved),{destination:'Cidade / UF',notes:form.notes});
  const editing=normalizeEntryForm(saved,'2026-10-09');
  assert.equal(travelPayload(editing).notes,saved.notes);
  assert.equal(travelPayload({...editing,destination:''}).notes,form.notes);
  assert.equal(travelDetails(travelPayload({...editing,destination:''})).destination,'');
});
test('exportação/importação e previsão recorrente mantêm o destino',()=>{
  const saved=travelPayload({id:1,type:'expense',category:'Viagem',description:'Hospedagem',amount:100,date:'2026-10-08',destination:'Cidade / UF',recurring:true});
  const imported=normalizeImport(JSON.parse(JSON.stringify([saved])))[0];
  assert.equal(travelDetails(imported).destination,'Cidade / UF');
  assert.equal(travelDetails(recurringPayload([imported],2026,10)[0]).destination,'Cidade / UF');
});
test('observações antigas e metadados inválidos continuam intactos',()=>{
  for(const notes of ['Observação anterior','{"origin":"assistant"}','@finance-travel:inválido']){
    const entry={notes};assert.deepEqual(travelDetails(entry),{destination:'',notes});assert.deepEqual(travelPayload(entry),entry);
  }
});

test('normaliza variações do mesmo destino para um único agrupador',()=>{
  for(const value of ['Carolina, MA','Carolina/MA','Carolina / MA',' Carolina  /  MA ']) assert.equal(normalizeDestination(value),'Carolina / MA');
  for(const description of ['Hospedagem — viagem Carolina, MA — cartão','Balsa — viagem a Carolina/MA','Abastecimento — viagem a Carolina / MA']) assert.equal(travelDetails({category:'Viagem',description}).destination,'Carolina / MA');
  assert.equal(travelDetails({category:'Alimentação',description:'Alimentação — viagem a Carolina, MA — bares e restaurantes'}).destination,'Carolina / MA');
});


test('descrições de voz e chat vinculam alimentação sem confundir pagamento com destino',()=>{
  for (const description of [
    'Alimentação – viagem Carolina/MA (cartão de crédito)',
    'Alimentação - viagem Carolina MA - crédito',
    'Alimentação viagem Carolina/MA',
    'Viagem para Carolina/MA (crédito)',
  ]) {
    const entry={category:'Alimentação',description,amount:260.70,notes:'{"origin":"assistant"}'};
    assert.equal(travelDetails(entry).destination,'Carolina / MA');
    assert.equal(entry.category,'Alimentação');
    assert.equal(entry.amount,260.70);
  }
  assert.equal(travelDetails({description:'Alimentação Carolina'}).destination,'');
  assert.equal(travelDetails(travelPayload({description:'Alimentação – viagem Carolina/MA',destination:'Palmas/TO'})).destination,'Palmas / TO');
});
