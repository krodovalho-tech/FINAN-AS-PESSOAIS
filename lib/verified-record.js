import { installmentSchedule, cardDetails, dashboardEntries, purchaseCosts } from './card.js';
import { travelPayload, travelDetails, destinationFromDescription, normalizeDestination, travelCategory } from '../src/travel.js';

const cents = value => Math.round(Number(value) * 100);
const day = value => value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
const normalize = rows => rows.map(e => ({...e,date:day(e.date),amount:Number(e.amount)}));
export class RecordError extends Error { constructor(message,status=409) { super(message); this.status=status; } }
const fail = message => { throw new RecordError(message); };
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10) === value;
}
export function recordPlan(input, connectionId, purchase=false) {
  const allowed=['type','amount','date','description','category','request_id','payment_account','destination',...(purchase?['installment_count','purchase_date']:[])];
  const validText=(v,max)=>typeof v==='string' && !!v.trim() && v.length<=max;
  if (!input || Object.keys(input).some(k=>!allowed.includes(k)) || !['expense','income'].includes(input.type) || !validText(input.description,1000) || !validText(input.category,60) || typeof input.amount!=='number' || !Number.isFinite(input.amount) || input.amount<=0 || input.amount>9999999999.99 || Math.abs(input.amount*100-cents(input.amount))>0.0001 || !validDate(input.date) || !/^[A-Za-z0-9_-]{8,100}$/.test(input.request_id || '') || (input.payment_account!==undefined && !validText(input.payment_account,100)) || (input.destination!==undefined && !validText(input.destination,160))) throw new RecordError('Confira valor com até dois centavos, data, categoria, descrição e identificador.',400);
  if (/parcela\s*\d+\s*\/\s*\d+/i.test(input.description) || (!purchase && /\bparcelad[oa]\b|\b\d+\s*(?:x|vezes)\b/i.test(input.description))) throw new RecordError('Envie a compra inteira em registrar_compra_parcelada, sem parcelas individuais na descrição.',400);
  const count=purchase?input.installment_count:1;
  const purchaseDate=input.purchase_date || input.date;
  if (purchase && (input.type!=='expense' || !Number.isInteger(count) || count<1 || count>60 || cents(input.amount)<count || !validDate(purchaseDate) || purchaseDate>input.date)) throw new RecordError('Confira quantidade de parcelas (1 a 60), data da compra e data da primeira parcela.',400);
  const destination=normalizeDestination(input.destination || destinationFromDescription(input.description));
  if (!destination && (/\bviagem\b/i.test(input.description) || /^viagem$/i.test(input.category))) throw new RecordError('Informe o destino da viagem.',400);
  const id=`verified:${connectionId}:${input.request_id}`;
  const base=travelPayload({type:input.type,amount:input.amount,date:input.date,description:input.description,category:input.category,destination,notes:JSON.stringify({origin:'assistant',payment_account:input.payment_account || 'Não informado',verification_version:1})});
  const entries=purchase?installmentSchedule({...base,purchase_date:purchaseDate},count,input.payment_account || '',id):[{...base,source_id:id}];
  return {id,purchase,total_cents:cents(input.amount),count,purchase_date:purchaseDate,destination,entries:entries.map(e=>({...e,bank:'Assistente',confirmed:false}))};
}
const add=(map,key,value)=>map[key]=(map[key]||0)+value;
const key=parts=>JSON.stringify(parts);
function addMonthly(map,view,e) {
  const month=e.date.slice(0,7), value=cents(e.amount);
  add(map,key([view,month,e.type]),value);
  add(map,key([view,month,e.type,e.category]),value);
}
function addTrip(map,e) {
  const destination=travelDetails(e).destination;
  if (e.type!=='expense' || !destination) return;
  add(map,key(['trip',destination]),cents(e.amount));
  add(map,key(['trip',destination,travelCategory(e)]),cents(e.amount));
}
// These are the same projections used by the dashboard and TripsModal.
export function financialMetrics(rows) {
  const map=Object.create(null), entries=normalize(rows);
  for (const view of ['purchases','installments']) for(const e of dashboardEntries(entries,view)) addMonthly(map,view,e);
  for(const e of purchaseCosts(entries)) addTrip(map,e);
  return map;
}
function expectedMetrics(plan) {
  const map=Object.create(null);
  for(const e of plan.entries) addMonthly(map,'installments',e);
  const whole={...plan.entries[0],date:plan.purchase?plan.purchase_date:plan.entries[0].date,amount:plan.total_cents/100};
  addMonthly(map,'purchases',whole);addTrip(map,whole);
  return map;
}
function verifyRows(plan, rows) {
  if(rows.length!==plan.count) fail('Conferência falhou: quantidade de parcelas divergente.');
  let total=0;
  for(const expected of plan.entries) {
    const saved=rows.find(r=>r.source_id===expected.source_id);
    if(!saved || ['type','category','description','date','bank'].some(k=>saved[k]!==expected[k]) || cents(saved.amount)!==cents(expected.amount) || saved.notes!==expected.notes) fail('Conferência falhou: o registro salvo diverge da solicitação.');
    total+=cents(saved.amount);
    if(plan.purchase) {
      const c=cardDetails(saved), exp=cardDetails(expected);
      if(!c || c.purchase_id!==plan.id || c.installment!==exp.installment || c.count!==plan.count || cents(c.total)!==plan.total_cents || c.purchase_date!==plan.purchase_date) fail('Conferência falhou: vínculo ou total da compra divergente.');
    }
  }
  if(total!==plan.total_cents) fail('Conferência falhou: soma das parcelas diferente do valor informado.');
}
export function verificationReceipt(plan,before,after,saved,duplicate=false) {
  verifyRows(plan,saved);
  const b=financialMetrics(before),a=financialMetrics(after),expected=expectedMetrics(plan);
  for(const k of new Set([...Object.keys(b),...Object.keys(a),...Object.keys(expected)])) {
    if((a[k]||0)-(b[k]||0)!==(duplicate?0:(expected[k]||0))) fail('Conferência falhou: impacto no mês, categoria ou viagem divergente.');
  }
  // Also verify the stored purchase itself when an idempotent retry has no delta.
  const actualOwn=financialMetrics(saved);
  for(const k of new Set([...Object.keys(actualOwn),...Object.keys(expected)])) if((actualOwn[k]||0)!==(expected[k]||0)) fail('Conferência falhou: total da compra repetido ou incompleto.');
  return {status:'passed',version:1,checked_at:new Date().toISOString(),informed_amount:plan.total_cents/100,installment_sum:saved.reduce((s,e)=>s+cents(e.amount),0)/100,installment_count:plan.count,impact:Object.keys(expected).map(k=>({scope:JSON.parse(k),before:(b[k]||0)/100,after:(a[k]||0)/100,delta:((a[k]||0)-(b[k]||0))/100})),reconciliation:'Pendente de conferência com a fatura ou extrato'};
}
export async function recordVerified(input,connectionId,purchase,pool) {
  const plan=recordPlan(input,connectionId,purchase); // Validate before opening a transaction.
  const client=await pool.connect();
  let committed=false;
  try {
    await client.sql`BEGIN`;
    await client.sql`SET LOCAL lock_timeout = '5s'`;
    // Serialize against all writers, including UI edits and statement imports.
    await client.sql`LOCK TABLE entries IN SHARE ROW EXCLUSIVE MODE`;
    const before=normalize((await client.sql`SELECT * FROM entries ORDER BY id`).rows);
    const sources=new Set(plan.entries.map(e=>e.source_id));
    const previous=before.filter(e=>e.bank==='Assistente' && (e.source_id===plan.id || String(e.source_id).startsWith(plan.id+':')));
    let after=before,saved=previous;
    if(!previous.length) {
      for(const e of plan.entries) await client.sql`INSERT INTO entries (type,category,description,amount,date,notes,source_id,bank,confirmed,recurring) VALUES (${e.type},${e.category},${e.description},${e.amount},${e.date},${e.notes},${e.source_id},'Assistente',FALSE,FALSE)`;
      after=normalize((await client.sql`SELECT * FROM entries ORDER BY id`).rows);
      saved=after.filter(e=>e.bank==='Assistente' && sources.has(e.source_id));
    }
    const verification=verificationReceipt(plan,before,after,saved,previous.length>0);
    await client.sql`COMMIT`;committed=true;
    return {saved:true,verified:true,duplicate:previous.length>0,purchase_id:plan.purchase?plan.id:null,entries:saved,...(saved.length===1?{entry:saved[0]}:{}),verification};
  } catch(err) {
    if(!committed) { try { await client.sql`ROLLBACK`; } catch {} }
    throw err;
  } finally { client.release(); }
}

// Read-only audit for a saved purchase; never creates test transactions.
export function auditPurchase(rows, ids, expectedAmount, destination) {
  if(!Array.isArray(ids) || !ids.length || ids.length>60 || new Set(ids).size!==ids.length || ids.some(id=>!Number.isSafeInteger(id)||id<1) || typeof expectedAmount!=='number' || !Number.isFinite(expectedAmount) || cents(expectedAmount)<=0 || Math.abs(expectedAmount*100-cents(expectedAmount))>0.0001) throw new RecordError('Informe IDs distintos e valor esperado válido.',400);
  const all=normalize(rows),saved=all.filter(e=>ids.includes(e.id));
  if(saved.length!==ids.length) fail('Compra incompleta: registro não encontrado.');
  saved.sort((a,b)=>(cardDetails(a)?.installment||0)-(cardDetails(b)?.installment||0));
  const card=cardDetails(saved[0]);
  if(!card || card.count!==ids.length || saved.some((e,i)=>{const c=cardDetails(e);return !c || c.purchase_id!==card.purchase_id || c.installment!==i+1 || c.count!==ids.length || cents(c.total)!==cents(expectedAmount) || c.purchase_date!==card.purchase_date;})) fail('Conferência falhou: compra incompleta, repetida ou metadados divergentes.');
  if(all.filter(e=>cardDetails(e)?.purchase_id===card.purchase_id).length!==ids.length) fail('Conferência falhou: existem parcelas adicionais para esta compra.');
  if(destination && saved.some(e=>travelDetails(e).destination!==normalizeDestination(destination))) fail('Conferência falhou: destino divergente.');
  const plan={id:card.purchase_id,purchase:true,count:ids.length,total_cents:cents(expectedAmount),purchase_date:card.purchase_date,entries:saved};
  const verification=verificationReceipt(plan,all.filter(e=>!ids.includes(e.id)),all,saved);
  return {verified:true,entry_ids:ids,verification:{...verification,mode:'read_only_audit',impact_meaning:'Contribuição da compra aos totais atuais; nenhuma alteração realizada.'}};
}

export function monthlySummary(rows,year,month,mode='installments') {
  const prefix=`${year}-${String(month).padStart(2,'0')}`;
  const entries=dashboardEntries(normalize(rows),mode).filter(e=>e.date.slice(0,7)===prefix);
  let income=0,expense=0;const categories=Object.create(null);
  for(const e of entries) {if(e.type==='income')income+=cents(e.amount);else{expense+=cents(e.amount);add(categories,e.category,cents(e.amount));}}
  return {year,month,mode,count:entries.length,income:income/100,expense:expense/100,balance:(income-expense)/100,expensesByCategory:Object.entries(categories).map(([category,amount])=>({category,amount:amount/100})).sort((a,b)=>b.amount-a.amount),largestExpenses:entries.filter(e=>e.type==='expense').sort((a,b)=>Number(b.amount)-Number(a.amount)).slice(0,5)};
}
