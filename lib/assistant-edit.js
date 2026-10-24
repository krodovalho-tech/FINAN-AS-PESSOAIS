import { RecordError } from './verified-record.js';
import { cardDetails } from './card.js';
import { validEntry } from './entry-validation.js';
import { normalizeFoodCategory } from '../src/food-categories.js';
const day=v=>v==null?null:(v instanceof Date?v.toISOString():String(v)).slice(0,10);
const normalize=e=>({...e,date:day(e.date),amount:Number(e.amount),recurring:!!e.recurring,recurrence_end_date:day(e.recurrence_end_date)});
const baseFields=['type','category','description','amount','date'];
const recurrenceFields=['recurring','recurrence_end_date'];
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
export async function editVerified(input,pool){
 const {id,expected,changes}=input || {};
 if(!Number.isSafeInteger(id)||id<1||!expected||!changes||typeof changes!=='object'||Array.isArray(changes)||!Object.keys(changes).length||Object.keys(changes).some(k=>![...baseFields,...recurrenceFields].includes(k)))throw new RecordError('Confira o identificador, o snapshot e os campos a alterar.',400);
 const editsRecurrence=recurrenceFields.some(k=>own(changes,k));
 if(editsRecurrence && (typeof expected.recurring!=='boolean' || !own(expected,'recurrence_end_date')))throw new RecordError('Consulte novamente o lançamento para obter recorrência e data final atuais.',400);
 if((own(changes,'recurring')&&typeof changes.recurring!=='boolean') || (own(changes,'recurrence_end_date')&&changes.recurrence_end_date!==null&&typeof changes.recurrence_end_date!=='string'))throw new RecordError('Recorrência ou data final inválida.',400);
 const client=await pool.connect();
 try{
  await client.sql`BEGIN`;
  await client.sql`SET LOCAL lock_timeout = '5s'`;
  await client.sql`LOCK TABLE entries IN SHARE ROW EXCLUSIVE MODE`;
  const row=(await client.sql`SELECT * FROM entries WHERE id=${id} FOR UPDATE`).rows[0];
  if(!row)throw new RecordError('Lançamento não encontrado.',404);
  const before=normalize(row),next={...before,...changes};
  next.amount=Number(next.amount);
  if(changes.recurring===false)next.recurrence_end_date=null;
  if(!next.recurring&&changes.recurrence_end_date!=null)throw new RecordError('Ative a recorrência antes de informar sua data final.',400);
  if(!validEntry(next) || next.description.length>1000)throw new RecordError('Confira valor positivo, categoria, descrição e datas válidas.',400);
  if(next.recurring && editsRecurrence && (before.bank==='Recorrência'||cardDetails(before)))throw new RecordError('Edite o lançamento original; parcelas de cartão não podem gerar recorrência.',400);
  const fields=[...baseFields,...(editsRecurrence?recurrenceFields:[])];
  const same=(a,b)=>fields.every(k=>k==='amount'?Number(a[k])===Number(b[k]):k==='date'||k==='recurrence_end_date'?day(a[k])===day(b[k]):a[k]===b[k]);
  if(!same(before,expected)){
   if(same(before,next)&&Object.keys(changes).every(k=>k==='amount'?Number(before[k])===Number(changes[k]):k==='recurrence_end_date'?day(before[k])===day(changes[k]):before[k]===changes[k])){
    await client.sql`COMMIT`;return {saved:true,verified:true,unchanged:true,entry:before};
   }
   throw new RecordError('O lançamento mudou desde a consulta. Consulte novamente antes de editar.');
  }
  if(next.type==='expense')next.category=normalizeFoodCategory(next.category,next.description);
  await client.sql`UPDATE entries SET type=${next.type},category=${next.category},description=${next.description},amount=${next.amount},date=${next.date},recurring=${next.recurring},recurrence_end_date=${next.recurrence_end_date || null} WHERE id=${id}`;
  let removed=0;
  if(editsRecurrence && before.bank!=='Recorrência'){
   const prefix=`${id}:%`;
   const deleted=await client.sql`DELETE FROM entries WHERE bank='Recorrência' AND source_id LIKE ${prefix} AND confirmed IS NOT TRUE AND (${!next.recurring} OR (${next.recurrence_end_date || null}::date IS NOT NULL AND date>${next.recurrence_end_date || null}::date)) RETURNING source_id`;
   removed=deleted.rows.length;
   for(const e of deleted.rows)await client.sql`DELETE FROM recurrence_occurrences WHERE source_id=${e.source_id}`;
   if(!before.recurring && next.recurring)await client.sql`DELETE FROM recurrence_occurrences o WHERE o.source_id LIKE ${prefix} AND split_part(o.source_id,':',2)>to_char(${next.date}::date,'YYYY-MM-01') AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.bank='Recorrência' AND e.source_id=o.source_id)`;
  }
  const after=normalize((await client.sql`SELECT * FROM entries WHERE id=${id}`).rows[0]);
  if(!same(after,next)||after.recurring!==next.recurring||day(after.recurrence_end_date)!==day(next.recurrence_end_date)||after.bank!==before.bank||after.source_id!==before.source_id||after.notes!==before.notes||JSON.stringify(after.reconciliation)!==JSON.stringify(before.reconciliation)||after.confirmed!==before.confirmed)throw new RecordError('A conferência da alteração falhou; nenhuma alteração confirmada.');
  await client.sql`COMMIT`;
  return {saved:true,verified:true,entry:after,verification:{recurring:after.recurring,recurrence_end_date:after.recurrence_end_date,removed_forecasts:removed}};
 }catch(error){try{await client.sql`ROLLBACK`;}catch{}throw error;}finally{client.release();}
}
