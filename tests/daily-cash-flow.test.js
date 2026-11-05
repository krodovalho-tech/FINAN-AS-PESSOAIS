import test from 'node:test';
import assert from 'node:assert/strict';
import {projectDailyCash} from '../src/daily-cash-flow.js';

test('projeta somente após o saldo-base e identifica a falta de caixa antes do aluguel',()=>{
 const rows=projectDailyCash({openingDate:'2026-11-04',openingCents:100000,monthEnd:'2026-11-30',movements:[
  {date:'2026-11-04',type:'income',cents:50000},
  {date:'2026-11-05',type:'expense',cents:120000},
  {date:'2026-11-09',type:'income',cents:150000},
 ]});
 assert.equal(rows.length,26);
 assert.equal(rows[0].balance,-20000);
 assert.equal(rows[4].balance,130000);
 assert.equal(rows.at(-1).balance,130000);
});
