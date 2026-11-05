export function projectDailyCash({openingDate, openingCents, monthEnd, movements}) {
  if (!openingDate || openingDate >= monthEnd || !Number.isSafeInteger(openingCents)) return [];
  const start = new Date(openingDate+'T12:00:00Z');
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0,10)!==openingDate) return [];
  const firstDay = monthEnd.slice(0,7)+'-01';
  const rows = [];
  let balance = openingCents;
  for (let date = new Date(firstDay+'T12:00:00Z'); date.toISOString().slice(0,10)<=monthEnd; date.setUTCDate(date.getUTCDate()+1)) {
    const day = date.toISOString().slice(0,10);
    if (day<=openingDate) continue;
    const items = movements.filter(item=>item.date===day);
    const incoming = items.filter(item=>item.type==='income').reduce((sum,item)=>sum+item.cents,0);
    const outgoing = items.filter(item=>item.type==='expense').reduce((sum,item)=>sum+item.cents,0);
    balance += incoming-outgoing;
    rows.push({day,items,incoming,outgoing,balance});
  }
  return rows;
}
