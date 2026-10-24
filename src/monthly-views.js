import {cardDetails,isCardPayment,purchaseCosts} from '../lib/card.js';
import {recurringPayload} from '../lib/entry-validation.js';
const PAYMENT_PREFIX='@finance-payment:';
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export const PAYMENT_METHODS=['unknown','credit','debit','pix','cash','ticket','bank'];
export function paymentMethod(e){
 if(cardDetails(e))return 'credit';
 const lines=String(e?.notes||'').split('\n');
 const tagged=lines.find(l=>l.startsWith(PAYMENT_PREFIX));
 if(tagged){try{const method=JSON.parse(tagged.slice(PAYMENT_PREFIX.length)).payment_method;if(PAYMENT_METHODS.includes(method))return method;}catch{}}
 let account='';
 for(const line of lines){try{
  const meta=JSON.parse(line.startsWith(PAYMENT_PREFIX)?line.slice(PAYMENT_PREFIX.length):line);
  const method=meta.payment_method;
  if(PAYMENT_METHODS.includes(method))return method;
  if(meta.payment_account)account=String(meta.payment_account);
 }catch{}}
 const text=normalize(e?.description),acc=normalize(account);
 // A bank-statement purchase on a Visa debit card is not proof of credit.
 if(/\bcredito\b/.test(text)&&!/(?:credito (?:de cobranca|recebimento|pix)|resgate)/.test(text) || /\bcredito\b/.test(acc))return 'credit';
 if(/\bpix\b/.test(text))return 'pix';
 if(/\bdebito\b/.test(text))return 'debit';
 if(/\bdinheiro\b/.test(text))return 'cash';
 if(/\bticket\b|vr beneficios|vale.alimentacao/.test(text))return 'ticket';
 if(/^(caixa|unicred)(?:\s|$)/.test(normalize(e?.bank)) || /^(caixa|unicred)(?:\s|$)/.test(acc))return 'bank';
 return 'unknown';
}
export function paymentPayload(entry){
 if(!Object.hasOwn(entry,'payment_method'))return entry;
 const {payment_method,...rest}=entry;
 if(!PAYMENT_METHODS.includes(payment_method))throw new Error('Forma de pagamento inválida.');
 return {...rest,notes:String(rest.notes||'').split('\n').filter(l=>!l.startsWith(PAYMENT_PREFIX)).join('\n')+'\n'+PAYMENT_PREFIX+JSON.stringify({payment_method})};
}
const monthKey=(year,month)=>`${year}-${String(month).padStart(2,'0')}`;
export function monthlyViews(entries,year,month,excluded=[]){
 const key=monthKey(year,month),inMonth=e=>String(e.date).slice(0,7)===key;
 const all=entries.filter(e=>!isCardPayment(e));
 const roots=all.filter(e=>e.recurring&&e.bank!=='Recorrência');
 const suppressed=new Set(excluded);
 const existing=new Set(all.filter(e=>e.bank==='Recorrência').map(e=>e.source_id));
 const forecasts=recurringPayload(roots,year,month-1).filter(e=>!existing.has(e.source_id)&&!suppressed.has(e.source_id)).map(e=>{
  const root=roots.find(r=>String(r.id)===e.source_id.split(':')[0]);
  return {...e,projection:true,root_id:root.id,payment_method:paymentMethod(root),notes:paymentPayload({...e,payment_method:paymentMethod(root)}).notes};
 });
 const scheduled=[...all,...forecasts].filter(inMonth);
 const purchased=all.filter(e=>e.bank!=='Recorrência'||e.confirmed===true).slice().sort((a,b)=>(cardDetails(a)?.installment || 0)-(cardDetails(b)?.installment || 0));
 const purchases=purchaseCosts(purchased).filter(inMonth);
 const cash=scheduled.filter(e=>e.type==='expense'&& !['credit','unknown'].includes(paymentMethod(e)));
 const commitments=scheduled.filter(e=>e.type==='expense'&&(paymentMethod(e)==='credit'||e.recurring||e.bank==='Recorrência'));
 const unknown=scheduled.filter(e=>e.type==='expense'&&paymentMethod(e)==='unknown');
 const income=scheduled.filter(e=>e.type==='income');
 return {purchases:[...income,...purchases],cash:[...income,...cash],commitments:[...income,...commitments],unknown,forecasts};
}
export function monthlyTotals(entries,year,month,excluded=[]){
 const views=monthlyViews(entries,year,month,excluded),sum=rows=>rows.filter(e=>e.type==='expense').reduce((n,e)=>n+Math.round(Number(e.amount)*100),0)/100;
 return {purchases:sum(views.purchases),cash:sum(views.cash),commitments:sum(views.commitments),unknown:sum(views.unknown),unknownCount:views.unknown.length};
}
