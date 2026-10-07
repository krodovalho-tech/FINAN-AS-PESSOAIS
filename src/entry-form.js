export function normalizeEntryForm(initial, today) {
  return initial ? {...initial,date:String(initial.date || '').slice(0,10),amount:String(initial.amount ?? ''),recurring:!!initial.recurring} : {type:'expense',category:'Alimentação',description:'',amount:'',date:today,recurring:false};
}
