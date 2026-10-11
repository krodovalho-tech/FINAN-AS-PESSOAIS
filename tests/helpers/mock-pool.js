export function mockPool(initial=[], mutate=null) {
 let state=structuredClone(initial),backup;let inserts=0;const queries=[];
 const client={release(){queries.push('RELEASE');},async sql(strings,...v){
  const q=strings.join('');queries.push(q);
  if(q==='BEGIN')backup=structuredClone(state);
  if(q==='ROLLBACK')state=backup;
  if(q.startsWith('SELECT *'))return {rows:structuredClone(state)};
  if(q.startsWith('INSERT')){inserts++;let row={id:state.length+1,type:v[0],category:v[1],description:v[2],amount:v[3],date:v[4],notes:v[5],source_id:v[6],bank:'Assistente',confirmed:false};if(mutate)row=mutate(row,inserts);state.push(row);}
  return {rows:[]};
 }};
 return {connect:async()=>client,state:()=>structuredClone(state),queries};
}
