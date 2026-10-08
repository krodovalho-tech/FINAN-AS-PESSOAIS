import { travelDetails } from './travel.js';
export function normalizeEntryForm(initial, today) {
  const travel = travelDetails(initial);
  return initial ? {...initial,...(travel.destination ? travel : {}),date:String(initial.date || '').slice(0,10),amount:String(initial.amount ?? ''),recurring:!!initial.recurring} : {type:'expense',category:'Alimentação',description:'',amount:'',date:today,recurring:false};
}

