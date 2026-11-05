import React, {useState} from 'react';
import {projectDailyCash} from './daily-cash-flow.js';
import {paymentMethod} from './monthly-views.js';
import {invoiceDetails} from '../lib/card.js';

const dateLabel = date => date.split('-').reverse().join('/');
const money = cents => (cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const centsOf = value => {
  const text=String(value).trim();
  return /^-?\d+(?:[,.]\d{1,2})?$/.test(text) ? Math.round(Number(text.replace(',','.'))*100) : NaN;
};

export function DailyCashFlow({balances, commitments, monthEnd, styles}) {
  const [openingDate,setOpeningDate] = useState(null);
  const [openingAmount,setOpeningAmount] = useState(null);
  const [planned,setPlanned] = useState([]);
  const [draft,setDraft] = useState({date:'',type:'income',description:'',amount:''});
  const positions=balances.filter(position=>position.kind==='checking');
  const dates=new Set(positions.map(position=>new Intl.DateTimeFormat('en-CA',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
  }).format(new Date(position.as_of))));
  const [reference]=dates;
  const firstDay=monthEnd.slice(0,7)+'-01';
  const previousDay=new Date(Date.parse(firstDay)-86400000).toISOString().slice(0,10);
  const usablePosition=dates.size===1 && reference>=previousDay;
  const baseDate=openingDate ?? (usablePosition?reference:'');
  const baseAmount=openingAmount ?? (usablePosition?(positions.reduce((sum,position)=>sum+Math.round(position.balance*100),0)/100).toFixed(2):'');
  const recurring=commitments.filter(item=>
    item.type==='expense' && (item.recurring || item.bank==='Recorrência') &&
    !item.confirmed && !invoiceDetails(item) && !['credit','ticket'].includes(paymentMethod(item))
  ).map(item=>({date:item.date.slice(0,10),type:'expense',description:item.description,cents:Math.round(item.amount*100),projected:true}));
  const baseValid=baseDate>=previousDay && baseDate<monthEnd && Number.isSafeInteger(centsOf(baseAmount));
  const rows=baseValid ? projectDailyCash({openingDate:baseDate,openingCents:centsOf(baseAmount),monthEnd,movements:[...recurring,...planned]}) : [];
  const lowest=rows.reduce((low,row)=>!low||row.balance<low.balance?row:low,null);
  const firstDeficit=rows.find(row=>row.balance<0);
  const amount=centsOf(draft.amount);
  const canAdd=draft.date>baseDate && draft.date>=firstDay && draft.date<=monthEnd && draft.description.trim() && Number.isSafeInteger(amount) && amount>0;
  function add(event) {
    event.preventDefault();
    if(!canAdd)return;
    setPlanned(items=>[...items,{...draft,description:draft.description.trim(),cents:amount}]);
    setDraft(current=>({...current,description:'',amount:''}));
  }
  return <details style={{...styles.card,marginBottom:16}}>
    <summary style={{cursor:'pointer',color:'#75b8ff'}}>Fluxo de caixa diário</summary>
    <p style={{color:'#b6c4d6'}}>Projeção até {dateLabel(monthEnd)}. A data-base representa o saldo ao fim do dia. A previsão começa no dia seguinte.</p>
    <div style={{display:'flex',flexWrap:'wrap',gap:12}}>
      <label>Data-base<input style={styles.input} type="date" min={previousDay} max={monthEnd} value={baseDate} onChange={e=>setOpeningDate(e.target.value)}/></label>
      <label>Saldo disponível em contas<input style={styles.input} inputMode="decimal" value={baseAmount} onChange={e=>setOpeningAmount(e.target.value)}/></label>
    </div>
    {!usablePosition && <p>Informe uma posição de saldo com data única para iniciar a projeção.</p>}
    <p style={{color:'#b6c4d6'}}>O app inclui as recorrências fora do cartão ainda em aberto. Adicione os aluguéis a receber e o valor a pagar da fatura nas datas previstas. As simulações são temporárias.</p>
    <form onSubmit={add} style={{display:'flex',alignItems:'end',flexWrap:'wrap',gap:12,marginBottom:16}}>
      <label>Data<input style={styles.input} type="date" min={firstDay} max={monthEnd} value={draft.date} onChange={e=>setDraft({...draft,date:e.target.value})}/></label>
      <label>Movimento<select style={styles.input} value={draft.type} onChange={e=>setDraft({...draft,type:e.target.value})}><option value="income">Entrada</option><option value="expense">Saída</option></select></label>
      <label>Descrição<input style={styles.input} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
      <label>Valor<input style={styles.input} inputMode="decimal" value={draft.amount} onChange={e=>setDraft({...draft,amount:e.target.value})}/></label>
      <button type="submit" disabled={!canAdd} style={styles.btn(false)}>Adicionar previsão</button>
    </form>
    {planned.map((item,index)=><p key={index}>{dateLabel(item.date)} · {item.description} · {item.type==='income'?'+':'−'}{money(item.cents)} <button type="button" style={styles.btn(false)} onClick={()=>setPlanned(items=>items.filter((_,i)=>i!==index))}>Retirar da simulação</button></p>)}
    {lowest && <>
      <p><strong>Menor saldo projetado</strong> · {money(lowest.balance)} em {dateLabel(lowest.day)}{firstDeficit && <> · Primeiro dia negativo em {dateLabel(firstDeficit.day)}</>}</p>
      <div style={{overflowX:'auto',marginTop:12}}>
        <table style={{width:'100%',textAlign:'left',borderCollapse:'collapse'}}>
          <thead><tr><th>Dia</th><th>Movimentos previstos</th><th>Entradas</th><th>Saídas</th><th>Saldo ao fim do dia</th></tr></thead>
          <tbody>{rows.map(row=><tr key={row.day} style={{borderTop:'1px solid #35465c'}}>
            <td>{dateLabel(row.day)}</td>
            <td>{row.items.map((item,index)=><div key={index}>{item.description} · {money(item.cents)}{item.projected?' · Recorrência':''}</div>)}</td>
            <td>{money(row.incoming)}</td><td>{money(row.outgoing)}</td><td style={{color:row.balance<0?'#ff929b':undefined}}>{money(row.balance)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
  </details>;
}
