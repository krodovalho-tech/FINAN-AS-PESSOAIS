import { statementAccount } from '../src/statement-balances.js';
export async function ensureBalances(sql){
 await sql`CREATE TABLE IF NOT EXISTS bank_balance_snapshots (id BIGSERIAL PRIMARY KEY,bank TEXT NOT NULL,balance NUMERIC(14,2) NOT NULL,as_of TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW())`;
 await sql`ALTER TABLE bank_balance_snapshots ADD COLUMN IF NOT EXISTS account TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'checking', ADD COLUMN IF NOT EXISTS source TEXT`;
 await sql`CREATE TABLE IF NOT EXISTS bank_balance_exclusions (
  bank TEXT NOT NULL, account TEXT NOT NULL, kind TEXT NOT NULL,
  PRIMARY KEY (bank,account,kind)
 )`;
 // Existing legacy rows remain available. A partial unique index keeps repeated uploads idempotent.
 await sql`CREATE UNIQUE INDEX IF NOT EXISTS balance_snapshot_identity ON bank_balance_snapshots(bank,account,kind,as_of,balance) WHERE source IS NOT NULL`;
}
export function balanceInput(input,now=new Date()){
 const {bank,balance,kind='checking',source='Registro manual'}=input||{};
 const account=statementAccount(input?.account||'');
 const as_of=typeof input?.as_of==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(input.as_of)?input.as_of+'T00:00:00-03:00':input?.as_of;
 const date=new Date(as_of),amount=Number(balance);
 const rawDay=String(input?.as_of||'').slice(0,10);
 const realDay=/^\d{4}-\d{2}-\d{2}$/.test(rawDay)&&!Number.isNaN(Date.parse(rawDay+'T12:00:00Z'))&&new Date(rawDay+'T12:00:00Z').toISOString().slice(0,10)===rawDay;
 if(!['number','string'].includes(typeof balance)||!realDay||typeof bank!=='string'||!bank.trim()||bank.length>100||account.length>120||!['checking','investment'].includes(kind)||balance===null||String(balance??'').trim()===''||!Number.isFinite(amount)||Math.abs(amount)>1e11||Math.abs(amount*100-Math.round(amount*100))>1e-5||(kind==='investment'&&amount<0)||!Number.isFinite(date.getTime())||date.getTime()>new Date(now).getTime()+60000||typeof source!=='string'||!source.trim()||source.length>300)throw Object.assign(new Error('Confira instituição, conta/aplicação, saldo com centavos e data do extrato (não futura).'),{status:400});
 return {bank:bank.trim(),account,kind,balance:amount,as_of:date.toISOString(),source};
}
export async function listBalances(sql){
 await ensureBalances(sql);
 const {rows}=await sql`SELECT DISTINCT ON (s.bank,s.account,s.kind)
  s.id,s.bank,s.account,s.kind,s.balance,s.as_of,s.source,(e.bank IS NOT NULL) AS excluded
  FROM bank_balance_snapshots s LEFT JOIN bank_balance_exclusions e USING (bank,account,kind)
  ORDER BY s.bank,s.account,s.kind,s.as_of DESC,s.id DESC`;
 const positions=rows.map(({excluded,...position})=>({excluded,position:{...position,balance:Number(position.balance)}}));
 const balances=positions.filter(e=>!e.excluded).map(e=>e.position);
 const excluded_balances=positions.filter(e=>e.excluded).map(e=>e.position);
 const checking=balances.filter(e=>e.kind==='checking'),investments=balances.filter(e=>e.kind==='investment');
 const sum=rows=>rows.reduce((n,e)=>n+Math.round(e.balance*100),0)/100;
 return {balances,excluded_balances,checking_total:checking.length?sum(checking):null,investment_total:investments.length?sum(investments):null,total:balances.length?sum(balances):null};
}
export async function recordBalance(input,sql){
 const e=balanceInput(input);await ensureBalances(sql);
 const saved=await sql`INSERT INTO bank_balance_snapshots(bank,account,kind,balance,as_of,source) VALUES(${e.bank},${e.account},${e.kind},${e.balance},${e.as_of},${e.source}) ON CONFLICT (bank,account,kind,as_of,balance) WHERE source IS NOT NULL DO NOTHING RETURNING id`;
 const row=(await sql`SELECT id,bank,account,kind,balance,as_of,source FROM bank_balance_snapshots WHERE bank=${e.bank} AND account=${e.account} AND kind=${e.kind} AND as_of=${e.as_of} AND balance=${e.balance} ORDER BY id DESC LIMIT 1`).rows[0];
 if(!row||Number(row.balance)!==e.balance||new Date(row.as_of).toISOString()!==e.as_of)throw new Error('Não foi possível conferir o saldo salvo.');
 const snapshot={...row,balance:Number(row.balance)};
 const latest=await listBalances(sql);
 return {saved:true,verified:true,duplicate:!saved.rows.length,snapshot,is_latest:latest.balances.some(b=>String(b.id)===String(row.id)),...latest};
}

export async function setBalanceExcluded(input,sql){
 const {id,excluded}=input||{};
 if(typeof id!=='string'||!/^\d{1,19}$/.test(id)||BigInt(id)>9223372036854775807n||typeof excluded!=='boolean'){
  throw Object.assign(new Error('Informe a posição de saldo e a ação desejada.'),{status:400});
 }
 const before=await listBalances(sql);
 if(![...before.balances,...before.excluded_balances].some(b=>String(b.id)===id)){
  throw Object.assign(new Error('A posição mudou. Atualize os saldos e tente novamente.'),{status:409});
 }
 if(excluded){
  await sql`INSERT INTO bank_balance_exclusions (bank,account,kind)
   SELECT bank,account,kind FROM bank_balance_snapshots WHERE id=${id}
   ON CONFLICT DO NOTHING`;
 }else{
  await sql`DELETE FROM bank_balance_exclusions e USING bank_balance_snapshots s
   WHERE s.id=${id} AND (e.bank,e.account,e.kind)=(s.bank,s.account,s.kind)`;
 }
 return listBalances(sql);
}
