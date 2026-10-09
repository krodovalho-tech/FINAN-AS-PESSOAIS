import test from 'node:test';
import assert from 'node:assert/strict';
import { detectImportFormat, parseImportJSON } from '../src/import.js';
const file=(content,name='extrato',type='')=>new File([content],name,{type});
test('PDF é reconhecido pelo conteúdo com qualquer nome e tipo no celular',async()=>{
 for(const f of [file('%PDF-1.7\n','download'),file('%PDF-1.7\n','extrato.PDF','application/pdf'),file('%PDF-1.7\n','extrato.json')])assert.equal(await detectImportFormat(f),'pdf');
});
test('arquivos vazios, falsos PDFs e JSON incompleto têm erros claros',async()=>{
 await assert.rejects(detectImportFormat(file('','extrato.pdf')),/vazio/);
 await assert.rejects(detectImportFormat(file('<html>erro</html>','extrato.pdf')),/PDF válido/);
 assert.throws(()=>parseImportJSON('{'),/incompleto ou inválido/);
});
test('JSON e OFX sem extensão continuam reconhecidos',async()=>{
 assert.equal(await detectImportFormat(file(' [{"amount":1}]')),'json');
 assert.equal(await detectImportFormat(file('OFXHEADER:100\n<OFX>')),'ofx');
 assert.equal(await detectImportFormat(file('data,valor','extrato.csv')),'csv');
});
