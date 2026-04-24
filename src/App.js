import { useState, useEffect } from "react";
import { PlusCircle, Trash2, TrendingUp, TrendingDown, DollarSign, BarChart3, X, Download, Upload } from "lucide-react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

const EXPENSE_CATEGORIES = [
  "Moradia", "Alimentação", "Transporte", "Saúde", "Educação",
  "Lazer", "Vestuário", "Investimentos", "Impostos", "Cartão de Crédito", "Outros"
];
const INCOME_CATEGORIES = [
  "Salário", "Pró-labore", "Dividendos", "Aluguel", "Freelance", "Outros"
];
const COLORS = ["#c8a97e","#7eb8c8","#c87e9a","#7ec87e","#c8c87e","#9a7ec8","#c8957e","#7ec8b8","#b8c87e","#7e9ac8","#c87e7e"];
const MONTHS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

const fmt = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const STORAGE_KEY = "financeiro_kleber_v1";

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveData(entries) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch {}
}

function Modal({ show, onClose, children }) {
  useEffect(() => {
    const handler = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  if (!show) return null;
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem" }} onClick={onClose}>
      <div style={{ background:"#1a1612",border:"1px solid #3d342a",borderRadius:"14px",padding:"2rem",width:"100%",maxWidth:"480px",position:"relative" }} onClick={e=>e.stopPropagation()}>
        <button onClick={onClose} style={{ position:"absolute",top:"1rem",right:"1rem",background:"none",border:"none",color:"#8a7a6a",cursor:"pointer" }}>
          <X size={20}/>
        </button>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [entries, setEntries] = useState(loadData);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ type:"expense", category:"Alimentação", description:"", amount:"", date: now.toISOString().split("T")[0] });
  const [view, setView] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);

  useEffect(() => { saveData(entries); }, [entries]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const filtered = entries.filter(e => {
    const d = new Date(e.date + "T12:00:00");
    return d.getMonth() === month && d.getFullYear() === year;
  });

  const searched = filtered.filter(e =>
    e.description.toLowerCase().includes(search.toLowerCase()) ||
    e.category.toLowerCase().includes(search.toLowerCase())
  );

  const totalIncome = filtered.filter(e=>e.type==="income").reduce((s,e)=>s+e.amount,0);
  const totalExpense = filtered.filter(e=>e.type==="expense").reduce((s,e)=>s+e.amount,0);
  const balance = totalIncome - totalExpense;

  const byCat = {};
  filtered.forEach(e => {
    if (!byCat[e.category]) byCat[e.category] = { income:0, expense:0 };
    byCat[e.category][e.type==="income"?"income":"expense"] += e.amount;
  });

  const pieData = Object.entries(byCat)
    .filter(([,v])=>v.expense>0)
    .map(([name,v])=>({ name, value: v.expense }))
    .sort((a,b)=>b.value-a.value);

  const barData = Object.entries(byCat)
    .map(([name,v])=>({ name: name.length > 8 ? name.slice(0,8)+"…" : name, Receita:v.income, Despesa:v.expense }));

  const addEntry = () => {
    if (!form.description.trim() || !form.amount || !form.date) return;
    const entry = { ...form, amount: parseFloat(form.amount), id: Date.now() };
    setEntries(prev => [...prev, entry]);
    setForm(f => ({ ...f, description:"", amount:"" }));
    setShowModal(false);
    showToast("Lançamento registrado ✓");
  };

  const del = (id) => {
    setEntries(prev => prev.filter(e=>e.id!==id));
    showToast("Lançamento removido");
  };

  // Export JSON
  const exportData = () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "financeiro_backup.json"; a.click();
    URL.revokeObjectURL(url);
  };

  // Import JSON
  const importData = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (Array.isArray(data)) {
          setEntries(prev => {
            const ids = new Set(prev.map(x=>x.id));
            const merged = [...prev, ...data.filter(x=>!ids.has(x.id))];
            return merged;
          });
          showToast(`${data.length} lançamentos importados ✓`);
        }
      } catch { showToast("Erro ao importar arquivo"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const inputStyle = {
    width:"100%", padding:"0.65rem 0.85rem", background:"#0f0c0a",
    border:"1px solid #3d342a", borderRadius:"8px", color:"#e8d8c0",
    fontSize:"0.9rem", boxSizing:"border-box", marginTop:"0.3rem",
    fontFamily:"'Source Sans 3', sans-serif"
  };
  const labelStyle = {
    fontSize:"0.7rem", color:"#8a7a6a", textTransform:"uppercase",
    letterSpacing:"0.07em", fontFamily:"'Source Sans 3', sans-serif"
  };

  const savingsRate = totalIncome > 0 ? ((balance / totalIncome) * 100).toFixed(1) : 0;

  return (
    <div style={{ minHeight:"100vh", background:"#0f0c0a", color:"#e8d8c0", fontFamily:"'Source Sans 3', sans-serif" }}>

      {/* Toast */}
      {toast && (
        <div style={{ position:"fixed",bottom:"1.5rem",right:"1.5rem",background:"#1a1612",border:"1px solid #c8a97e",color:"#c8a97e",padding:"0.7rem 1.2rem",borderRadius:"8px",fontSize:"0.85rem",zIndex:200,boxShadow:"0 4px 20px rgba(0,0,0,0.5)" }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ background:"#1a1612", borderBottom:"1px solid #3d342a", padding:"1.2rem 1.5rem" }}>
        <div style={{ maxWidth:"960px", margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:"0.8rem" }}>
          <div>
            <h1 style={{ margin:0, fontSize:"1.4rem", color:"#c8a97e", fontFamily:"'Playfair Display', Georgia, serif", letterSpacing:"0.02em" }}>
              Controle Financeiro
            </h1>
            <p style={{ margin:0, fontSize:"0.72rem", color:"#8a7a6a", letterSpacing:"0.05em", textTransform:"uppercase" }}>
              Pessoal · {MONTHS[month]} {year}
            </p>
          </div>
          <div style={{ display:"flex", gap:"0.5rem", alignItems:"center", flexWrap:"wrap" }}>
            <select value={month} onChange={e=>setMonth(+e.target.value)} style={{ ...inputStyle, width:"auto", marginTop:0, padding:"0.4rem 0.7rem" }}>
              {MONTHS.map((m,i)=><option key={i} value={i}>{m}</option>)}
            </select>
            <input type="number" value={year} onChange={e=>setYear(+e.target.value)} style={{ ...inputStyle, width:"80px", marginTop:0, padding:"0.4rem 0.6rem" }}/>

            {/* Import */}
            <label title="Importar backup JSON" style={{ display:"flex",alignItems:"center",padding:"0.5rem 0.8rem",background:"#2a2018",border:"1px solid #3d342a",borderRadius:"8px",cursor:"pointer",color:"#8a7a6a" }}>
              <Upload size={15}/>
              <input type="file" accept=".json" onChange={importData} style={{ display:"none" }}/>
            </label>

            {/* Export */}
            <button onClick={exportData} title="Exportar backup JSON" style={{ display:"flex",alignItems:"center",padding:"0.5rem 0.8rem",background:"#2a2018",border:"1px solid #3d342a",borderRadius:"8px",cursor:"pointer",color:"#8a7a6a" }}>
              <Download size={15}/>
            </button>

            <button onClick={()=>setShowModal(true)} style={{ display:"flex",alignItems:"center",gap:"0.4rem",background:"#c8a97e",color:"#0f0c0a",border:"none",borderRadius:"8px",padding:"0.5rem 1rem",fontWeight:"600",cursor:"pointer",fontSize:"0.85rem",fontFamily:"'Source Sans 3',sans-serif" }}>
              <PlusCircle size={16}/> Lançar
            </button>
          </div>
        </div>
      </div>

      {/* Nav */}
      <div style={{ background:"#1a1612", borderBottom:"1px solid #3d342a" }}>
        <div style={{ maxWidth:"960px", margin:"0 auto", display:"flex" }}>
          {[["dashboard","Dashboard"],["lancamentos","Lançamentos"]].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{ padding:"0.75rem 1.5rem", background:"none", border:"none", borderBottom: view===v?"2px solid #c8a97e":"2px solid transparent", color: view===v?"#c8a97e":"#8a7a6a", cursor:"pointer", fontSize:"0.85rem", fontFamily:"'Source Sans 3',sans-serif" }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding:"1.5rem", maxWidth:"960px", margin:"0 auto" }}>

        {/* KPIs */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"0.8rem", marginBottom:"1.2rem" }}>
          {[
            { label:"Receitas", value:totalIncome, icon:<TrendingUp size={17}/>, color:"#7ec87e" },
            { label:"Despesas", value:totalExpense, icon:<TrendingDown size={17}/>, color:"#c87e7e" },
            { label:"Saldo", value:balance, icon:<DollarSign size={17}/>, color: balance>=0?"#c8a97e":"#c87e7e" },
            { label:"Taxa de Poupança", value:null, display:`${savingsRate}%`, icon:<BarChart3 size={17}/>, color: savingsRate>=20?"#7ec87e":savingsRate>=0?"#c8a97e":"#c87e7e" },
          ].map((k,i)=>(
            <div key={i} style={{ background:"#1a1612", border:"1px solid #3d342a", borderRadius:"10px", padding:"1rem" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"0.5rem" }}>
                <span style={{ ...labelStyle, fontSize:"0.68rem" }}>{k.label}</span>
                <span style={{ color:k.color }}>{k.icon}</span>
              </div>
              <div style={{ fontSize:"1.15rem", fontWeight:"600", color:k.color, fontFamily:"'Playfair Display',serif" }}>
                {k.display ?? fmt(k.value)}
              </div>
            </div>
          ))}
        </div>

        {view==="dashboard" && (
          <>
            {pieData.length > 0 ? (
              <>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.8rem", marginBottom:"1.2rem" }}>
                  <div style={{ background:"#1a1612", border:"1px solid #3d342a", borderRadius:"10px", padding:"1rem" }}>
                    <p style={{ ...labelStyle, margin:"0 0 0.8rem" }}>Despesas por Categoria</p>
                    <ResponsiveContainer width="100%" height={210}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" nameKey="name">
                          {pieData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                        </Pie>
                        <Tooltip formatter={v=>fmt(v)} contentStyle={{ background:"#1a1612", border:"1px solid #3d342a", color:"#e8d8c0", fontSize:"0.78rem", borderRadius:"6px" }}/>
                        <Legend wrapperStyle={{ fontSize:"0.72rem", color:"#8a7a6a" }}/>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ background:"#1a1612", border:"1px solid #3d342a", borderRadius:"10px", padding:"1rem" }}>
                    <p style={{ ...labelStyle, margin:"0 0 0.8rem" }}>Receita vs Despesa por Categoria</p>
                    <ResponsiveContainer width="100%" height={210}>
                      <BarChart data={barData} margin={{ left:-15, bottom:10 }}>
                        <XAxis dataKey="name" tick={{ fontSize:9, fill:"#8a7a6a" }} interval={0} angle={-30} textAnchor="end" height={50}/>
                        <YAxis tick={{ fontSize:9, fill:"#8a7a6a" }}/>
                        <Tooltip formatter={v=>fmt(v)} contentStyle={{ background:"#1a1612", border:"1px solid #3d342a", color:"#e8d8c0", fontSize:"0.78rem", borderRadius:"6px" }}/>
                        <Legend wrapperStyle={{ fontSize:"0.72rem", color:"#8a7a6a" }}/>
                        <Bar dataKey="Receita" fill="#7ec87e" radius={[4,4,0,0]}/>
                        <Bar dataKey="Despesa" fill="#c87e7e" radius={[4,4,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Category table */}
                <div style={{ background:"#1a1612", border:"1px solid #3d342a", borderRadius:"10px", overflow:"hidden", marginBottom:"1.2rem" }}>
                  <div style={{ padding:"0.8rem 1rem", borderBottom:"1px solid #2a2018" }}>
                    <p style={{ ...labelStyle, margin:0 }}>Resumo por Categoria · {MONTHS[month]}</p>
                  </div>
                  {Object.entries(byCat)
                    .sort((a,b)=>b[1].expense-a[1].expense)
                    .map(([cat,v],i)=>{
                      const pct = totalExpense>0 ? (v.expense/totalExpense*100).toFixed(1) : 0;
                      return (
                        <div key={i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0.65rem 1rem", borderBottom:"1px solid #2a2018", gap:"0.5rem" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:"0.7rem", flex:1 }}>
                            <div style={{ width:9, height:9, borderRadius:"50%", background:COLORS[i%COLORS.length], flexShrink:0 }}/>
                            <span style={{ fontSize:"0.85rem" }}>{cat}</span>
                          </div>
                          <div style={{ display:"flex", gap:"1.5rem", fontSize:"0.8rem", alignItems:"center" }}>
                            {v.income>0 && <span style={{ color:"#7ec87e" }}>+{fmt(v.income)}</span>}
                            {v.expense>0 && <><span style={{ color:"#c87e7e" }}>-{fmt(v.expense)}</span><span style={{ color:"#5a4a3a", fontSize:"0.72rem", minWidth:"3rem", textAlign:"right" }}>{pct}%</span></>}
                          </div>
                        </div>
                      );
                  })}
                </div>
              </>
            ) : (
              <div style={{ textAlign:"center", color:"#8a7a6a", padding:"4rem 2rem", border:"1px dashed #3d342a", borderRadius:"10px" }}>
                <BarChart3 size={44} style={{ margin:"0 auto 1rem", opacity:0.4 }}/>
                <p style={{ fontSize:"1rem", marginBottom:"0.5rem" }}>Nenhum lançamento em {MONTHS[month]} {year}</p>
                <p style={{ fontSize:"0.8rem", opacity:0.7 }}>Clique em "Lançar" para começar, ou importe um backup JSON.</p>
              </div>
            )}
          </>
        )}

        {view==="lancamentos" && (
          <div>
            <input
              placeholder="Buscar por descrição ou categoria…"
              value={search}
              onChange={e=>setSearch(e.target.value)}
              style={{ ...inputStyle, marginBottom:"0.8rem", marginTop:0 }}
            />
            <div style={{ background:"#1a1612", border:"1px solid #3d342a", borderRadius:"10px", overflow:"hidden" }}>
              {searched.length===0 ? (
                <div style={{ textAlign:"center", color:"#8a7a6a", padding:"3rem" }}>
                  {filtered.length===0 ? "Sem lançamentos neste período." : "Nenhum resultado para a busca."}
                </div>
              ) : (
                [...searched].sort((a,b)=>new Date(b.date)-new Date(a.date)).map(e=>(
                  <div key={e.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0.8rem 1rem", borderBottom:"1px solid #2a2018", gap:"0.5rem" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:"0.8rem", flex:1, minWidth:0 }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:e.type==="income"?"#7ec87e":"#c87e7e", flexShrink:0 }}/>
                      <div style={{ minWidth:0 }}>
                        <div style={{ fontSize:"0.85rem", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{e.description}</div>
                        <div style={{ fontSize:"0.7rem", color:"#8a7a6a" }}>
                          {e.category} · {new Date(e.date+"T12:00:00").toLocaleDateString("pt-BR")}
                        </div>
                      </div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:"0.8rem", flexShrink:0 }}>
                      <span style={{ color:e.type==="income"?"#7ec87e":"#c87e7e", fontWeight:"600", fontSize:"0.9rem" }}>
                        {e.type==="income"?"+":"-"}{fmt(e.amount)}
                      </span>
                      <button onClick={()=>del(e.id)} style={{ background:"none", border:"none", color:"#8a7a6a", cursor:"pointer", padding:"0.2rem" }}>
                        <Trash2 size={14}/>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            {filtered.length > 0 && (
              <p style={{ fontSize:"0.72rem", color:"#5a4a3a", textAlign:"right", marginTop:"0.5rem" }}>
                {filtered.length} lançamentos · Total despesas: {fmt(totalExpense)} · Receitas: {fmt(totalIncome)}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      <Modal show={showModal} onClose={()=>setShowModal(false)}>
        <h2 style={{ margin:"0 0 1.2rem", fontSize:"1rem", color:"#c8a97e", textTransform:"uppercase", letterSpacing:"0.07em", fontFamily:"'Source Sans 3',sans-serif" }}>
          Novo Lançamento
        </h2>
        <div style={{ display:"flex", gap:"0.5rem", marginBottom:"1rem" }}>
          {[["expense","Despesa"],["income","Receita"]].map(([t,l])=>(
            <button key={t} onClick={()=>setForm(f=>({...f,type:t,category:t==="income"?"Salário":"Alimentação"}))} style={{ flex:1, padding:"0.6rem", border:"1px solid", borderColor:form.type===t?"#c8a97e":"#3d342a", borderRadius:"8px", background:form.type===t?"rgba(200,169,126,0.15)":"transparent", color:form.type===t?"#c8a97e":"#8a7a6a", cursor:"pointer", fontSize:"0.85rem", fontFamily:"'Source Sans 3',sans-serif" }}>
              {l}
            </button>
          ))}
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:"0.8rem" }}>
          <div>
            <label style={labelStyle}>Categoria</label>
            <select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))} style={inputStyle}>
              {(form.type==="expense"?EXPENSE_CATEGORIES:INCOME_CATEGORIES).map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Descrição</label>
            <input
              value={form.description}
              onChange={e=>setForm(f=>({...f,description:e.target.value}))}
              placeholder="Ex: Fatura Nubank março"
              style={inputStyle}
              onKeyDown={e=>e.key==="Enter"&&addEntry()}
            />
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.6rem" }}>
            <div>
              <label style={labelStyle}>Valor (R$)</label>
              <input type="number" step="0.01" min="0" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0,00" style={inputStyle} onKeyDown={e=>e.key==="Enter"&&addEntry()}/>
            </div>
            <div>
              <label style={labelStyle}>Data</label>
              <input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} style={inputStyle}/>
            </div>
          </div>
          <button onClick={addEntry} disabled={!form.description||!form.amount||!form.date} style={{ background: (!form.description||!form.amount||!form.date)?"#2a2018":"#c8a97e", color: (!form.description||!form.amount||!form.date)?"#5a4a3a":"#0f0c0a", border:"none", borderRadius:"8px", padding:"0.85rem", fontWeight:"600", cursor:(!form.description||!form.amount||!form.date)?"not-allowed":"pointer", fontSize:"0.9rem", marginTop:"0.4rem", fontFamily:"'Source Sans 3',sans-serif", transition:"all 0.2s" }}>
            Confirmar Lançamento
          </button>
        </div>
      </Modal>
    </div>
  );
}
