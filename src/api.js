import { travelPayload } from './travel.js';
export async function request(path, options = {}) {
  const response = await fetch(`/api/${path}`, { credentials:'same-origin', ...options, headers:{ 'Content-Type':'application/json', ...options.headers } });
  let data;
  try { data = await response.json(); } catch { throw new Error('Resposta inválida do servidor.'); }
  if (!response.ok) throw new Error(data.error || 'Não foi possível salvar. Tente novamente.');
  return data;
}
const send = (path, method, body) => request(path, { method, body:JSON.stringify(body) });
export const api = {
  getEntries:(month,year)=>request(`entries?month=${month}&year=${year}`),
  getAllEntries:()=>request('entries?all=true'),
  addEntry:e=>send('entries','POST',travelPayload(e)),
  updateEntry:(id,e)=>send(`entries?id=${id}`,'PUT',travelPayload(e)),
  deleteEntry:id=>request(`entries?id=${id}`,{method:'DELETE'}),
  bulkInsert:entries=>send('entries','PATCH',{entries:entries.map(travelPayload)}),
  editRecurring:(id,entry)=>send('recurring','POST',{action:'edit',id,entry:travelPayload(entry)}),
  getTrips:()=>request('trips'),
  addTrip:trip=>send('trips','POST',trip),
  deleteTrip:id=>request(`trips?id=${encodeURIComponent(id)}`,{method:'DELETE'}),
  stopRecurring:id=>send('recurring','POST',{action:'stop',id}),
  applyRecurring:(month,year)=>send('recurring','POST',{month,year}),
  getBudgets:()=>request('budgets'),
  setBudget:(category,monthly_limit)=>send('budgets','POST',{category,monthly_limit}),
  deleteBudget:category=>request(`budgets?category=${encodeURIComponent(category)}`,{method:'DELETE'}),
};

