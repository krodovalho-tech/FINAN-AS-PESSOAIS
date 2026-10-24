import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {extractStatementBalances,extractUnicredBalance,statementDate} from '../src/statement-balances.js';
import {recordBalance,listBalances,balanceInput} from '../lib/balances.js';
import {detectImportFormat} from '../src/import.js';
const now=new Date('2026-10-24T18:00:00Z');
const ofc=`<OFC><ACCTSTMT><ACCTFROM><BANKID>00104<ACCTID>0001234</ACCTFROM><STMTRS><DTSTART>20261001<DTEND>20261024<LEDGER>100.25<STMTTRN><TRNAMT>-20</STMTTRN></STMTRS></ACCTSTMT></OFC>`;

test('OFC/OFX extraem fechamento, identidade e data; limite disponível não é saldo',async()=>{
 const b=extractStatementBalances(ofc,{name:'statement.ofc',now});assert.equal(b.length,1);assert.equal(b[0].bank,'Caixa');assert.equal(b[0].account,'1234');assert.equal(b[0].balance,100.25);assert.equal(b[0].as_of,'2026-10-24');
 const multi=`<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>136<ACCTID>1234</BANKACCTFROM><DTEND>20261025<LEDGERBAL><BALAMT>200.10<DTASOF>20261024140000[-3:BRT]</LEDGERBAL><AVAILBAL><BALAMT>10200.10<DTASOF>20261024</AVAILBAL></STMTRS></STMTTRNRS><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>136<ACCTID>5678</BANKACCTFROM><LEDGERBAL><BALAMT>30.00<DTASOF>20261024</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
 const rows=extractStatementBalances(multi,{now});assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.balance),[200.1,30]);assert.equal(rows[0].as_of,'2026-10-24T14:00:00-03:00');
 assert.equal(statementDate('20260230'),null);
 const future=extractStatementBalances(ofc.replace('20261024','20261026'),{now})[0];assert.equal(future.as_of,null);assert.equal(future.needs_date,true);assert.equal(future.reported_as_of,'2026-10-26');
 assert.deepEqual(extractStatementBalances('<STMTTRN><TRNAMT>1000</STMTTRN>',{now}),[]);
 assert.equal(await detectImportFormat({name:'statement.ofc',size:ofc.length,slice:()=>({text:async()=>ofc})}),'ofx');
});

test('PDF usa saldo final e emissão; JSON de aplicações exige posição explícita',()=>{
 const rows=['24/10/2026 14:00:00','Extrato','Período de 01/10/2026 a 24/10/2026','Coop: 566 - AG: 1738 - Conta: 1234','Saldo atual R$ 200,10','Total Disponível R$ 10.200,10','Saldo em 30/09/2026: R$ 500,00','Saldo no final do período R$ 200,10'];
 const b=extractUnicredBalance(rows,{now});assert.equal(b[0].balance,200.1);assert.equal(b[0].as_of,'2026-10-24T14:00:00-03:00');
 const positions=extractStatementBalances(JSON.stringify({balances:[{bank:'Banco de teste',account:'CDB',kind:'investment',balance:1200,as_of:'2026-10-24'}]}),{now});assert.equal(positions[0].kind,'investment');
 assert.deepEqual(extractStatementBalances(JSON.stringify({transactions:[{category:'Investimento',amount:1000,date:'2026-10-24'}]}),{now}),[]);
});

test('Postgres: posição por conta e aplicação, histórico, idempotência e nenhum lançamento financeiro',async()=>{
 const db=new PGlite();const sql=async(strings,...values)=>db.query(strings.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values);
 try{
  await db.exec('CREATE TABLE entries(id SERIAL PRIMARY KEY,amount NUMERIC); INSERT INTO entries(amount) VALUES(50);');
  const base={bank:'Banco de teste',account:'1234',kind:'checking',balance:100,as_of:'2025-10-24',source:'Extrato de teste'};
  const first=await recordBalance(base,sql);assert.equal(first.saved,true);assert.equal(first.verified,true);assert.equal(first.is_latest,true);assert.equal(first.investment_total,null);
  const repeated=await recordBalance(base,sql);assert.equal(repeated.duplicate,true);
  const old=await recordBalance({...base,balance:500,as_of:'2025-10-01'},sql);assert.equal(old.is_latest,false);assert.equal(old.checking_total,100);
  await recordBalance({...base,account:'5678',balance:40},sql);
  const invested=await recordBalance({...base,account:'CDB',kind:'investment',balance:1000},sql);assert.equal(invested.checking_total,140);assert.equal(invested.investment_total,1000);assert.equal(invested.total,1140);
  const summary=await listBalances(sql);assert.equal(summary.balances.length,3);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM bank_balance_snapshots')).rows[0].n,4);
  assert.deepEqual((await db.query('SELECT * FROM entries')).rows,[{id:1,amount:'50'}]);
  for(const patch of [{balance:null},{balance:false},{balance:0.001},{as_of:'2026-02-30'},{as_of:'2099-01-01'},{balance:-1,kind:'investment'}])assert.throws(()=>balanceInput({...base,...patch},now));
  assert.equal(balanceInput({...base,balance:0},now).balance,0);
 }finally{await db.close();}
});
