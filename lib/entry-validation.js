const TRAVEL_PREFIX = '@finance-travel:';

export function hasStructuredTravel(e) {
  const notes=typeof e?.notes==='string' ? e.notes : '';
  if (!notes.startsWith(TRAVEL_PREFIX)) return false;
  const end=notes.indexOf('\n');
  try { const m=JSON.parse(notes.slice(TRAVEL_PREFIX.length,end<0?undefined:end)); return typeof m.destination==='string' && !!m.destination.trim(); } catch { return false; }
}

export function mentionsTravel(e) {
  return /(?:^|[—–\-\s])viagem(?:\s|$)/i.test(String(e?.description||'')) || String(e?.category||'').trim().toLowerCase()==='viagem';
}

export function travelGuard(e) {
  return !mentionsTravel(e) || hasStructuredTravel(e);
}

export function validEntry(e) {
 const amount=Number(e?.amount),date=e?.date;
 return travelGuard(e) && ['income','expense'].includes(e?.type) && typeof e.category==='string' && !!e.category.trim() && e.category.length<=60 && typeof e.description==='string' && !!e.description.trim() && Number.isFinite(amount) && Math.round(amount*100)>0 && amount<=9999999999.99 && typeof date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date+'T12:00:00Z')) && new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;
}
const dateText = date => date instanceof Date ? date.toISOString().slice(0,10) : String(date).slice(0,10);
export function recurringDate(date,year,month) {
 const day=Math.min(Number(dateText(date).slice(8,10)),new Date(Date.UTC(year,month+1,0)).getUTCDate());
 return `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
export function recurringPayload(rows,year,month) {
 const first=`${year}-${String(month+1).padStart(2,'0')}-01`;
 return rows.filter(e=>e.recurring && e.bank!=='Recorrência' && dateText(e.date)<first).map(e=>({type:e.type,category:e.category,description:e.description,amount:Number(e.amount),date:recurringDate(e.date,year,month),notes:e.notes || null,source_id:`${e.id}:${first}`,bank:'Recorrência',recurring:false,confirmed:false}));
}
