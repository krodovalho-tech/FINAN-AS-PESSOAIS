import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeImport } from '../src/import.js';
import { request } from '../src/api.js';
import { requireAuth, sessionCookie } from '../lib/auth.js';

test('JSON revisado conserva identidade, categoria, confirmação e reconciliação',()=>{
 const result = normalizeImport({transactions:[{id:'a',bank:'Banco • 0001',date:'20261001',amount:-12.50,memo:'Exemplo',category:'Categoria própria',confirmed:true,reconciliation:'Conciliado'}]});
 assert.deepEqual(result.map(e=>[e.type,e.date,e.amount,e.source_id,e.bank,e.category,e.confirmed,e.reconciliation]),[['expense','2026-10-01',12.5,'a','Banco • 0001','Categoria própria',true,'Conciliado']]);
});
test('exportação do painel mantém tipo e valor positivo',()=>{
 assert.equal(normalizeImport([{type:'expense',date:'2026-10-01',amount:12,description:'Exemplo',category:'Outros',source_id:'a'}])[0].type,'expense');
 assert.throws(()=>normalizeImport({transactions:[{amount:'inválido'}]}));
});
test('API rejeita HTTP de erro e resposta não JSON, sem sucesso falso',async()=>{
 const original=globalThis.fetch;
 try {
  globalThis.fetch=async()=>({ok:false,json:async()=>({error:'Banco indisponível'})});
  await assert.rejects(request('entries'),/Banco indisponível/);
  globalThis.fetch=async()=>({ok:false,json:async()=>{throw Error('HTML')}});
  await assert.rejects(request('entries'),/Resposta inválida/);
 } finally {globalThis.fetch=original;}
});
test('dados bloqueados sem configuração, sem sessão e com cookie adulterado',()=>{
 const original=process.env.FINANCE_PASSWORD;
 const res={setHeader(){},status(code){this.code=code;return this;},json(){}};
 try {
  delete process.env.FINANCE_PASSWORD;
  assert.equal(requireAuth({headers:{}},res),false);assert.equal(res.code,503);
  process.env.FINANCE_PASSWORD='senha-ficticia-para-testes';
  assert.equal(requireAuth({headers:{}},res),false);assert.equal(res.code,401);
  const cookie=sessionCookie().split(';')[0];
  assert.equal(requireAuth({headers:{cookie}},res),true);
  assert.equal(requireAuth({headers:{cookie:cookie.replace(/.$/,'x')}},res),false);
  assert.equal(requireAuth({headers:{cookie,origin:'https://outra.example',host:'finance.example'}},res),false);assert.equal(res.code,403);
 } finally {if(original===undefined) delete process.env.FINANCE_PASSWORD;else process.env.FINANCE_PASSWORD=original;}
});
