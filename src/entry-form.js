import { paymentMethod } from './monthly-views.js';
import { normalizeFoodCategory } from './food-categories.js';
import { travelDetails } from './travel.js';
export function normalizeEntryForm(initial, today) {
  const travel = travelDetails(initial);
  return initial ? {...initial,payment_method:paymentMethod(initial),category:normalizeFoodCategory(initial.category,initial.description),...(travel.destination ? travel : {}),date:String(initial.date || '').slice(0,10),amount:String(initial.amount ?? ''),recurring:!!initial.recurring,...(initial.recurrence_end_date ? {recurrence_end_date:String(initial.recurrence_end_date).slice(0,10)} : {})} : {type:'expense',category:'Alimentação — supermercado',description:'',amount:'',date:today,recurring:false,payment_method:'unknown'};
}



// Number of monthly payments, including the original, up to the inclusive end date.
export function recurrenceCount(start,end) {
 if(!start || !end || end<start)return 0;
 const [y,m,d]=start.slice(0,10).split('-').map(Number),[ey,em]=end.slice(0,10).split('-').map(Number);
 const day=Math.min(d,new Date(Date.UTC(ey,em,0)).getUTCDate());
 const last=`${ey}-${String(em).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
 return (ey-y)*12+em-m+1-(last>end ? 1 : 0);
}
