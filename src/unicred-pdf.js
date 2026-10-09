export function parseUnicredRows(rows, autoCategory = () => "Outros") {
  const full=rows.join("\n");
  const account=/Coop:\s*(\d+)\s*-\s*AG:\s*(\d+)\s*-\s*Conta:\s*(\d+)/i.exec(full);
  if(!account)throw new Error("Conta Unicred não identificada no PDF.");
  const bank="Unicred "+account[1]+" • "+account[2]+" • "+account[3];
  const opening=/Saldo em\s+\d{2}\/\d{2}\/\d{4}:\s*R\$\s*([\d.,]+)/i.exec(full);
  const closing=/Saldo no final do período\s+R\$\s*([\d.,]+)/i.exec(full);
  const cents=v=>Math.round(Number(v.replace(/\./g,"").replace(",","."))*100);
  if(!opening||!closing)throw new Error("Saldos de abertura e fechamento não encontrados.");
  const items=[];
  let pending=null;
  const flush=()=>{
    if(!pending)return;
    const value=/(-?\s*R\$\s*[\d.]+,\d{2})\s+(R\$\s*[\d.]+,\d{2})/.exec(pending.raw);
    if(!value)throw new Error("Movimentação não interpretada em "+pending.date);
    const negative=/^\s*-/.test(value[1]);
    const amount=cents(value[1].replace(/^\s*-/,"").replace(/R\$\s*/,""));
    const balance=cents(value[2].replace(/R\$\s*/,""));
    const description=(pending.raw.slice(0,value.index)+" "+pending.raw.slice(value.index+value[0].length)).replace(/\s+/g," ").trim();
    const [d,m,y]=pending.date.split("/");
    const date=y+"-"+m+"-"+d;
    if(!amount||!description)throw new Error("Movimentação incompleta em "+pending.date);
    items.push({date,description,type:negative?"expense":"income",amount:amount/100,category:autoCategory(description),recurring:false,bank,source_id:"PDF-"+date+"-"+(negative?"D":"C")+"-"+amount+"-"+balance,_balance:balance});
    pending=null;
  };
  for(const row of rows){
    // The statement generation timestamp is a header, not a transaction.
    if(/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?(?:\s|$)/.test(row))continue;
    if(/Lançamentos futuros/i.test(row))break;
    if(/Saldo no final do período/i.test(row)){flush();continue;}
    const start=/^(\d{2}\/\d{2}\/\d{4})\s+(.+)/.exec(row);
    if(start){flush();pending={date:start[1],raw:start[2]};}
    else if(pending && !/^(CENTRAL DE RELACIONAMENTO|0800|Pág\.|Data\s+Lançamentos)/i.test(row))pending.raw+=" "+row;
  }
  flush();
  if(!items.length)throw new Error("Nenhuma movimentação encontrada.");
  let running=cents(opening[1]);
  for(const item of items){
    running+=(item.type==="income"?1:-1)*Math.round(item.amount*100);
    if(running!==item._balance)throw new Error("Divergência no saldo de "+item.date+"; importação bloqueada.");
    delete item._balance;
  }
  if(running!==cents(closing[1]))throw new Error("Saldo final divergente; importação bloqueada.");
  return items;
}
