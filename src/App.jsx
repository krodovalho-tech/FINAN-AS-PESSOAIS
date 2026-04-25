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
  "Moradia","Alimentação","Transporte","Saúde","Educação",
  "Lazer","Vestuário","Investimentos","Impostos","Cartão de Crédito","Outros"
];
const INCOME_CATEGORIES = [
  "Salário","Pró-labore","Dividendos","Aluguel","Freelance","Outros"
];
const ALL_CATEGORIES = [...new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES])];
const COLORS = ["#c8a97e","#7eb8c8","#c87e9a","#7ec87e","#c8c87e","#9a7ec8",
                 "#c8957e","#7ec8b8","#b8c87e","#7e9ac8","#c87e7e"];
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
    results.push({ type: amount>=0?"income":"expense", amount:Math.abs(amount), date, description:desc, category:autoCategory(desc), recurring:false });
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
const BASE = "/api";
const api = {
  async getEntries(month, year) {
    const r = await fetch(`${BASE}/entries?month=${month}&year=${year}`);
    return r.json();
  },
  async getAllEntries() {
    const r = await fetch(`${BASE}/entries?all=true`);
    return r.json();
  },
  async addEntry(e) {
    const r = await fetch(`${BASE}/entries`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(e) });
    return r.json();
  },
  async updateEntry(id, e) {
    const r = await fetch(`${BASE}/entries?id=${id}`, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(e) });
    return r.json();
  },
  async deleteEntry(id) {
    await fetch(`${BASE}/entries?id=${id}`, { method:"DELETE" });
  },
  async bulkInsert(entries) {
    const r = await fetch(`${BASE}/entries`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ entries }) });
    return r.json();
  },
  async getBudgets() {
    const r = await fetch(`${BASE}/budgets`);
    return r.json();
  },
  async setBudget(category, monthly_limit) {
    const r = await fetch(`${BASE}/budgets`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ category, monthly_limit }) });
    return r.json();
  },
  async deleteBudget(category) {
    await fetch(`${BASE}/budgets?category=${encodeURIComponent(category)}`, { method:"DELETE" });
  },
};

// ─── STYLE HELPERS ──────────────────────────────────────────────────────────
const S = {
  input: { width:"100%", padding:"0.65rem 0.85rem", background:"#0f0c0a", border:"1px solid #3d342a", borderRadius:"8px", color:"#e8d8c0", fontSize:"0.9rem", boxSizing:"border-box", marginTop:"0.3rem", fontFamily:"'Source Sans 3', sans-serif" },
  label: { fontSize:"0.7rem", color:"#8a7a6a", textTransform:"uppercase", letterSpacing:"0.07em" },
  card: { background:"#1a1612", border:"1px solid #3d342a", borderRadius:"10px", padding:"1rem" },
  btn: (active) => ({ padding:"0.5rem 0.9rem", background:active?"rgba(200,169,126,0.15)":"#2a2018", border:`1px solid ${active?"#c8a97e":"#3d342a"}`, borderRadius:"8px", color:active?"#c8a97e":"#8a7a6a", cursor:"pointer", fontSize:"0.8rem", fontFamily:"'Source Sans 3',sans-serif" }),
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
      <div style={{ background:"#1a1612",border:"1px solid #3d342a",borderRadius:"14px",padding:"2rem",width:"100%",maxWidth,position:"relative",maxHeight:"90vh",overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
        <button onClick={onClose} style={{ position:"absolute",top:"1rem",right:"1rem",background:"none",border:"none",color:"#8a7a6a",cursor:"pointer",padding:"4px" }}>
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
    <div style={{ position:"fixed",bottom:"1.5rem",right:"1.5rem",background:"#1a1612",border:"1px solid #c8a97e",color:"#c8a97e",padding:"0.7rem 1.2rem",borderRadius:"8px",fontSize:"0.85rem",zIndex:200,display:"flex",alignItems:"center",gap:"0.8rem",boxShadow:"0 4px 20px rgba(0,0,0,0.5)" }}>
      {msg}
      {onUndo && <button onClick={onUndo} style={{ background:"none",border:"none",color:"#c8a97e",cursor:"pointer",textDecoration:"underline",fontSize:"0.82rem",display:"flex",alignItems:"center",gap:"4px" }}><RotateCcw size={13}/> Desfazer</button>}
    </div>
  );
}

// ─── CUSTOM TOOLTIP ─────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"#1a1612",border:"1px solid #3d342a",color:"#e8d8c0",fontSize:"0.78rem",borderRadius:"6px",padding:"0.5rem 0.8rem" }}>
      {label && <p style={{ color:"#8a7a6a",marginBottom:"4px",fontSize:"0.72rem" }}>{label}</p>}
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
  return <text x={x} y={y} fill="#8a7a6a" textAnchor={x>cx?"start":"end"} dominantBaseline="central" fontSize="10">{`${(percent*100).toFixed(0)}%`}</text>;
};

// ─── ENTRY FORM MODAL ────────────────────────────────────────────────────────
function EntryModal({ show, onClose, onSave, initial }) {
  const isEdit = !!initial?.id;
  const [form, setForm] = useState(initial || { type:"expense",category:"Alimentação",description:"",amount:"",date:today,recurring:false });
  useEffect(() => { setForm(initial || { type:"expense",category:"Alimentação",description:"",amount:"",date:today,recurring:false }); },[initial,show]);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const valid = form.description.trim() && form.amount && form.date;
  return (
    <Modal show={show} onClose={onClose}>
      <h2 style={{ margin:"0 0 1.2rem",fontSize:"1rem",color:"#c8a97e",textTransform:"uppercase",letterSpacing:"0.07em" }}>
        {isEdit?"Editar Lançamento":"Novo Lançamento"}
      </h2>
      <div style={{ display:"flex",gap:"0.5rem",marginBottom:"1rem" }}>
        {[["expense","Despesa"],["income","Receita"]].map(([t,l])=>(
          <button key={t} onClick={()=>set("type",t)} style={{ flex:1,padding:"0.6rem",border:"1px solid",borderColor:form.type===t?"#c8a97e":"#3d342a",borderRadius:"8px",background:form.type===t?"rgba(200,169,126,0.15)":"transparent",color:form.type===t?"#c8a97e":"#8a7a6a",cursor:"pointer",fontSize:"0.85rem",fontFamily:"'Source Sans 3',sans-serif" }}>{l}</button>
        ))}
      </div>
      <div style={{ display:"flex",flexDirection:"column",gap:"0.8rem" }}>
        <div>
          <label style={S.label}>Categoria</label>
          <select value={form.category} onChange={e=>set("category",e.target.value)} style={S.input}>
            {(form.type==="expense"?EXPENSE_CATEGORIES:INCOME_CATEGORIES).map(c=><option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label style={S.label}>Descrição</label>
          <input value={form.description} onChange={e=>set("description",e.target.value)} placeholder="Ex: Fatura Nubank março" style={S.input} onKeyDown={e=>e.key==="Enter"&&valid&&onSave(form)}/>
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.6rem" }}>
          <div>
            <label style={S.label}>Valor (R$)</label>
            <input type="number" step="0.01" min="0" value={form.amount} onChange={e=>set("amount",e.target.value)} placeholder="0,00" style={S.input} onKeyDown={e=>e.key==="Enter"&&valid&&onSave(form)}/>
          </div>
          <div>
            <label style={S.label}>Data</label>
            <input type="date" value={form.date} onChange={e=>set("date",e.target.value)} style={S.input}/>
          </div>
        </div>
        <label style={{ display:"flex",alignItems:"center",gap:"0.5rem",cursor:"pointer",color:"#8a7a6a",fontSize:"0.82rem" }}>
          <input type="checkbox" checked={form.recurring} onChange={e=>set("recurring",e.target.checked)} style={{ accentColor:"#c8a97e" }}/>
          Lançamento recorrente (repete mensalmente)
        </label>
        <button onClick={()=>valid&&onSave(form)} disabled={!valid} style={{ background:valid?"#c8a97e":"#2a2018",color:valid?"#0f0c0a":"#5a4a3a",border:"none",borderRadius:"8px",padding:"0.85rem",fontWeight:"600",cursor:valid?"pointer":"not-allowed",fontSize:"0.9rem",marginTop:"0.4rem",fontFamily:"'Source Sans 3',sans-serif" }}>
          {isEdit?"Salvar Alterações":"Confirmar Lançamento"}
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
      <h2 style={{ margin:"0 0 1.2rem",fontSize:"1rem",color:"#c8a97e",textTransform:"uppercase",letterSpacing:"0.07em" }}>Orçamento por Categoria</h2>
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
        <button onClick={()=>form.amount&&onSave(form.category,parseFloat(form.amount))} style={{ background:"#c8a97e",color:"#0f0c0a",border:"none",borderRadius:"8px",padding:"0.65rem 1rem",fontWeight:"600",cursor:"pointer",fontSize:"0.85rem",marginTop:"0.3rem",whiteSpace:"nowrap" }}>+ Definir</button>
      </div>
      <div>
        {Object.entries(budgets).length===0 && <p style={{ color:"#5a4a3a",fontSize:"0.82rem",textAlign:"center",padding:"1rem" }}>Nenhum orçamento definido ainda.</p>}
        {Object.entries(budgets).map(([cat,lim])=>(
          <div key={cat} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.6rem 0",borderBottom:"1px solid #2a2018" }}>
            <span style={{ fontSize:"0.85rem" }}>{cat}</span>
            <div style={{ display:"flex",alignItems:"center",gap:"0.8rem" }}>
              <span style={{ color:"#c8a97e",fontSize:"0.85rem" }}>{fmt(lim)}</span>
              <button onClick={()=>onDelete(cat)} style={{ background:"none",border:"none",color:"#5a4a3a",cursor:"pointer",padding:"2px" }}><Trash2 size={13}/></button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ─── IMPORT PREVIEW MODAL ────────────────────────────────────────────────────
function ImportModal({ show, onClose, items, onConfirm, onChange }) {
  if (!show) return null;
  return (
    <Modal show={show} onClose={onClose} maxWidth={680}>
      <h2 style={{ margin:"0 0 0.4rem",fontSize:"1rem",color:"#c8a97e",textTransform:"uppercase",letterSpacing:"0.07em" }}>
        Pré-visualização — {items.length} transações
      </h2>
      <p style={{ fontSize:"0.75rem",color:"#5a4a3a",marginBottom:"1rem" }}>Ajuste as categorias antes de importar.</p>
      <div style={{ maxHeight:"50vh",overflowY:"auto",marginBottom:"1rem" }}>
        {items.map((e,i)=>(
          <div key={i} style={{ display:"grid",gridTemplateColumns:"90px 1fr 130px 90px",gap:"6px",alignItems:"center",padding:"0.4rem 0",borderBottom:"1px solid #2a2018",fontSize:"0.78rem" }}>
            <span style={{ color:"#8a7a6a" }}>{e.date}</span>
            <span style={{ overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }} title={e.description}>{e.description}</span>
            <select value={e.category} onChange={ev=>onChange(i,"category",ev.target.value)} style={{ ...S.input,marginTop:0,padding:"0.25rem 0.4rem",fontSize:"0.75rem" }}>
              {ALL_CATEGORIES.map(c=><option key={c}>{c}</option>)}
            </select>
            <span style={{ color:e.type==="income"?"#7ec87e":"#c87e7e",textAlign:"right",fontWeight:"600" }}>
              {e.type==="income"?"+":"-"}{fmt(e.amount)}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display:"flex",gap:"0.6rem" }}>
        <button onClick={onClose} style={{ flex:1,...S.btn(false),padding:"0.7rem" }}>Cancelar</button>
        <button onClick={onConfirm} style={{ flex:2,background:"#c8a97e",color:"#0f0c0a",border:"none",borderRadius:"8px",padding:"0.7rem",fontWeight:"600",cursor:"pointer" }}>
          Importar {items.length} lançamentos
        </button>
      </div>
    </Modal>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function App() {
  const now = new Date();
  const [month, setMonth]           = useState(now.getMonth());
  const [year, setYear]             = useState(now.getFullYear());
  const [entries, setEntries]       = useState([]);
  const [allEntries, setAllEntries] = useState([]);
  const [budgets, setBudgets]       = useState({});
  const [loading, setLoading]       = useState(true);
  const [view, setView]             = useState("dashboard");
  const [search, setSearch]         = useState("");
  const [filterType, setFilterType] = useState("all");
  const [sortBy, setSortBy]         = useState("date");
  const [toast, setToast]           = useState(null);
  const [undoPayload, setUndoPayload] = useState(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [editEntry, setEditEntry]   = useState(null);
  const [delConfirm, setDelConfirm] = useState(null);
  const [showBudgets, setShowBudgets] = useState(false);
  const [importItems, setImportItems] = useState(null);
  const toastTimer = useRef(null);

  // ── Data loading ──
  const loadMonth = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getEntries(month, year);
      setEntries(Array.isArray(data) ? data : []);
    } catch { setEntries([]); }
    setLoading(false);
  }, [month, year]);

  const loadAll = useCallback(async () => {
    try {
      const data = await api.getAllEntries();
      setAllEntries(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  const loadBudgets = useCallback(async () => {
    try {
      const data = await api.getBudgets();
      const map = {};
      if (Array.isArray(data)) data.forEach(b => { map[b.category] = parseFloat(b.monthly_limit); });
      setBudgets(map);
    } catch {}
  }, []);

  useEffect(() => { loadMonth(); }, [loadMonth]);
  useEffect(() => { loadAll(); loadBudgets(); }, [loadAll, loadBudgets]);

  // ── Toast helper ──
  const showToast = (msg, undo=null) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    setUndoPayload(undo);
    toastTimer.current = setTimeout(()=>{ setToast(null); setUndoPayload(null); }, 4000);
  };

  // ── Computed values ──
  const totalIncome  = useMemo(() => entries.filter(e=>e.type==="income").reduce((s,e)=>s+Number(e.amount),0), [entries]);
  const totalExpense = useMemo(() => entries.filter(e=>e.type==="expense").reduce((s,e)=>s+Number(e.amount),0), [entries]);
  const balance      = totalIncome - totalExpense;
  const savingsRate  = totalIncome>0 ? ((balance/totalIncome)*100).toFixed(1) : 0;

  // Previous month comparison
  const prevM = month===0?11:month-1;
  const prevY = month===0?year-1:year;
  const prevEntries = useMemo(() => allEntries.filter(e=>{ const d=new Date(e.date+"T12:00:00"); return d.getMonth()===prevM && d.getFullYear()===prevY; }), [allEntries,prevM,prevY]);
  const prevIncome  = prevEntries.filter(e=>e.type==="income").reduce((s,e)=>s+Number(e.amount),0);
  const prevExpense = prevEntries.filter(e=>e.type==="expense").reduce((s,e)=>s+Number(e.amount),0);

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
        Despesas: mes.filter(e=>e.type==="expense").reduce((s,e)=>s+Number(e.amount),0),
      });
    }
    return result;
  }, [allEntries, month, year]);

  // By category
  const byCat = useMemo(() => {
    const map = {};
    entries.forEach(e => {
      if (!map[e.category]) map[e.category] = { income:0, expense:0 };
      map[e.category][e.type==="income"?"income":"expense"] += Number(e.amount);
    });
    return map;
  }, [entries]);

  const pieData = Object.entries(byCat).filter(([,v])=>v.expense>0).map(([name,v])=>({ name, value:v.expense })).sort((a,b)=>b.value-a.value);
  const barData = Object.entries(byCat).map(([name,v])=>({ name, Receita:v.income, Despesa:v.expense })).sort((a,b)=>b.Despesa-a.Despesa);

  // Budget alerts
  const budgetAlerts = useMemo(() => Object.entries(budgets).map(([cat,lim])=>{ const spent=byCat[cat]?.expense||0; const ratio=spent/lim; return { cat, lim, spent, ratio }; }).filter(b=>b.ratio>=0.7).sort((a,b)=>b.ratio-a.ratio), [budgets,byCat]);

  // Biggest expense
  const biggestExpense = useMemo(() => {
    const exp = entries.filter(e=>e.type==="expense");
    return exp.reduce((max,e)=>Number(e.amount)>Number(max?.amount||0)?e:max, null);
  }, [entries]);

  // ── Filtered + sorted transactions ──
  const filtered = useMemo(() => {
    let list = [...entries];
    if (filterType!=="all") list = list.filter(e=>e.type===filterType);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e=>e.description.toLowerCase().includes(q)||e.category.toLowerCase().includes(q));
    }
    list.sort((a,b) => {
      if (sortBy==="date")   return new Date(b.date)-new Date(a.date);
      if (sortBy==="amount") return Number(b.amount)-Number(a.amount);
      if (sortBy==="category") return a.category.localeCompare(b.category);
      return 0;
    });
    return list;
  }, [entries, filterType, search, sortBy]);

  // ── CRUD handlers ──
  const handleSave = async (form) => {
    setShowAdd(false); setEditEntry(null);
    if (form.id) {
      const updated = await api.updateEntry(form.id, form);
      setEntries(prev=>prev.map(e=>e.id===form.id?updated:e));
      setAllEntries(prev=>prev.map(e=>e.id===form.id?updated:e));
      showToast("Lançamento atualizado ✓");
    } else {
      const created = await api.addEntry(form);
      await loadMonth();
      await loadAll();
      showToast("Lançamento registrado ✓");
    }
  };

  const handleDelete = async (entry) => {
    setDelConfirm(null);
    setEntries(prev=>prev.filter(e=>e.id!==entry.id));
    setAllEntries(prev=>prev.filter(e=>e.id!==entry.id));
    await api.deleteEntry(entry.id);
    showToast("Lançamento removido", async () => {
      const restored = await api.addEntry({ type:entry.type,category:entry.category,description:entry.description,amount:entry.amount,date:entry.date,recurring:entry.recurring });
      await loadMonth(); await loadAll();
      showToast("Lançamento restaurado ✓");
    });
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
          if (Array.isArray(data)) items = data;
        } catch { showToast("Arquivo inválido"); return; }
      }
      if (!items.length) { showToast("Nenhuma transação encontrada no arquivo"); return; }
      setImportItems(items);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleImportConfirm = async () => {
    if (!importItems?.length) return;
    await api.bulkInsert(importItems);
    await loadMonth(); await loadAll();
    showToast(`${importItems.length} lançamentos importados ✓`);
    setImportItems(null);
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
      <span style={{ fontSize:"0.68rem", color:d.up?"#c87e7e":"#7ec87e", display:"flex", alignItems:"center", gap:2 }}>
        {d.up ? <ChevronUp size={10}/> : <ChevronDown size={10}/>} {Math.abs(d.val)}%
      </span>
    );
  };

  return (
    <div style={{ minHeight:"100vh", background:"#0f0c0a", color:"#e8d8c0", fontFamily:"'Source Sans 3', sans-serif" }}>
      <Toast msg={toast} onUndo={undoPayload}/>

      {/* ── HEADER ── */}
      <div style={{ background:"#1a1612", borderBottom:"1px solid #3d342a", padding:"1.2rem 1.5rem" }}>
        <div style={{ maxWidth:"1100px", margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:"0.8rem" }}>
          <div>
            <h1 style={{ margin:0, fontSize:"1.4rem", color:"#c8a97e", fontFamily:"'Playfair Display', Georgia, serif" }}>Controle Financeiro</h1>
            <p style={{ margin:0, fontSize:"0.72rem", color:"#8a7a6a", letterSpacing:"0.05em", textTransform:"uppercase" }}>Pessoal · {MONTHS[month]} {year}</p>
          </div>
          <div style={{ display:"flex", gap:"0.5rem", alignItems:"center", flexWrap:"wrap" }}>
            <select value={month} onChange={e=>setMonth(+e.target.value)} style={{ ...S.input, width:"auto", marginTop:0, padding:"0.4rem 0.7rem" }}>
              {MONTHS.map((m,i)=><option key={i} value={i}>{m}</option>)}
            </select>
            <input type="number" value={year} min="2000" max="2099" onChange={e=>setYear(+e.target.value)} style={{ ...S.input, width:"85px", marginTop:0, padding:"0.4rem 0.6rem" }}/>

            <label title="Importar OFX / CSV / JSON" style={{ display:"flex",alignItems:"center",gap:"6px",padding:"0.5rem 0.9rem",background:"#2a2018",border:"1px solid #3d342a",borderRadius:"8px",cursor:"pointer",color:"#8a7a6a",fontSize:"0.8rem" }}>
              <Upload size={14}/> Importar
              <input type="file" accept=".json,.ofx,.OFX,.csv" onChange={handleFileImport} style={{ display:"none" }}/>
            </label>
            <button onClick={exportJSON} title="Exportar JSON" style={{ display:"flex",alignItems:"center",gap:"6px",padding:"0.5rem 0.9rem",background:"#2a2018",border:"1px solid #3d342a",borderRadius:"8px",cursor:"pointer",color:"#8a7a6a",fontSize:"0.8rem" }}>
              <Download size={14}/> Exportar
            </button>
            <button onClick={()=>setShowBudgets(true)} style={{ display:"flex",alignItems:"center",gap:"6px",padding:"0.5rem 0.9rem",background:"#2a2018",border:"1px solid #3d342a",borderRadius:"8px",cursor:"pointer",color:"#8a7a6a",fontSize:"0.8rem" }}>
              <Wallet size={14}/> Orçamentos
            </button>
            <button onClick={()=>setShowAdd(true)} style={{ display:"flex",alignItems:"center",gap:"0.4rem",background:"#c8a97e",color:"#0f0c0a",border:"none",borderRadius:"8px",padding:"0.5rem 1rem",fontWeight:"600",cursor:"pointer",fontSize:"0.85rem",fontFamily:"'Source Sans 3',sans-serif" }}>
              <PlusCircle size={16}/> Lançar
            </button>
          </div>
        </div>
      </div>

      {/* ── NAV ── */}
      <div style={{ background:"#1a1612", borderBottom:"1px solid #3d342a" }}>
        <div style={{ maxWidth:"1100px", margin:"0 auto", display:"flex" }}>
          {[["dashboard","Dashboard"],["lancamentos","Lançamentos"]].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{ padding:"0.75rem 1.5rem",background:"none",border:"none",borderBottom:view===v?"2px solid #c8a97e":"2px solid transparent",color:view===v?"#c8a97e":"#8a7a6a",cursor:"pointer",fontSize:"0.85rem",fontFamily:"'Source Sans 3',sans-serif" }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ padding:"1.5rem", maxWidth:"1100px", margin:"0 auto" }}>

        {/* ── KPIs ── */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:"0.8rem", marginBottom:"1.2rem" }}>
          {[
            { label:"Receitas",       value:totalIncome,  prev:prevIncome,  icon:<TrendingUp size={17}/>,   color:"#7ec87e" },
            { label:"Despesas",       value:totalExpense, prev:prevExpense, icon:<TrendingDown size={17}/>, color:"#c87e7e" },
            { label:"Saldo",          value:balance,      prev:null,        icon:<DollarSign size={17}/>,   color:balance>=0?"#c8a97e":"#c87e7e" },
            { label:"Taxa de Poupança", value:null, display:`${savingsRate}%`, icon:<BarChart3 size={17}/>, color:savingsRate>=20?"#7ec87e":savingsRate>=0?"#c8a97e":"#c87e7e" },
          ].map((k,i)=>(
            <div key={i} style={S.card}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"0.5rem" }}>
                <span style={{ ...S.label, fontSize:"0.68rem" }}>{k.label}</span>
                <span style={{ color:k.color }}>{k.icon}</span>
              </div>
              <div style={{ fontSize:"1.15rem", fontWeight:"600", color:k.color, fontFamily:"'Playfair Display',serif" }}>
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
              <div key={b.cat} style={{ display:"flex",alignItems:"center",gap:"0.5rem",background:b.ratio>=1?"rgba(200,126,126,0.12)":"rgba(200,200,126,0.1)",border:`1px solid ${b.ratio>=1?"#c87e7e":"#c8c87e"}`,borderRadius:"8px",padding:"0.5rem 0.8rem",fontSize:"0.78rem" }}>
                <AlertTriangle size={13} color={b.ratio>=1?"#c87e7e":"#c8c87e"}/>
                <span style={{ color:b.ratio>=1?"#c87e7e":"#c8c87e" }}>
                  {b.cat}: {fmt(b.spent)} / {fmt(b.lim)} ({(b.ratio*100).toFixed(0)}%)
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── LOADING ── */}
        {loading && <div style={{ textAlign:"center", color:"#8a7a6a", padding:"3rem" }}>Carregando...</div>}

        {/* ─────────────────── DASHBOARD ─────────────────── */}
        {!loading && view==="dashboard" && (
          <>
            {entries.length === 0 ? (
              <div style={{ textAlign:"center",color:"#8a7a6a",padding:"4rem 2rem",border:"1px dashed #3d342a",borderRadius:"10px" }}>
                <BarChart3 size={44} style={{ margin:"0 auto 1rem",opacity:0.4 }}/>
                <p style={{ fontSize:"1rem",marginBottom:"0.5rem" }}>Nenhum lançamento em {MONTHS[month]} {year}</p>
                <p style={{ fontSize:"0.8rem",opacity:0.7 }}>Clique em "Lançar" para começar, ou importe um arquivo OFX/CSV/JSON.</p>
              </div>
            ) : (
              <>
                {/* Biggest expense insight */}
                {biggestExpense && (
                  <div style={{ ...S.card, marginBottom:"1.2rem", display:"flex", alignItems:"center", gap:"1rem", background:"rgba(200,126,126,0.07)", borderColor:"rgba(200,126,126,0.3)" }}>
                    <TrendingDown size={20} color="#c87e7e" style={{ flexShrink:0 }}/>
                    <div>
                      <span style={{ fontSize:"0.68rem", color:"#8a7a6a", textTransform:"uppercase", letterSpacing:"0.05em" }}>Maior despesa do mês</span>
                      <div style={{ fontSize:"0.9rem" }}>{biggestExpense.description} <span style={{ color:"#5a4a3a" }}>· {biggestExpense.category}</span> <strong style={{ color:"#c87e7e" }}>{fmt(biggestExpense.amount)}</strong></div>
                    </div>
                  </div>
                )}

                {/* Charts row */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.8rem", marginBottom:"1.2rem" }}>
                  {/* Pie */}
                  <div style={S.card}>
                    <p style={{ ...S.label, margin:"0 0 0.8rem" }}>Despesas por categoria</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" nameKey="name" labelLine={false} label={PieLabel}>
                          {pieData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                        </Pie>
                        <Tooltip content={<ChartTooltip/>}/>
                        <Legend iconSize={8} wrapperStyle={{ fontSize:"0.7rem",color:"#8a7a6a" }}/>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Bar */}
                  <div style={S.card}>
                    <p style={{ ...S.label, margin:"0 0 0.8rem" }}>Receita vs Despesa por categoria</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={barData} margin={{ left:-10, bottom:30 }}>
                        <XAxis dataKey="name" tick={{ fontSize:9,fill:"#8a7a6a" }} interval={0} angle={-35} textAnchor="end" height={60}/>
                        <YAxis tick={{ fontSize:9,fill:"#8a7a6a" }} width={55} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:`${v}`}/>
                        <Tooltip content={<ChartTooltip/>}/>
                        <Legend iconSize={8} wrapperStyle={{ fontSize:"0.72rem",color:"#8a7a6a" }}/>
                        <Bar dataKey="Receita" fill="#7ec87e" radius={[3,3,0,0]}/>
                        <Bar dataKey="Despesa" fill="#c87e7e" radius={[3,3,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Trend line */}
                <div style={{ ...S.card, marginBottom:"1.2rem" }}>
                  <p style={{ ...S.label, margin:"0 0 0.8rem" }}>Tendência — últimos 6 meses</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={trendData} margin={{ left:-10 }}>
                      <XAxis dataKey="name" tick={{ fontSize:10,fill:"#8a7a6a" }}/>
                      <YAxis tick={{ fontSize:9,fill:"#8a7a6a" }} width={55} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:`${v}`}/>
                      <Tooltip content={<ChartTooltip/>}/>
                      <Legend iconSize={8} wrapperStyle={{ fontSize:"0.72rem",color:"#8a7a6a" }}/>
                      <Line type="monotone" dataKey="Receitas" stroke="#7ec87e" strokeWidth={2} dot={{ r:3 }}/>
                      <Line type="monotone" dataKey="Despesas" stroke="#c87e7e" strokeWidth={2} dot={{ r:3 }}/>
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Category table */}
                <div style={{ background:"#1a1612",border:"1px solid #3d342a",borderRadius:"10px",overflow:"hidden",marginBottom:"1.2rem" }}>
                  <div style={{ padding:"0.8rem 1rem",borderBottom:"1px solid #2a2018" }}>
                    <p style={{ ...S.label, margin:0 }}>Resumo por categoria · {MONTHS[month]}</p>
                  </div>
                  {Object.entries(byCat).sort((a,b)=>b[1].expense-a[1].expense).map(([cat,v],i)=>{
                    const p = totalExpense>0 ? v.expense/totalExpense : 0;
                    const budLim = budgets[cat];
                    const budRatio = budLim && v.expense>0 ? v.expense/budLim : null;
                    return (
                      <div key={i} style={{ padding:"0.65rem 1rem",borderBottom:"1px solid #2a2018" }}>
                        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"4px" }}>
                          <div style={{ display:"flex",alignItems:"center",gap:"0.7rem" }}>
                            <div style={{ width:8,height:8,borderRadius:"50%",background:COLORS[i%COLORS.length],flexShrink:0 }}/>
                            <span style={{ fontSize:"0.85rem" }}>{cat}</span>
                          </div>
                          <div style={{ display:"flex",gap:"1rem",fontSize:"0.8rem",alignItems:"center" }}>
                            {v.income>0 && <span style={{ color:"#7ec87e" }}>+{fmt(v.income)}</span>}
                            {v.expense>0 && <span style={{ color:"#c87e7e" }}>-{fmt(v.expense)}</span>}
                            {v.expense>0 && <span style={{ color:"#5a4a3a",fontSize:"0.7rem",minWidth:"3rem",textAlign:"right" }}>{pct(v.expense,totalExpense)}%</span>}
                          </div>
                        </div>
                        {v.expense>0 && (
                          <div style={{ display:"flex",alignItems:"center",gap:"8px" }}>
                            <div style={{ flex:1,height:"4px",background:"#2a2018",borderRadius:"2px",overflow:"hidden" }}>
                              <div style={{ height:"100%",width:`${Math.min(p*100,100)}%`,background:COLORS[i%COLORS.length],borderRadius:"2px" }}/>
                            </div>
                            {budLim && <span style={{ fontSize:"0.68rem",color:budRatio>=1?"#c87e7e":budRatio>=0.8?"#c8c87e":"#5a4a3a",minWidth:"60px",textAlign:"right" }}>lim {fmt(budLim)}</span>}
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
              <input placeholder="Buscar por descrição ou categoria…" value={search} onChange={e=>setSearch(e.target.value)} style={{ ...S.input, marginTop:0, flex:1, minWidth:"200px" }}/>
              <div style={{ display:"flex",gap:"0.4rem" }}>
                {[["all","Todos"],["expense","Despesas"],["income","Receitas"]].map(([t,l])=>(
                  <button key={t} onClick={()=>setFilterType(t)} style={S.btn(filterType===t)}>{l}</button>
                ))}
              </div>
              <div style={{ display:"flex",gap:"0.4rem",alignItems:"center" }}>
                <ArrowUpDown size={13} color="#5a4a3a"/>
                {[["date","Data"],["amount","Valor"],["category","Categoria"]].map(([s,l])=>(
                  <button key={s} onClick={()=>setSortBy(s)} style={S.btn(sortBy===s)}>{l}</button>
                ))}
              </div>
            </div>

            <div style={{ background:"#1a1612",border:"1px solid #3d342a",borderRadius:"10px",overflow:"hidden" }}>
              {filtered.length===0 ? (
                <div style={{ textAlign:"center",color:"#8a7a6a",padding:"3rem" }}>
                  {entries.length===0?"Sem lançamentos neste período.":"Nenhum resultado."}
                </div>
              ) : (
                filtered.map(e=>(
                  <div key={e.id} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0.8rem 1rem",borderBottom:"1px solid #2a2018",gap:"0.5rem" }}>
                    <div style={{ display:"flex",alignItems:"center",gap:"0.8rem",flex:1,minWidth:0 }}>
                      <div style={{ width:8,height:8,borderRadius:"50%",background:e.type==="income"?"#7ec87e":"#c87e7e",flexShrink:0 }}/>
                      <div style={{ minWidth:0 }}>
                        <div style={{ fontSize:"0.85rem",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{e.description}</div>
                        <div style={{ fontSize:"0.7rem",color:"#8a7a6a",display:"flex",gap:"0.4rem",alignItems:"center" }}>
                          <span>{e.category}</span><span>·</span>
                          <span>{new Date(e.date+"T12:00:00").toLocaleDateString("pt-BR")}</span>
                          {e.recurring && <span style={{ color:"#c8a97e",fontSize:"0.65rem" }}>↻ recorrente</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{ display:"flex",alignItems:"center",gap:"0.6rem",flexShrink:0 }}>
                      <span style={{ color:e.type==="income"?"#7ec87e":"#c87e7e",fontWeight:"600",fontSize:"0.9rem" }}>
                        {e.type==="income"?"+":"-"}{fmt(e.amount)}
                      </span>
                      <button onClick={()=>setEditEntry(e)} title="Editar" style={{ background:"none",border:"none",color:"#8a7a6a",cursor:"pointer",padding:"0.2rem" }}>
                        <Pencil size={13}/>
                      </button>
                      <button onClick={()=>setDelConfirm(e)} title="Excluir" style={{ background:"none",border:"none",color:"#8a7a6a",cursor:"pointer",padding:"0.2rem" }}>
                        <Trash2 size={13}/>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            {entries.length>0 && (
              <p style={{ fontSize:"0.72rem",color:"#5a4a3a",textAlign:"right",marginTop:"0.5rem" }}>
                {filtered.length} lançamento(s) · Despesas: {fmt(totalExpense)} · Receitas: {fmt(totalIncome)}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── MODALS ── */}
      <EntryModal show={showAdd} onClose={()=>setShowAdd(false)} onSave={handleSave} initial={null}/>
      <EntryModal show={!!editEntry} onClose={()=>setEditEntry(null)} onSave={handleSave} initial={editEntry}/>

      <BudgetModal show={showBudgets} onClose={()=>setShowBudgets(false)} onSave={handleBudgetSave} onDelete={handleBudgetDelete} budgets={budgets}/>

      {/* Delete confirm */}
      <Modal show={!!delConfirm} onClose={()=>setDelConfirm(null)} maxWidth={380}>
        <h2 style={{ margin:"0 0 0.8rem",fontSize:"1rem",color:"#c87e7e" }}>Confirmar exclusão</h2>
        <p style={{ fontSize:"0.85rem",color:"#8a7a6a",marginBottom:"1.2rem" }}>Tem certeza que deseja excluir <strong style={{ color:"#e8d8c0" }}>{delConfirm?.description}</strong>? Você poderá desfazer por 4 segundos.</p>
        <div style={{ display:"flex",gap:"0.6rem" }}>
          <button onClick={()=>setDelConfirm(null)} style={{ flex:1,...S.btn(false),padding:"0.7rem" }}>Cancelar</button>
          <button onClick={()=>handleDelete(delConfirm)} style={{ flex:1,background:"#c87e7e",color:"#0f0c0a",border:"none",borderRadius:"8px",padding:"0.7rem",fontWeight:"600",cursor:"pointer" }}>Excluir</button>
        </div>
      </Modal>

      {/* Import preview */}
      <ImportModal show={!!importItems} onClose={()=>setImportItems(null)} items={importItems||[]} onConfirm={handleImportConfirm}
        onChange={(i,k,v)=>setImportItems(prev=>prev.map((e,idx)=>idx===i?{...e,[k]:v}:e))}/>
    </div>
  );
}
