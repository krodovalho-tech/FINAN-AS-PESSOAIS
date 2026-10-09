import "./responsive.css";
import { api, request } from "./api.js";
import { travelDetails } from "./travel.js";
import { normalizeEntryForm } from "./entry-form.js";
import { normalizeImport } from "./import.js";
import { cardDetails, purchaseCosts, installmentSchedule, reconciliationCandidates, isCardPayment } from "../lib/card.js";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  PlusCircle, Trash2, TrendingUp, TrendingDown, DollarSign, BarChart3,
  X, Download, Upload, Pencil, CheckCircle, AlertTriangle, ArrowUpDown,
  Filter, Wallet, ChevronUp, ChevronDown, RotateCcw, FileText
} from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, LabelList
} from "recharts";

// ─── CONSTANTS ──────────────────────────────────────────────────────────────
const EXPENSE_CATEGORIES = [
  "Moradia","Alimentação","Alimentação — supermercado","Alimentação — bares, restaurantes e lanches","Rancho — ração de animais","Empréstimos concedidos","Locações — manutenção","Doações","Água, energia e gás","Telefone e internet","Transporte","Saúde","Educação",
  "Lazer","Viagem","Vestuário","Investimentos","Impostos","Cartão de Crédito","Outros"
];
const INCOME_CATEGORIES = [
  "Salário","Pró-labore","Dividendos","Aluguel","Freelance","Outros"
];
const ALL_CATEGORIES = [...new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES])];
const COLORS = ["#75b8ff","#7eb8c8","#c87e9a","#53d6a0","#c8c87e","#9a7ec8",
                 "#c8957e","#7ec8b8","#b8c87e","#7e9ac8","#ff929b"];
const MONTHS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

const fmt = (v) => Number(v).toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
const pct = (v, t) => t > 0 ? ((v / t) * 100).toFixed(1) : "0.0";
const today = new Date().toISOString().split("T")[0];

// ─── AUTO-CATEGORIZAÇÃO ─────────────────────────────────────────────────────
const CAT_RULES = [
  { keys:["supermercado","mercado","padaria","açougue","hortifruti","feira","carrefour","extra","assai","pão de açucar","atacadão"], cat:"Alimentação" },
  { keys:["farmácia","drogaria","hospital","clínica","laboratorio","droga","saude","plano de saude","dental"], cat:"Saúde" },
  { keys:["uber","99pop","ifood","rappi","taxi","gasolina","combustivel","posto","shell","ipiranga","estacionamento","pedágio","onibus","metro"], cat:"Transporte" },
  { keys:["escola","faculdade","mensalidade","curso","educação","universidade","colegio","livro","inglês","idioma"], cat:"Educação" },
  { keys:["netflix","spotify","amazon","prime","disney","hbo","gaming","cinema","teatro","show","ingresso","lazer"], cat:"Lazer" },
  { keys:["roupa","sapato","shopping","zara","renner","riachuelo","c&a","hering","moda","vestuário"], cat:"Vestuário" },
  { keys:["aluguel","condomínio","iptu","luz","água","energia","internet","telefone","celular","tim","claro","vivo","oi"], cat:"Moradia" },
  { keys:["imposto","irpf","darf","receita federal","simples nacional"], cat:"Impostos" },
  { keys:["investimento","cdb","tesouro","ação","fundo","poupança","aplicação","renda fixa","bolsa"], cat:"Investimentos" },
  { keys:["fatura","cartão","nubank","itau","bradesco","santander","banco inter","c6","xp"], cat:"Cartão de Crédito" },
];

function autoCategory(desc) {
  if (!desc) return "Outros";
  const norm = desc.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  for (const r of CAT_RULES) {
    if (r.keys.some(k => norm.includes(k.normalize("NFD").replace(/[\u0300-\u036f]/g,"")))) return r.cat;
  }
  return "Outros";
}

// ─── OFX PARSER ─────────────────────────────────────────────────────────────
function parseOFX(content) {
  const results = [];
  const re = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let m;
  const get = (block, tag) => { const r = new RegExp(`<${tag}>([^<\\n\\r]+)`,"i"); const x=r.exec(block); return x?x[1].trim():null; };
  while ((m = re.exec(content)) !== null) {
    const b = m[1];
    const dtRaw = get(b,"DTPOSTED")||get(b,"DTAVAIL")||"";
    const date = dtRaw.length>=8 ? `${dtRaw.slice(0,4)}-${dtRaw.slice(4,6)}-${dtRaw.slice(6,8)}` : today;
    const amount = parseFloat(get(b,"TRNAMT")||"0");
    const desc = (get(b,"MEMO")||get(b,"NAME")||get(b,"FITID")||"Sem descrição").replace(/&amp;/g,"&");
    results.push({ type: amount>=0?"income":"expense", amount:Math.abs(amount), date, description:desc, category:autoCategory(desc), recurring:false, source_id:get(b,"FITID"), bank:`${get(content,"ORG") || get(content,"BANKID") || "OFX"} • ${get(content,"ACCTID") || "conta não informada"}` });
  }
  return results;
}

// ─── CSV PARSER ─────────────────────────────────────────────────────────────
function parseCSV(content) {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase();
  const results = [];

  // Nubank: date,category,title,amount
  if (header.includes("title") || header.includes("amount")) {
    for (const line of lines.slice(1)) {
      const parts = line.split(",");
      if (parts.length < 3) continue;
      const [d, , desc, amt] = parts;
      const amount = parseFloat((amt||"0").replace(",","."));
      if (!amount || !d) continue;
      const [y,mo,da] = d.split("-");
      const date = `${y}-${mo?.padStart(2,"0")}-${da?.padStart(2,"0")}`;
      results.push({ type:"expense", amount:Math.abs(amount), date, description:desc?.trim()||"Importado", category:autoCategory(desc), recurring:false });
    }
    return results;
  }

  // Generic: date;description;amount or date,description,amount
  const sep = header.includes(";") ? ";" : ",";
  for (const line of lines.slice(1)) {
    const parts = line.split(sep);
    if (parts.length < 3) continue;
    const [d, desc, amtRaw] = parts;
    const amount = parseFloat((amtRaw||"0").replace(/[^\d,.-]/g,"").replace(",","."));
    if (!amount || !d) continue;
    const dateParts = d.trim().split(/[-\/]/);
    let date = today;
    if (dateParts.length === 3) {
      const [a,b,c] = dateParts;
      date = a.length===4 ? `${a}-${b.padStart(2,"0")}-${c.padStart(2,"0")}` : `${c}-${b.padStart(2,"0")}-${a.padStart(2,"0")}`;
    }
    results.push({ type:amount<0?"expense":"income", amount:Math.abs(amount), date, description:desc?.trim()||"Importado", category:autoCategory(desc), recurring:false });
  }
  return results;
}

// ─── API CLIENT ─────────────────────────────────────────────────────────────
// ─── STYLE HELPERS ──────────────────────────────────────────────────────────
const S = {
  input: { width:"100%", padding:"0.65rem 0.85rem", background:"#10151d", border:"1px solid #35465c", borderRadius:"8px", color:"#edf3fa", fontSize:"0.9rem", boxSizing:"border-box", marginTop:"0.3rem", fontFamily:"'Source Sans 3', sans-serif" },
  label: { fontSize:"0.7rem", color:"#aab9cb", textTransform:"uppercase", letterSpacing:"0.07em" },
  card: { background:"#19222e", border:"1px solid #35465c", borderRadius:"10px", padding:"1rem" },
  btn: (active) => ({ padding:"0.5rem 0.9rem", background:active?"rgba(117,184,255,0.15)":"#253244", border:`1px solid ${active?"#75b8ff":"#35465c"}`, borderRadius:"8px", color:active?"#75b8ff":"#aab9cb", cursor:"pointer", fontSize:"0.8rem", fontFamily:"'Source Sans 3',sans-serif" }),
};

// ─── MODAL ──────────────────────────────────────────────────────────────────
function Modal({ show, onClose, children, maxWidth=480 }) {
  useEffect(() => {
    const h = (e) => e.key==="Escape" && onClose();
    window.addEventListener("keydown",h);
    return () => window.removeEventListener("keydown",h);
  },[onClose]);
  if (!show) return null;
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem" }} onClick={onClose}>
      <div style={{ background:"#19222e",border:"1px solid #35465c",borderRadius:"14px",padding:"2rem",width:"100%",maxWidth,position:"relative",maxHeight:"90vh",overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
        <button onClick={onClose} style={{ position:"absolute",top:"1rem",right:"1rem",background:"none",border:"none",color:"#aab9cb",cursor:"pointer",padding:"4px" }}>
          <X size={20}/>
        </button>
        {children}
      </div>
    </div>
  );
}

// ─── TOAST ──────────────────────────────────────────────────────────────────
function Toast({ msg, onUndo }) {
  if (!msg) return null;
  return (
    <div style={{ position:"fixed",bottom:"1.5rem",right:"1.5rem",background:"#19222e",border:"1px solid #75b8ff",color:"#75b8ff",padding:"0.7rem 1.2rem",borderRadius:"8px",fontSize:"0.85rem",zIndex:200,display:"flex",alignItems:"center",gap:"0.8rem",boxShadow:"0 4px 20px rgba(0,0,0,0.5)" }}>
      {msg}
      {onUndo && <button onClick={onUndo} style={{ background:"none",border:"none",color:"#75b8ff",cursor:"pointer",textDecoration:"underline",fontSize:"0.82rem",display:"flex",alignItems:"center",gap:"4px" }}><RotateCcw size={13}/> Desfazer</button>}
    </div>
  );
}

// ─── CUSTOM TOOLTIP ─────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"#19222e",border:"1px solid #35465c",color:"#edf3fa",fontSize:"0.78rem",borderRadius:"6px",padding:"0.5rem 0.8rem" }}>
      {label && <p style={{ color:"#aab9cb",marginBottom:"4px",fontSize:"0.72rem" }}>{label}</p>}
      {payload.map((p,i) => <p key={i} style={{ color:p.color }}>{p.name}: {fmt(p.value)}</p>)}
    </div>
  );
};

// ─── PIE LABEL ──────────────────────────────────────────────────────────────
const PieLabel = ({ cx,cy,midAngle,outerRadius,name,percent }) => {
  const RAD = Math.PI/180;
  const r = outerRadius+22;
  const x = cx + r*Math.cos(-midAngle*RAD);
  const y = cy + r*Math.sin(-midAngle*RAD);
  if (percent < 0.04) return null;
  return <text x={x} y={y} fill="#aab9cb" textAnchor={x>cx?"start":"end"} dominantBaseline="central" fontSize="10">{`${(percent*100).toFixed(0)}%`}</text>;
};

function CategoryAxisTick({x,y,payload}) {
  const words=String(payload?.value || "").split(/\s+/); const lines=[]; let line="";
  for(const word of words){if(line && `${line} ${word}`.length>20){lines.push(line);line=word;}else line=line?`${line} ${word}`:word;}
  if(line)lines.push(line);
  return <text x={x-8} y={y} textAnchor="end" fill="#b7a48e" fontSize={10}>
    {lines.map((text,i)=><tspan key={i} x={x-8} dy={i===0?-(lines.length-1)*6:12}>{text}</tspan>)}
  </text>;
}

function DestinationField({value, onChange, trips}) {
  return <label style={S.label}>Viagem · destino (opcional)
    <input aria-label="Destino da viagem" list="travel-destinations" value={value || ""} maxLength={160} onChange={e=>onChange(e.target.value)} placeholder="Escolha ou digite um destino" style={S.input}/>
    <datalist id="travel-destinations">{trips.map(t=><option key={t.destination} value={t.destination}/>)}</datalist>
    <small style={{display:"block",marginTop:6,textTransform:"none",letterSpacing:0}}>Marca o gasto como viagem e mantém sua categoria. Apague o destino para remover a marcação.</small>
  </label>;
}

function TripsModal({show,onClose,trips,entries,onSave,saving}) {
  const [destination,setDestination]=useState(""),[startDate,setStartDate]=useState("");
  useEffect(()=>{if(show){setDestination("");setStartDate("");}},[show]);
  const totals={};
  purchaseCosts(entries).forEach(e=>{const d=travelDetails(e).destination;if(d)totals[d]=(totals[d]||0)+Number(e.amount);});
  const destinations=[...new Set([...trips.map(t=>t.destination),...Object.keys(totals)])];
  return <Modal show={show} onClose={onClose}>
    <h2 style={{color:"#75b8ff",fontSize:"1rem",marginBottom:12}}>Viagens e destinos</h2>
    <p style={{color:"#aab9cb",marginBottom:16}}>Cadastre o destino e selecione-o ao lançar ou editar uma despesa.</p>
    <form onSubmit={async e=>{e.preventDefault();if(await onSave({destination:destination.trim(),start_date:startDate || null})){setDestination("");setStartDate("");}}} style={{display:"grid",gap:12}}>
      <label style={S.label}>Destino<input aria-label="Novo destino" style={S.input} maxLength={160} placeholder="Cidade / UF" value={destination} onChange={e=>setDestination(e.target.value)} required/></label>
      <label style={S.label}>Partida (opcional)<input aria-label="Data de partida" type="date" style={S.input} value={startDate} onChange={e=>setStartDate(e.target.value)}/></label>
      <button style={S.btn(true)} disabled={saving || !destination.trim()} type="submit">{saving?"Salvando…":"Cadastrar destino"}</button>
    </form>
    <p style={{...S.label,marginTop:24,marginBottom:12}}>Custo total por destino · compras completas, incluindo parcelas futuras</p>
    {!destinations.length && <p style={{color:"#aab9cb"}}>Nenhum destino cadastrado.</p>}
    {destinations.map(d=>{const trip=trips.find(t=>t.destination===d);return <div key={d} style={{padding:"12px 0",borderBottom:"1px solid #35465c",overflowWrap:"anywhere"}}><strong>{d}</strong><div style={{color:"#aab9cb",marginTop:4}}>{trip?.start_date && <>Partida: {new Date(trip.start_date+"T12:00:00").toLocaleDateString("pt-BR")} · </>}Despesas: {fmt(totals[d] || 0)}</div></div>;})}
  </Modal>;
}

function RecurringItem({entry,saving,onSave,onStop,trips}) {
  const [editing,setEditing]=useState(false),[confirm,setConfirm]=useState(false);
  const [form,setForm]=useState(()=>normalizeEntryForm(entry,today));
  const set=(key,value)=>setForm(f=>({...f,[key]:value}));
  const valid=!!form.description?.trim() && Number(form.amount)>0 && !!form.date;
  return <div style={{padding:"16px 0",borderBottom:"1px solid #35465c"}}>
    <div style={{overflowWrap:"anywhere"}}>{entry.description}<br/><span style={{color:"#75b8ff"}}>{fmt(entry.amount)} · dia {String(entry.date).slice(8,10)}</span><br/><small style={{color:"#aab9cb"}}>{entry.category}</small></div>
    {!editing && <div style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:12}}><button disabled={saving} style={S.btn(false)} onClick={()=>{setForm(normalizeEntryForm(entry,today));setEditing(true);setConfirm(false);}}>Editar informações</button><button disabled={saving} style={{...S.btn(false),color:"#ff929b"}} onClick={()=>setConfirm(true)}>Cancelar recorrência</button></div>}
    {editing && <div style={{display:"grid",gap:12,marginTop:16}}>
      <label style={S.label}>Descrição<input style={S.input} value={form.description} onChange={e=>set("description",e.target.value)}/></label>
      <label style={S.label}>Tipo<select style={S.input} value={form.type} onChange={e=>set("type",e.target.value)}><option value="expense">Despesa</option><option value="income">Receita</option></select></label>
      <label style={S.label}>Categoria<select style={S.input} value={form.category} onChange={e=>set("category",e.target.value)}>{[...new Set([form.category,...ALL_CATEGORIES])].map(c=><option key={c}>{c}</option>)}</select></label>
      <DestinationField value={form.destination} onChange={v=>set("destination",v)} trips={trips}/>
      <label style={S.label}>Valor (R$)<input style={S.input} type="number" min="0.01" step="0.01" value={form.amount} onChange={e=>set("amount",e.target.value)}/></label>
      <label style={S.label}>Data original / dia do vencimento<input style={S.input} type="date" value={form.date} onChange={e=>set("date",e.target.value)}/></label>
      <label style={S.label}>Observações<textarea style={S.input} value={form.notes || ""} onChange={e=>set("notes",e.target.value)}/></label>
      <p style={{fontSize:13,color:"#aab9cb"}}>Altera o lançamento original e suas previsões ainda não confirmadas. O dia do vencimento é aplicado nos meses seguintes.</p>
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}><button style={S.btn(true)} disabled={saving || !valid} onClick={async()=>{if(await onSave(form))setEditing(false);}}>{saving?"Salvando…":"Salvar alterações"}</button><button style={S.btn(false)} disabled={saving} onClick={()=>setEditing(false)}>Descartar alterações</button></div>
    </div>}
    {confirm && <div style={{marginTop:16,padding:12,border:"1px solid #ff929b",borderRadius:8}}><p style={{fontSize:14,marginBottom:12}}>Cancelar esta recorrência e remover suas previsões? O pagamento original será mantido.</p><div style={{display:"flex",flexWrap:"wrap",gap:8}}><button style={S.btn(true)} disabled={saving} onClick={()=>onStop(entry)}>Confirmar cancelamento</button><button style={S.btn(false)} disabled={saving} onClick={()=>setConfirm(false)}>Voltar</button></div></div>}
  </div>;
}

// ─── ENTRY FORM MODAL ────────────────────────────────────────────────────────
function EntryModal({ show, onClose, onSave, initial, saving, trips }) {
  const isEdit = !!initial?.id;
  const [form, setForm] = useState(normalizeEntryForm(initial,today));
  useEffect(() => { setForm(normalizeEntryForm(initial,today)); },[initial,show]);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const card = cardDetails(initial);
  const valid = !!form.description?.trim() && Number(form.amount)>0 && !!form.date && !saving;
  return (
    <Modal show={show} onClose={onClose}>
      <h2 style={{ margin:"0 0 1.2rem",fontSize:"1rem",color:"#75b8ff",textTransform:"uppercase",letterSpacing:"0.07em" }}>
        {isEdit?"Editar Lançamento":"Novo Lançamento"}
      </h2>
      <div style={{ display:"flex",gap:"0.5rem",marginBottom:"1rem" }}>
        {[["expense","Despesa"],["income","Receita"]].map(([t,l])=>(
          <button key={t} onClick={()=>set("type",t)} style={{ flex:1,padding:"0.6rem",border:"1px solid",borderColor:form.type===t?"#75b8ff":"#35465c",borderRadius:"8px",background:form.type===t?"rgba(117,184,255,0.15)":"transparent",color:form.type===t?"#75b8ff":"#aab9cb",cursor:"pointer",fontSize:"0.85rem",fontFamily:"'Source Sans 3',sans-serif" }}>{l}</button>
        ))}
      </div>
      <div style={{ display:"flex",flexDirection:"column",gap:"0.8rem" }}>
        <div>
          <label style={S.label}>Categoria</label>
          <select value={form.category} onChange={e=>set("category",e.target.value)} style={S.input}>
            {[...new Set([form.category,...(form.type==="expense"?EXPENSE_CATEGORIES:INCOME_CATEGORIES)])].map(c=><option key={c}>{c}</option>)}
          </select>
        </div>
        <DestinationField value={form.destination} onChange={v=>set("destination",v)} trips={trips}/>
        <div>
          <label style={S.label}>Descrição</label>
          <input value={form.description} onChange={e=>set("description",e.target.value)} placeholder="Ex: Fatura Nubank março" style={S.input} onKeyDown={e=>e.key==="Enter"&&valid&&onSave(form)}/>
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.6rem" }}>
          <div>
          <label style={S.label}>{form.cardPurchase ? 'Valor total da compra (R$)' : card ? 'Valor desta parcela (R$)' : 'Valor (R$)'}</label>
            <input type="number" step="0.01" min="0" value={form.amount} onChange={e=>set("amount",e.target.value)} placeholder="0,00" style={S.input} onKeyDown={e=>e.key==="Enter"&&valid&&onSave(form)}/>
          </div>
          <div>
            <label style={S.label}>Data</label>
            <input type="date" value={form.date} onChange={e=>set("date",e.target.value)} style={S.input}/>
          </div>
        </div>
        {card && <p style={{color:'#75b8ff'}}>Parcela {card.installment}/{card.count} · total da compra {fmt(card.total)}. O total completo aparece em Viagens.</p>}
        {!isEdit && form.type==='expense' && <>
          <label style={{color:'#aab9cb'}}><input type="checkbox" checked={!!form.cardPurchase} onChange={e=>set('cardPurchase',e.target.checked)}/> Compra no cartão (parcelas mensais)</label>
          {form.cardPurchase && <div style={{display:'grid',gap:10}}>
            <label style={S.label}>Cartão<input style={S.input} value={form.cardName || ''} onChange={e=>set('cardName',e.target.value)} placeholder="Nome do cartão / últimos 4 dígitos"/></label>
            <label style={S.label}>Quantidade de parcelas<input style={S.input} type="number" min="1" max="60" value={form.installmentCount || 1} onChange={e=>set('installmentCount',Number(e.target.value))}/></label>
            <label style={S.label}>Data da compra<input style={S.input} type="date" value={form.purchase_date || form.date} onChange={e=>set('purchase_date',e.target.value)}/></label>
            <p style={{color:'#aab9cb'}}>A Data acima indica a primeira fatura. O total da compra entra uma vez na viagem; as parcelas entram nos respectivos meses.</p>
          </div>}
        </>}
        <label style={{ display:"flex",alignItems:"center",gap:"0.5rem",cursor:"pointer",color:"#aab9cb",fontSize:"0.82rem" }}>
          <input type="checkbox" disabled={form.bank==="Recorrência" || saving || form.cardPurchase || !!card} checked={form.recurring && !form.cardPurchase && !card} onChange={e=>set("recurring",e.target.checked)} style={{ accentColor:"#75b8ff" }}/>
          {form.bank==="Recorrência" ? "Gerado por recorrência; edição vale só para este mês" : "Recorrente (aparece automaticamente nos meses seguintes)"}
        </label>
        <button onClick={()=>valid&&onSave(form)} disabled={!valid} style={{ background:valid?"#75b8ff":"#253244",color:valid?"#10151d":"#8fa2bb",border:"none",borderRadius:"8px",padding:"0.85rem",fontWeight:"600",cursor:valid?"pointer":"not-allowed",fontSize:"0.9rem",marginTop:"0.4rem",fontFamily:"'Source Sans 3',sans-serif" }}>
          {saving?"Salvando…":isEdit?"Salvar Alterações":"Confirmar Lançamento"}
        </button>
      </div>
    </Modal>
  );
}

// ─── BUDGET MODAL ─────────────────────────────────────────────────────────
function BudgetModal({ show, onClose, onSave, onDelete, budgets }) {
  const [form, setForm] = useState({ category:"Alimentação", amount:"" });
  return (
    <Modal show={show} onClose={onClose} maxWidth={520}>
      <h2 style={{ margin:"0 0 1.2rem",fontSize:"1rem",color:"#75b8ff",textTransform:"uppercase",letterSpacing:"0.07em" }}>Orçamento por Categoria</h2>
      <div style={{ display:"grid",gridTemplateColumns:"1fr auto auto",gap:"0.5rem",marginBottom:"1.2rem",alignItems:"end" }}>
        <div>
          <label style={S.label}>Categoria</label>
          <select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))} style={S.input}>
            {EXPENSE_CATEGORIES.map(c=><option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label style={S.label}>Limite (R$)</label>
          <input type="number" min="0" step="50" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="1500" style={{...S.input,width:"120px"}}/>
        </div>
        <button onClick={()=>form.amount&&onSave(form.category,parseFloat(form.amount))} style={{ background:"#75b8ff",color:"#10151d",border:"none",borderRadius:"8px",padding:"0.65rem 1rem",fontWeight:"600",cursor:"pointer",fontSize:"0.85rem",marginTop:"0.3rem",whiteSpace:"nowrap" }}>+ Definir</button>
      </div>
      <div>
        {Object.entries(budgets).length===0 && <p style={{ color:"#8fa2bb",fontSize:"0.82rem",textAlign:"center",padding:"1rem" }}>Nenhum orçamento definido ainda.</p>}
        {Object.entries(budgets).map(([cat,lim])=>(
          <div key={cat} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.6rem 0",borderBottom:"1px solid #253244" }}>
            <span style={{ fontSize:"0.85rem" }}>{cat}</span>
            <div style={{ display:"flex",alignItems:"center",gap:"0.8rem" }}>
              <span style={{ color:"#75b8ff",fontSize:"0.85rem" }}>{fmt(lim)}</span>
              <button onClick={()=>onDelete(cat)} style={{ background:"none",border:"none",color:"#8fa2bb",cursor:"pointer",padding:"2px" }}><Trash2 size={13}/></button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ─── IMPORT PREVIEW MODAL ────────────────────────────────────────────────────
function ImportModal({ show, onClose, items, onConfirm, onChange, existing, saving }) {
  if (!show) return null;
  return (
    <Modal show={show} onClose={onClose} maxWidth={680}>
      <h2 style={{ margin:"0 0 0.4rem",fontSize:"1rem",color:"#75b8ff",textTransform:"uppercase",letterSpacing:"0.07em" }}>
        Pré-visualização — {items.length} transações
      </h2>
      <p style={{ fontSize:"0.85rem",color:"#aab9cb",marginBottom:"1rem" }}>Confira cada possível correspondência. Vincular confirma o lançamento existente, preservando categoria e viagem. Quitação da fatura fica no histórico e não soma novamente como despesa.</p>
      <div style={{ maxHeight:"50vh",overflowY:"auto",marginBottom:"1rem" }}>
        {items.map((e,i)=>(
          <div key={i} style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px",alignItems:"center",padding:"0.8rem 0",borderBottom:"1px solid #253244",fontSize:"0.85rem" }}>
            <span style={{ color:"#aab9cb" }}>{e.date}</span>
            <span style={{ overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }} title={e.description}>{e.description}</span>
            <select value={e.category} onChange={ev=>onChange(i,"category",ev.target.value)} style={{ ...S.input,marginTop:0,padding:"0.25rem 0.4rem",fontSize:"0.75rem" }}>
              {[...new Set([...ALL_CATEGORIES,...items.map(e=>e.category)])].map(c=><option key={c}>{c}</option>)}
            </select>
            <span style={{ color:e.type==="income"?"#53d6a0":"#ff929b",textAlign:"right",fontWeight:"600" }}>
              {e.type==="income"?"+":"-"}{fmt(e.amount)}
            </span>
            <label style={{gridColumn:'1 / -1'}}>Tratamento na importação
              <select aria-label={`Conciliar ${e.description}`} style={S.input} value={e.import_action || 'new'} onChange={ev=>onChange(i,'import_action',ev.target.value)}>
                <option value="pending">Escolha antes de salvar</option><option value="new">Cadastrar como novo gasto / receita</option><option value="skip">Ignorar esta linha / já importada</option>
                {e.type==='expense' && <option value="card_payment">Quitação da fatura (sem nova despesa)</option>}
                {reconciliationCandidates(e,existing).map(t=><option key={t.id} value={`match:${t.id}`}>Vincular: {String(t.date).slice(0,10)} · {t.description} · {fmt(t.amount)}</option>)}
              </select>
            </label>
          </div>
        ))}
      </div>
      <div style={{ display:"flex",gap:"0.6rem" }}>
        <button onClick={onClose} style={{ flex:1,...S.btn(false),padding:"0.7rem" }}>Cancelar</button>
        <button onClick={onConfirm} disabled={saving || items.some(e=>e.import_action==='pending')} style={{ flex:2,background:"#75b8ff",color:"#10151d",border:"none",borderRadius:"8px",padding:"0.7rem",fontWeight:"600",cursor:"pointer" }}>
          {saving ? 'Salvando…' : 'Confirmar importação e conciliação'}
        </button>
      </div>
    </Modal>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────
function Finance() {
  const now = new Date();
  const [month, setMonth]           = useState(now.getMonth());
  const [year, setYear]             = useState(now.getFullYear());
  const [entries, setEntries]       = useState([]);
  const [allEntries, setAllEntries] = useState([]);
  const [trips,setTrips]=useState([]);
  const [showTrips,setShowTrips]=useState(false);
  const [filterDestination,setFilterDestination]=useState("");
  const [budgets, setBudgets]       = useState({});
  const [syncError, setSyncError] = useState("");
  const [lastSync, setLastSync] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [loading, setLoading]       = useState(true);
  const [view, setView]             = useState("dashboard");
  const [search, setSearch]         = useState("");
  const [filterType, setFilterType] = useState("all");
  const [sortBy, setSortBy]         = useState("date");
  const [toast, setToast]           = useState(null);
  const [undoPayload, setUndoPayload] = useState(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [editEntry, setEditEntry]   = useState(null);
  const [detailCategory, setDetailCategory] = useState(null);
  const [delConfirm, setDelConfirm] = useState(null);
  const [showRecurring, setShowRecurring] = useState(false);
  const [showBudgets, setShowBudgets] = useState(false);
  const [importItems, setImportItems] = useState(null);
  const toastTimer = useRef(null);
  const monthRequest = useRef(0);

  // ── Data loading ──
  const loadMonth = useCallback(async () => {
    const sequence = ++monthRequest.current;
    setLoading(true);
    try {
      const generated = await api.applyRecurring(month,year);
      const data = await api.getEntries(month, year);
      if (generated.inserted>0) {
        const all = await api.getAllEntries();
        if (sequence === monthRequest.current) setAllEntries(all);
      }
      if (sequence !== monthRequest.current) return;
      setEntries(data); setSyncError(""); setLastSync(new Date());
    } catch (err) { if (sequence === monthRequest.current) setSyncError(err.message); }
    if (sequence === monthRequest.current) setLoading(false);
  }, [month, year]);

  const loadAll = useCallback(async () => {
    try {
      const data = await api.getAllEntries();
      setAllEntries(Array.isArray(data) ? data : []);
    } catch (err) { setSyncError(err.message); }
  }, []);

  const loadBudgets = useCallback(async () => {
    try {
      const data = await api.getBudgets();
      const map = {};
      if (Array.isArray(data)) data.forEach(b => { map[b.category] = parseFloat(b.monthly_limit); });
      setBudgets(map);
    } catch (err) { setSyncError(err.message); }
  }, []);

  const loadTrips=useCallback(async()=>{try{setTrips(await api.getTrips());}catch(err){setSyncError(err.message);}},[]);
  const knownTrips=useMemo(()=>[...new Set([...trips.map(t=>t.destination),...allEntries.map(e=>travelDetails(e).destination).filter(Boolean)])].map(destination=>({destination})),[trips,allEntries]);
  useEffect(()=>{loadTrips();},[loadTrips]);
  useEffect(() => { loadMonth(); }, [loadMonth]);
  useEffect(() => { loadAll(); loadBudgets(); }, [loadAll, loadBudgets]);

  useEffect(() => {
    const refresh = () => { if (!document.hidden && !savingRef.current) { loadMonth(); loadAll(); loadBudgets(); loadTrips(); } };
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
  }, [loadMonth, loadAll, loadBudgets, loadTrips]);

  // ── Toast helper ──
  const showToast = (msg, undo=null) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    setUndoPayload(undo);
    toastTimer.current = setTimeout(()=>{ setToast(null); setUndoPayload(null); }, 4000);
  };

  // ── Computed values ──
  const totalIncome  = useMemo(() => entries.filter(e=>e.type==="income").reduce((s,e)=>s+Number(e.amount),0), [entries]);
  const totalExpense = useMemo(() => entries.filter(e=>e.type==="expense" && !isCardPayment(e)).reduce((s,e)=>s+Number(e.amount),0), [entries]);
  const balance      = totalIncome - totalExpense;
  const savingsRate  = totalIncome>0 ? ((balance/totalIncome)*100).toFixed(1) : 0;

  // Previous month comparison
  const prevM = month===0?11:month-1;
  const prevY = month===0?year-1:year;
  const prevEntries = useMemo(() => allEntries.filter(e=>{ const d=new Date(e.date+"T12:00:00"); return d.getMonth()===prevM && d.getFullYear()===prevY; }), [allEntries,prevM,prevY]);
  const prevIncome  = prevEntries.filter(e=>e.type==="income").reduce((s,e)=>s+Number(e.amount),0);
  const prevExpense = prevEntries.filter(e=>e.type==="expense" && !isCardPayment(e)).reduce((s,e)=>s+Number(e.amount),0);

  const delta = (curr, prev) => {
    if (!prev) return null;
    const d = ((curr-prev)/prev*100).toFixed(1);
    return { val: d, up: d >= 0 };
  };

  // Trend (last 6 months)
  const trendData = useMemo(() => {
    const result = [];
    for (let i=5; i>=0; i--) {
      const d = new Date(year, month-i, 1);
      const m2 = d.getMonth(), y2 = d.getFullYear();
      const mes = allEntries.filter(e=>{ const ed=new Date(e.date+"T12:00:00"); return ed.getMonth()===m2 && ed.getFullYear()===y2; });
      result.push({
        name: MONTHS[m2].slice(0,3),
        Receitas: mes.filter(e=>e.type==="income").reduce((s,e)=>s+Number(e.amount),0),
        Despesas: mes.filter(e=>e.type==="expense" && !isCardPayment(e)).reduce((s,e)=>s+Number(e.amount),0),
      });
    }
    return result;
  }, [allEntries, month, year]);

  // By category
  const byCat = useMemo(() => {
    const map = {};
    entries.filter(e=>!isCardPayment(e)).forEach(e => {
      if (!map[e.category]) map[e.category] = { income:0, expense:0 };
      map[e.category][e.type==="income"?"income":"expense"] += Number(e.amount);
    });
    return map;
  }, [entries]);

  const pieData = Object.entries(byCat).filter(([,v])=>v.expense>0).map(([name,v])=>({ name, value:v.expense })).sort((a,b)=>b.value-a.value);
  const barData = Object.entries(byCat).map(([name,v])=>({ name, Receita:v.income, Despesa:v.expense })).sort((a,b)=>b.Despesa-a.Despesa);

  const detailEntries = entries.filter(e=>e.category===detailCategory).sort((a,b)=>String(b.date).localeCompare(String(a.date)));

  // Budget alerts
  const budgetAlerts = useMemo(() => Object.entries(budgets).map(([cat,lim])=>{ const spent=byCat[cat]?.expense||0; const ratio=spent/lim; return { cat, lim, spent, ratio }; }).filter(b=>b.ratio>=0.7).sort((a,b)=>b.ratio-a.ratio), [budgets,byCat]);

  // Biggest expense
  const biggestExpense = useMemo(() => {
    const exp = entries.filter(e=>e.type==="expense" && !isCardPayment(e));
    return exp.reduce((max,e)=>Number(e.amount)>Number(max?.amount||0)?e:max, null);
  }, [entries]);

  // ── Filtered + sorted transactions ──
  const filtered = useMemo(() => {
    let list = [...entries];
    if (filterDestination) list=list.filter(e=>travelDetails(e).destination===filterDestination);
    if (filterType!=="all") list = list.filter(e=>e.type===filterType);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e=>e.description.toLowerCase().includes(q)||e.category.toLowerCase().includes(q)||travelDetails(e).destination.toLowerCase().includes(q));
    }
    list.sort((a,b) => {
      if (sortBy==="date")   return new Date(b.date)-new Date(a.date);
      if (sortBy==="amount") return Number(b.amount)-Number(a.amount);
      if (sortBy==="category") return a.category.localeCompare(b.category);
      return 0;
    });
    return list;
  }, [entries, filterType, search, sortBy, filterDestination]);

  // ── CRUD handlers ──
  const handleSave = async (form) => {

    if (form.id) {
      const updated = await api.updateEntry(form.id, form);
      const inMonth=Number(updated.date.slice(0,4))===year && Number(updated.date.slice(5,7))===month+1;
      setEntries(prev=>inMonth?prev.map(e=>e.id===form.id?updated:e):prev.filter(e=>e.id!==form.id));
      setAllEntries(prev=>prev.map(e=>e.id===form.id?updated:e));
      await loadMonth(); await loadAll();
      showToast("Lançamento atualizado ✓");
    } else if (form.cardPurchase) {
      const id = form.purchaseId || crypto.randomUUID();
      form.purchaseId = id;
      const result = await api.bulkInsert(installmentSchedule(form, Number(form.installmentCount || 1), form.cardName, id));
      await loadMonth(); await loadAll();
      showToast(`${result.inserted} parcelas registradas; total da compra separado em Viagens ✓`);
    } else {
      const created = await api.addEntry(form);
      await loadMonth();
      await loadAll();
      showToast("Lançamento registrado ✓");
    }
    setShowAdd(false); setEditEntry(null);
  };

  const handleDelete = async (entry) => {
    ++monthRequest.current;
    await api.deleteEntry(entry.id);
    setDelConfirm(null);
    setEntries(prev=>prev.filter(e=>e.id!==entry.id));
    setAllEntries(prev=>prev.filter(e=>e.id!==entry.id));
    await loadMonth(); await loadAll();
    showToast("Lançamento removido", async () => {
      const restored = await api.addEntry(entry);
      await loadMonth(); await loadAll();
      showToast("Lançamento restaurado ✓");
    });
  };

  const handleStopRecurring = async (entry) => {
    ++monthRequest.current;
    const result=await api.stopRecurring(entry.id);
    setDelConfirm(null);
    await loadMonth(); await loadAll();
    showToast(`Recorrência encerrada; ${result.removed} previsões removidas. Pagamento original preservado.`);
  };

  const handleBudgetSave = async (cat, amt) => {
    await api.setBudget(cat, amt);
    setBudgets(prev=>({...prev,[cat]:amt}));
    showToast(`Orçamento de ${cat} definido ✓`);
  };
  const handleBudgetDelete = async (cat) => {
    await api.deleteBudget(cat);
    setBudgets(prev=>{ const n={...prev}; delete n[cat]; return n; });
  };

  // ── Import file ──
  const handleFileImport = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target.result;
      let items = [];
      if (file.name.endsWith(".ofx") || file.name.endsWith(".OFX")) items = parseOFX(content);
      else if (file.name.endsWith(".csv")) items = parseCSV(content);
      else {
        try {
          const data = JSON.parse(content);
          items = normalizeImport(data);
        } catch (err) { showToast(err.message); return; }
      }
      if (!items.length) { showToast("Nenhuma transação encontrada no arquivo"); return; }
      setImportItems(items.map(item=>({...item,import_action:
        allEntries.some(e=>item.bank && item.source_id && ((e.bank===item.bank && e.source_id===item.source_id) || e.reconciliation?.imports?.some(s=>s.bank===item.bank && s.source_id===item.source_id))) ? 'skip' :
        reconciliationCandidates(item,allEntries).length || /fatura|pagamento.*cart[aã]o/i.test(item.description) ? 'pending' : 'new'
      })));
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleImportConfirm = async () => {
    if (!importItems?.length) return;
    if (importItems.some(e=>e.import_action==='pending')) throw new Error('Confira as possíveis correspondências antes de importar.');
    const payload = importItems.map(item=>{
      if (!item.import_action?.startsWith('match:')) return item;
      const id=Number(item.import_action.slice(6));
      const entry=allEntries.find(e=>e.id===id);
      if (!entry) throw new Error('Atualize os lançamentos antes de conciliar.');
      return {...item,import_action:'match',match_id:id,match_expected:{type:entry.type,category:entry.category,description:entry.description,amount:Number(entry.amount),date:String(entry.date).slice(0,10)}};
    });
    const result = await api.bulkInsert(payload);
    await loadMonth(); await loadAll();
    showToast(`${result.inserted} novos; ${result.reconciled || 0} conciliados; ${result.skipped} ignorados ✓`);
    setImportItems(null);
  };

  const saveSafely = async (operation) => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try { await operation(); setSyncError(""); setLastSync(new Date()); return true; }
    catch (err) { setSyncError(err.message); showToast(err.message); return false; }
    finally { savingRef.current = false; setSaving(false); }
  };

  // ── Export JSON ──
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(allEntries,null,2)],{type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download=`financeiro_backup_${year}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  // ─── RENDER ──────────────────────────────────────────────────────────────
  const DeltaBadge = ({ curr, prev }) => {
    const d = delta(curr, prev);
    if (!d) return null;
    return (
      <span style={{ fontSize:"0.68rem", color:d.up?"#ff929b":"#53d6a0", display:"flex", alignItems:"center", gap:2 }}>
        {d.up ? <ChevronUp size={10}/> : <ChevronDown size={10}/>} {Math.abs(d.val)}%
      </span>
    );
  };

  return (
    <div style={{ minHeight:"100vh", background:"#10151d", color:"#edf3fa", fontFamily:"'Source Sans 3', sans-serif" }}>
      <Toast msg={toast} onUndo={undoPayload ? ()=>saveSafely(undoPayload) : null}/>

      {/* ── HEADER ── */}
      <div style={{ background:"#19222e", borderBottom:"1px solid #35465c", padding:"1.2rem 1.5rem" }}>
        <div style={{ maxWidth:"1100px", margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:"0.8rem" }}>
          <div>
            <h1 style={{ margin:0, fontSize:"1.4rem", color:"#75b8ff", fontFamily:"'Playfair Display', Georgia, serif" }}>Controle Financeiro</h1>
            <p style={{ margin:0, fontSize:"0.72rem", color:"#aab9cb", letterSpacing:"0.05em", textTransform:"uppercase" }}>Pessoal · {MONTHS[month]} {year}</p>
          </div>
          <div style={{ display:"flex", gap:"0.5rem", alignItems:"center", flexWrap:"wrap" }}>
            <select value={month} onChange={e=>setMonth(+e.target.value)} style={{ ...S.input, width:"auto", marginTop:0, padding:"0.4rem 0.7rem" }}>
              {MONTHS.map((m,i)=><option key={i} value={i}>{m}</option>)}
            </select>
            <input type="number" value={year} min="2000" max="2099" onChange={e=>setYear(+e.target.value)} style={{ ...S.input, width:"85px", marginTop:0, padding:"0.4rem 0.6rem" }}/>

            <label title="Importar OFX / CSV / JSON" style={{ display:"flex",alignItems:"center",gap:"6px",padding:"0.5rem 0.9rem",background:"#253244",border:"1px solid #35465c",borderRadius:"8px",cursor:"pointer",color:"#aab9cb",fontSize:"0.8rem" }}>
              <Upload size={14}/> Importar
              <input type="file" accept=".json,.ofx,.OFX,.csv" onChange={handleFileImport} style={{ display:"none" }}/>
            </label>
            <button onClick={exportJSON} title="Exportar JSON" style={{ display:"flex",alignItems:"center",gap:"6px",padding:"0.5rem 0.9rem",background:"#253244",border:"1px solid #35465c",borderRadius:"8px",cursor:"pointer",color:"#aab9cb",fontSize:"0.8rem" }}>
              <Download size={14}/> Exportar
            </button>
            <button onClick={()=>setShowTrips(true)} style={S.btn(false)}>Viagens</button>
            <button onClick={()=>setShowRecurring(true)} style={S.btn(false)}><RotateCcw size={14}/> Recorrentes</button>
            <button onClick={()=>setShowBudgets(true)} style={{ display:"flex",alignItems:"center",gap:"6px",padding:"0.5rem 0.9rem",background:"#253244",border:"1px solid #35465c",borderRadius:"8px",cursor:"pointer",color:"#aab9cb",fontSize:"0.8rem" }}>
              <Wallet size={14}/> Orçamentos
            </button>
            <button onClick={()=>setShowAdd(true)} style={{ display:"flex",alignItems:"center",gap:"0.4rem",background:"#75b8ff",color:"#10151d",border:"none",borderRadius:"8px",padding:"0.5rem 1rem",fontWeight:"600",cursor:"pointer",fontSize:"0.85rem",fontFamily:"'Source Sans 3',sans-serif" }}>
              <PlusCircle size={16}/> Lançar
            </button>
          </div>
        </div>
      </div>

      <div role="status" style={{ maxWidth:1100, margin:"0 auto", padding:"0.8rem 1.5rem", color:syncError?"#ff929b":"#53d6a0", fontSize:"0.85rem" }}>
        {saving ? "Salvando no banco online…" : syncError || (lastSync ? `Sincronizado às ${lastSync.toLocaleTimeString("pt-BR")}` : "Conectando ao banco online…")}
        <button style={{...S.btn(false),marginLeft:12}} onClick={()=>{loadMonth();loadAll();loadBudgets();loadTrips();}}>Atualizar</button>
        {syncError && <button style={{...S.btn(false),marginLeft:8}} onClick={()=>saveSafely(async()=>{ await request("setup",{method:"POST"}); await loadMonth(); await loadAll(); await loadBudgets(); })}>Preparar banco</button>}
        <button style={{...S.btn(false),marginLeft:8}} onClick={()=>saveSafely(async()=>{await request("assistant?action=revoke",{method:"POST"});showToast("Conexões do assistente revogadas");})}>Desconectar assistente</button>
        <button style={{...S.btn(false),marginLeft:8}} onClick={()=>request("session",{method:"DELETE"}).then(()=>location.reload()).catch(err=>setSyncError(err.message))}>Sair</button>
      </div>
      {new URLSearchParams(location.search).get("connectAssistant") === "1" && <div style={{...S.card,maxWidth:700,margin:"1rem auto"}}>
        <h2>Conectar seu assistente</h2><p>Autoriza consultar seus totais e registrar os gastos que você informar. A conexão dura 90 dias. Sua senha permanece neste painel.</p>
        <button style={S.btn(true)} disabled={saving} onClick={()=>saveSafely(async()=>{
          const params=new URLSearchParams(location.search);
          const data=await request("assistant?action=authorize",{method:"POST",body:JSON.stringify({state:params.get("state"),challenge:params.get("challenge")})});
          location.assign(data.redirect);
        })}>Autorizar conexão</button>
        <button style={{...S.btn(false),marginLeft:12}} onClick={()=>location.assign(location.pathname)}>Cancelar</button>
      </div>}
      {/* ── NAV ── */}
      <div style={{ background:"#19222e", borderBottom:"1px solid #35465c" }}>
        <div style={{ maxWidth:"1100px", margin:"0 auto", display:"flex" }}>
          {[["dashboard","Dashboard"],["lancamentos","Lançamentos"]].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{ padding:"0.75rem 1.5rem",background:"none",border:"none",borderBottom:view===v?"2px solid #75b8ff":"2px solid transparent",color:view===v?"#75b8ff":"#aab9cb",cursor:"pointer",fontSize:"0.85rem",fontFamily:"'Source Sans 3',sans-serif" }}>{l}</button>
          ))}
        </div>
      </div>

      <div className="dashboard-content" style={{ padding:"1.5rem", maxWidth:"1100px", margin:"0 auto" }}>
        <p style={{color:'#aab9cb',marginBottom:16}}>Orçamento mensal · valores das parcelas do mês. Em Viagens, veja o custo completo das compras.</p>
        {view==='dashboard' && <div style={{...S.card,marginBottom:16}}>
          <p style={S.label}>Custo total das viagens · todos os meses</p>
          {knownTrips.map(t=><p key={t.destination} style={{marginTop:10}}>{t.destination}: <strong style={{color:'#75b8ff'}}>{fmt(purchaseCosts(allEntries).filter(e=>travelDetails(e).destination===t.destination).reduce((sum,e)=>sum+Number(e.amount),0))}</strong></p>)}
          {!knownTrips.length && <p>Selecione um destino ao lançar a despesa.</p>}
        </div>}

        {/* ── KPIs ── */}
        <div className="kpi-grid" style={{ display:"grid", gap:"0.8rem", marginBottom:"1.2rem" }}>
          {[
            { label:"Receitas",       value:totalIncome,  prev:prevIncome,  icon:<TrendingUp size={17}/>,   color:"#53d6a0" },
            { label:"Despesas",       value:totalExpense, prev:prevExpense, icon:<TrendingDown size={17}/>, color:"#ff929b" },
            { label:"Saldo",          value:balance,      prev:null,        icon:<DollarSign size={17}/>,   color:balance>=0?"#75b8ff":"#ff929b" },
            { label:"Taxa de Poupança", value:null, display:`${savingsRate}%`, icon:<BarChart3 size={17}/>, color:savingsRate>=20?"#53d6a0":savingsRate>=0?"#75b8ff":"#ff929b" },
          ].map((k,i)=>(
            <div key={i} style={S.card}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"0.5rem" }}>
                <span style={{ ...S.label, fontSize:"0.68rem" }}>{k.label}</span>
                <span style={{ color:k.color }}>{k.icon}</span>
              </div>
              <div style={{ fontSize:"clamp(1.35rem, 4vw, 2rem)", fontWeight:"700", fontVariantNumeric:"tabular-nums", color:k.color, fontFamily:"'Source Sans 3',sans-serif" }}>
                {k.display ?? fmt(k.value)}
              </div>
              {k.prev !== null && <DeltaBadge curr={k.value} prev={k.prev}/>}
            </div>
          ))}
        </div>

        {/* ── BUDGET ALERTS ── */}
        {budgetAlerts.length > 0 && (
          <div style={{ marginBottom:"1.2rem", display:"flex", flexWrap:"wrap", gap:"0.6rem" }}>
            {budgetAlerts.map(b=>(
              <div key={b.cat} style={{ display:"flex",alignItems:"center",gap:"0.5rem",background:b.ratio>=1?"rgba(200,126,126,0.12)":"rgba(200,200,126,0.1)",border:`1px solid ${b.ratio>=1?"#ff929b":"#c8c87e"}`,borderRadius:"8px",padding:"0.5rem 0.8rem",fontSize:"0.78rem" }}>
                <AlertTriangle size={13} color={b.ratio>=1?"#ff929b":"#c8c87e"}/>
                <span style={{ color:b.ratio>=1?"#ff929b":"#c8c87e" }}>
                  {b.cat}: {fmt(b.spent)} / {fmt(b.lim)} ({(b.ratio*100).toFixed(0)}%)
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── LOADING ── */}
        {loading && <div style={{ textAlign:"center", color:"#aab9cb", padding:"3rem" }}>Carregando...</div>}

        {/* ─────────────────── DASHBOARD ─────────────────── */}
        {!loading && view==="dashboard" && (
          <>
            {entries.length === 0 ? (
              <div style={{ textAlign:"center",color:"#aab9cb",padding:"4rem 2rem",border:"1px dashed #35465c",borderRadius:"10px" }}>
                <BarChart3 size={44} style={{ margin:"0 auto 1rem",opacity:0.4 }}/>
                <p style={{ fontSize:"1rem",marginBottom:"0.5rem" }}>Nenhum lançamento em {MONTHS[month]} {year}</p>
                <p style={{ fontSize:"0.8rem",opacity:0.7 }}>Clique em "Lançar" para começar, ou importe um arquivo OFX/CSV/JSON.</p>
              </div>
            ) : (
              <>
                {/* Biggest expense insight */}
                {biggestExpense && (
                  <div style={{ ...S.card, marginBottom:"1.2rem", display:"flex", alignItems:"center", gap:"1rem", background:"rgba(200,126,126,0.07)", borderColor:"rgba(200,126,126,0.3)" }}>
                    <TrendingDown size={20} color="#ff929b" style={{ flexShrink:0 }}/>
                    <div style={{minWidth:0,overflowWrap:"anywhere"}}>
                      <span style={{ fontSize:"0.68rem", color:"#aab9cb", textTransform:"uppercase", letterSpacing:"0.05em" }}>Maior despesa do mês</span>
                      <div style={{ fontSize:"0.9rem" }}>{biggestExpense.description} <span style={{ color:"#8fa2bb" }}>· {biggestExpense.category}</span> <strong style={{ color:"#ff929b" }}>{fmt(biggestExpense.amount)}</strong></div>
                    </div>
                  </div>
                )}

                {/* Charts row */}
                <div className="chart-grid" style={{ display:"grid", gap:"0.8rem", marginBottom:"1.2rem" }}>
                  {/* Pie */}
                  <div style={S.card}>
                    <p style={{ ...S.label, margin:"0 0 0.8rem" }}>Despesas por categoria</p>
                    <ul className="category-legend" aria-label="Categorias de despesas">
                      {pieData.map((item,i)=><li key={item.name} role="button" tabIndex={0} aria-label={`Ver lançamentos de ${item.name}`} onClick={()=>setDetailCategory(item.name)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setDetailCategory(item.name);}}} style={{cursor:"pointer"}}><span className="legend-dot" style={{background:COLORS[i%COLORS.length]}}/><span className="legend-name">{item.name}<span aria-hidden="true" style={{display:"block",height:6,background:"#253244",borderRadius:4,marginTop:8}}><span style={{display:"block",height:"100%",width:`${pct(item.value,totalExpense)}%`,background:COLORS[i%COLORS.length],borderRadius:4}}/></span></span><span className="legend-amount">{fmt(item.value)}<small>{pct(item.value,totalExpense)}%</small></span></li>)}
                    </ul>
                  </div>

                  {/* Bar */}
                  <div style={S.card}>
                    <p style={{ ...S.label, margin:"0 0 0.8rem" }}>Receita vs Despesa por categoria</p>
                    <div className="bar-key"><span><i style={{background:"#53d6a0"}}/>Receita</span><span><i style={{background:"#ff929b"}}/>Despesa</span></div>
                    <ResponsiveContainer width="100%" height={Math.max(240,barData.length*52+40)}>
                      <BarChart data={barData} layout="vertical" margin={{ left:0, right:12, top:8, bottom:8 }}>
                        <XAxis type="number" tick={{ fontSize:10,fill:"#aab9cb" }} tickFormatter={v=>v>=1000?`${(v/1000).toLocaleString("pt-BR",{maximumFractionDigits:1})}k`:`${v}`}/>
                        <YAxis type="category" dataKey="name" width={125} interval={0} tick={<CategoryAxisTick/>}/>
                        <Tooltip content={<ChartTooltip/>}/>
                        <Bar dataKey="Receita" fill="#53d6a0" radius={[0,3,3,0]}/>
                        <Bar dataKey="Despesa" fill="#ff929b" radius={[0,3,3,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Trend line */}
                <div style={{ ...S.card, marginBottom:"1.2rem" }}>
                  <p style={{ ...S.label, margin:"0 0 0.8rem" }}>Tendência — últimos 6 meses</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={trendData} margin={{ left:-10 }}>
                      <XAxis dataKey="name" tick={{ fontSize:10,fill:"#aab9cb" }}/>
                      <YAxis tick={{ fontSize:9,fill:"#aab9cb" }} width={55} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:`${v}`}/>
                      <Tooltip content={<ChartTooltip/>}/>
                      <Legend iconSize={8} wrapperStyle={{ fontSize:"0.72rem",color:"#aab9cb" }}/>
                      <Line type="monotone" dataKey="Receitas" stroke="#53d6a0" strokeWidth={2} dot={{ r:3 }}/>
                      <Line type="monotone" dataKey="Despesas" stroke="#ff929b" strokeWidth={2} dot={{ r:3 }}/>
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Category table */}
                <div style={{ background:"#19222e",border:"1px solid #35465c",borderRadius:"10px",overflow:"hidden",marginBottom:"1.2rem" }}>
                  <div style={{ padding:"0.8rem 1rem",borderBottom:"1px solid #253244" }}>
                    <p style={{ ...S.label, margin:0 }}>Resumo por categoria · {MONTHS[month]}</p>
                  </div>
                  {Object.entries(byCat).sort((a,b)=>b[1].expense-a[1].expense).map(([cat,v],i)=>{
                    const p = totalExpense>0 ? v.expense/totalExpense : 0;
                    const budLim = budgets[cat];
                    const budRatio = budLim && v.expense>0 ? v.expense/budLim : null;
                    return (
                      <div key={i} role="button" tabIndex={0} aria-label={`Ver lançamentos de ${cat}`} onClick={()=>setDetailCategory(cat)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setDetailCategory(cat);}}} style={{ cursor:"pointer",padding:"0.65rem 1rem",borderBottom:"1px solid #253244" }}>
                        <div className="category-summary" style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"4px" }}>
                          <div style={{ display:"flex",alignItems:"center",gap:"0.7rem" }}>
                            <div style={{ width:8,height:8,borderRadius:"50%",background:COLORS[i%COLORS.length],flexShrink:0 }}/>
                            <span style={{ fontSize:"0.85rem" }}>{cat}</span>
                          </div>
                          <div style={{ display:"flex",gap:"1rem",fontSize:"0.8rem",alignItems:"center" }}>
                            {v.income>0 && <span style={{ color:"#53d6a0" }}>+{fmt(v.income)}</span>}
                            {v.expense>0 && <span style={{ color:"#ff929b" }}>-{fmt(v.expense)}</span>}
                            {v.expense>0 && <span style={{ color:"#8fa2bb",fontSize:"0.7rem",minWidth:"3rem",textAlign:"right" }}>{pct(v.expense,totalExpense)}%</span>}
                          </div>
                        </div>
                        {v.expense>0 && (
                          <div style={{ display:"flex",alignItems:"center",gap:"8px" }}>
                            <div style={{ flex:1,height:"4px",background:"#253244",borderRadius:"2px",overflow:"hidden" }}>
                              <div style={{ height:"100%",width:`${Math.min(p*100,100)}%`,background:COLORS[i%COLORS.length],borderRadius:"2px" }}/>
                            </div>
                            {budLim && <span style={{ fontSize:"0.68rem",color:budRatio>=1?"#ff929b":budRatio>=0.8?"#c8c87e":"#8fa2bb",minWidth:"60px",textAlign:"right" }}>lim {fmt(budLim)}</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {/* ─────────────────── LANÇAMENTOS ─────────────────── */}
        {!loading && view==="lancamentos" && (
          <div>
            {/* Filter bar */}
            <div style={{ display:"flex",gap:"0.5rem",marginBottom:"0.8rem",flexWrap:"wrap",alignItems:"center" }}>
              <input placeholder="Buscar por descrição, categoria ou destino…" value={search} onChange={e=>setSearch(e.target.value)} style={{ ...S.input, marginTop:0, flex:1, minWidth:"200px" }}/>
              <select aria-label="Filtrar por destino" style={{...S.input,marginTop:0,width:"auto",maxWidth:"100%"}} value={filterDestination} onChange={e=>setFilterDestination(e.target.value)}><option value="">Todos os destinos</option>{knownTrips.map(t=><option key={t.destination}>{t.destination}</option>)}</select>
              <div style={{ display:"flex",gap:"0.4rem" }}>
                {[["all","Todos"],["expense","Despesas"],["income","Receitas"]].map(([t,l])=>(
                  <button key={t} onClick={()=>setFilterType(t)} style={S.btn(filterType===t)}>{l}</button>
                ))}
              </div>
              <div style={{ display:"flex",gap:"0.4rem",alignItems:"center" }}>
                <ArrowUpDown size={13} color="#8fa2bb"/>
                {[["date","Data"],["amount","Valor"],["category","Categoria"]].map(([s,l])=>(
                  <button key={s} onClick={()=>setSortBy(s)} style={S.btn(sortBy===s)}>{l}</button>
                ))}
              </div>
            </div>

            <div style={{ background:"#19222e",border:"1px solid #35465c",borderRadius:"10px",overflow:"hidden" }}>
              {filtered.length===0 ? (
                <div style={{ textAlign:"center",color:"#aab9cb",padding:"3rem" }}>
                  {entries.length===0?"Sem lançamentos neste período.":"Nenhum resultado."}
                </div>
              ) : (
                filtered.map(e=>(
                  <div key={e.id} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0.8rem 1rem",borderBottom:"1px solid #253244",gap:"0.5rem" }}>
                    <div style={{ display:"flex",alignItems:"center",gap:"0.8rem",flex:1,minWidth:0 }}>
                      <div style={{ width:8,height:8,borderRadius:"50%",background:e.type==="income"?"#53d6a0":"#ff929b",flexShrink:0 }}/>
                      <div style={{ minWidth:0 }}>
                        <div style={{ fontSize:"0.85rem",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{e.description}</div>
                        <div style={{ fontSize:"0.7rem",color:"#aab9cb",display:"flex",flexWrap:"wrap",gap:"0.4rem",alignItems:"center" }}>
                          <span>{e.category}</span><span>·</span>
                          {isCardPayment(e) && <span>Quitação do cartão · fora das despesas</span>}
                          {cardDetails(e) && <span>Parcela {cardDetails(e).installment}/{cardDetails(e).count} · compra {fmt(cardDetails(e).total)}</span>}
                          {travelDetails(e).destination && <span style={{color:"#75b8ff"}}>Viagem · {travelDetails(e).destination}</span>}
                          <span>{new Date(e.date+"T12:00:00").toLocaleDateString("pt-BR")}</span>
                          {(e.recurring || e.bank==="Recorrência") && <span style={{ color:"#75b8ff",fontSize:"0.65rem" }}>{e.bank==="Recorrência" ? "↻ previsto recorrente" : "↻ recorrente"}</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{ display:"flex",alignItems:"center",gap:"0.6rem",flexShrink:0 }}>
                      <span style={{ color:e.type==="income"?"#53d6a0":"#ff929b",fontWeight:"600",fontSize:"0.9rem" }}>
                        {e.type==="income"?"+":"-"}{fmt(e.amount)}
                      </span>
                      <button onClick={()=>setEditEntry(e)} title="Editar" aria-label={`Editar ${e.description}`} style={{ background:"none",border:"none",color:"#75b8ff",cursor:"pointer",padding:"10px",minWidth:40,minHeight:40 }}>
                        <Pencil size={13}/>
                      </button>
                      <button onClick={()=>setDelConfirm(e)} title="Excluir" style={{ background:"none",border:"none",color:"#aab9cb",cursor:"pointer",padding:"10px",minWidth:40,minHeight:40 }}>
                        <Trash2 size={13}/>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            {entries.length>0 && (
              <p style={{ fontSize:"0.72rem",color:"#8fa2bb",textAlign:"right",marginTop:"0.5rem" }}>
                {filtered.length} lançamento(s) · Despesas: {fmt(filtered.filter(e=>e.type==="expense" && !isCardPayment(e)).reduce((t,e)=>t+Number(e.amount),0))} · Receitas: {fmt(filtered.filter(e=>e.type==="income").reduce((t,e)=>t+Number(e.amount),0))}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── MODALS ── */}
      <Modal show={showRecurring} onClose={()=>setShowRecurring(false)}>
        <h2 style={{color:"#75b8ff",marginBottom:16}}>Lançamentos recorrentes</h2>
        <p style={{color:"#aab9cb",marginBottom:16}}>Ao abrir cada mês, os lançamentos marcados de meses anteriores aparecem automaticamente. Cada um é gerado uma vez por mês. Datas como dia 31 são ajustadas ao último dia do mês.</p>
        {allEntries.filter(e=>e.recurring && e.bank!=="Recorrência").length===0 && <p>Marque um lançamento como recorrente ao criar ou editar.</p>}
        {allEntries.filter(e=>e.recurring && e.bank!=="Recorrência").map(e=><RecurringItem key={e.id} entry={e} saving={saving} trips={knownTrips} onStop={entry=>saveSafely(()=>handleStopRecurring(entry))} onSave={form=>saveSafely(async()=>{const result=await api.editRecurring(form.id,form);await loadMonth();await loadAll();showToast(`Recorrência atualizada; ${result.forecasts} previsões ajustadas.`);})}/>)}
        <p style={{fontSize:13,color:"#aab9cb",margin:"16px 0"}}>Use Editar informações para ajustar a série ou Cancelar recorrência para encerrar a repetição e remover suas previsões.</p>
        <button style={S.btn(true)} disabled={saving || !allEntries.some(e=>e.recurring && e.bank!=="Recorrência" && e.date<`${year}-${String(month+1).padStart(2,"0")}-01`)} onClick={()=>saveSafely(async()=>{const r=await api.applyRecurring(month,year);await loadMonth();await loadAll();showToast(`${r.inserted} recorrentes gerados; ${r.skipped} já processados`);})}>{saving?"Salvando…":`Aplicar em ${MONTHS[month]}`}</button>
      </Modal>
      <TripsModal show={showTrips} onClose={()=>setShowTrips(false)} trips={trips} entries={allEntries} saving={saving} onSave={trip=>saveSafely(async()=>{const saved=await api.addTrip(trip);setTrips(prev=>[...prev.filter(t=>t.destination!==saved.destination),saved].sort((a,b)=>a.destination.localeCompare(b.destination)));showToast("Destino cadastrado ✓");})}/>
      <EntryModal show={showAdd} onClose={()=>setShowAdd(false)} onSave={form=>saveSafely(()=>handleSave(form))} initial={null} saving={saving} trips={knownTrips}/>
      <EntryModal show={!!editEntry} onClose={()=>setEditEntry(null)} onSave={form=>saveSafely(()=>handleSave(form))} initial={editEntry} saving={saving} trips={knownTrips}/>

      <BudgetModal show={showBudgets} onClose={()=>setShowBudgets(false)} onSave={(cat,amt)=>saveSafely(()=>handleBudgetSave(cat,amt))} onDelete={cat=>saveSafely(()=>handleBudgetDelete(cat))} budgets={budgets}/>

      <Modal show={detailCategory!==null} onClose={()=>setDetailCategory(null)} maxWidth={600}>
        <h2 style={{fontSize:"1.1rem",marginBottom:8,overflowWrap:"anywhere"}}>{detailCategory}</h2>
        <p style={{color:"#b6c4d6",marginBottom:16}}>{MONTHS[month]} / {year} · {detailEntries.length} lançamento(s)</p>
        <p style={{marginBottom:16}}>Despesas: {fmt(detailEntries.filter(e=>e.type==="expense" && !isCardPayment(e)).reduce((sum,e)=>sum+Number(e.amount),0))} · Receitas: {fmt(detailEntries.filter(e=>e.type==="income").reduce((sum,e)=>sum+Number(e.amount),0))}</p>
        <div style={{maxHeight:"55vh",overflowY:"auto"}}>
          {detailEntries.length===0 && <p>Nenhum lançamento nesta categoria no mês selecionado.</p>}
          {detailEntries.map(e=><article key={e.id} style={{padding:"14px 0",borderBottom:"1px solid #35465c",overflowWrap:"anywhere"}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><strong>{e.description}</strong><strong style={{color:e.type==="expense"?"#ff929b":"#53d6a0"}}>{e.type==="expense"?"−":"+"}{fmt(e.amount)}</strong></div>
            <p style={{color:"#b6c4d6",marginTop:6}}>{String(e.date).slice(0,10).split("-").reverse().join("/")} {e.bank && `· ${e.bank}`}</p>
            <p style={{marginTop:8,whiteSpace:"pre-wrap"}}>Observações: {e.notes || "Sem observações"}</p>
            <button style={{...S.btn(false),marginTop:10}} onClick={()=>{setDetailCategory(null);setEditEntry(e);}}>Editar lançamento / observações</button>
          </article>)}
        </div>
        <button style={{...S.btn(false),marginTop:16}} onClick={()=>setDetailCategory(null)}>Fechar</button>
      </Modal>

      {/* Delete confirm */}
      <Modal show={!!delConfirm} onClose={()=>setDelConfirm(null)} maxWidth={380}>
        <h2 style={{ margin:"0 0 0.8rem",fontSize:"1rem",color:"#ff929b" }}>Confirmar exclusão</h2>
        <p style={{ fontSize:"0.85rem",color:"#aab9cb",marginBottom:"1.2rem" }}>Tem certeza que deseja excluir <strong style={{ color:"#edf3fa" }}>{delConfirm?.description}</strong>? Você poderá desfazer por 4 segundos.</p>
        {(delConfirm?.recurring || delConfirm?.bank==="Recorrência") && <div style={{border:"1px solid #75b8ff",padding:12,borderRadius:8,marginBottom:16}}><p style={{fontSize:14,marginBottom:12}}>Se este gasto não deve se repetir, encerre a recorrência. Isso remove as previsões geradas dessa série e mantém o pagamento original.</p><button style={S.btn(true)} disabled={saving} onClick={()=>saveSafely(()=>handleStopRecurring(delConfirm))}>Encerrar recorrência e remover previsões</button></div>}
        <div style={{ display:"flex",gap:"0.6rem" }}>
          <button onClick={()=>setDelConfirm(null)} style={{ flex:1,...S.btn(false),padding:"0.7rem" }}>Cancelar</button>
          <button disabled={saving} onClick={()=>saveSafely(()=>handleDelete(delConfirm))} style={{ flex:1,background:"#ff929b",color:"#10151d",border:"none",borderRadius:"8px",padding:"0.7rem",fontWeight:"600",cursor:"pointer" }}>{saving?"Salvando…":delConfirm?.bank==="Recorrência"?"Excluir só este mês":"Excluir lançamento"}</button>
        </div>
      </Modal>

      {/* Import preview */}
      <ImportModal show={!!importItems} onClose={()=>setImportItems(null)} items={importItems||[]} existing={allEntries} saving={saving} onConfirm={()=>saveSafely(handleImportConfirm)}
        onChange={(i,k,v)=>setImportItems(prev=>prev.map((e,idx)=>idx===i?{...e,[k]:v}:e))}/>
    </div>
  );
}



export default function App() {
  const [ready,setReady] = useState(false);
  const [password,setPassword] = useState("");
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(true);
  useEffect(()=>{request("session").then(()=>setReady(true)).catch(err=>setError(err.message)).finally(()=>setBusy(false));},[]);
  const login = async e => {
    e.preventDefault(); setBusy(true); setError("");
    try { await request("session",{method:"POST",body:JSON.stringify({password})}); setPassword(""); setReady(true); }
    catch(err) { setError(err.message); } finally { setBusy(false); }
  };
  if (ready) return <Finance/>;
  return <main style={{minHeight:"100vh",background:"#10151d",color:"#edf3fa",display:"grid",placeItems:"center",padding:20,boxSizing:"border-box"}}>
    <form onSubmit={login} style={{...S.card,width:"100%",maxWidth:380}}>
      <h1>Controle Financeiro</h1><p>Entre com a mesma senha no computador e no celular.</p>
      <label htmlFor="password">Senha de acesso</label>
      <input id="password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} style={S.input} required/>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} style={{...S.btn(true),marginTop:16}}>{busy?"Conectando…":"Entrar"}</button>
    </form>
  </main>;
}


