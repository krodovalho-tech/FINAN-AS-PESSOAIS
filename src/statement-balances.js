const fold=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const tag=(s,t)=>new RegExp(`<${t}>([^<\\r\\n]+)`,'i').exec(s)?.[1]?.trim();
const isoDay=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
export function statementBank(code,name=''){
 const n=String(code||'').replace(/^0+/,'');
 if(n==='104'||/caixa/.test(fold(name)))return 'Caixa';
 if(n==='136'||/unicred/.test(fold(name)))return 'Unicred';
 return String(name||code||'').trim();
}
export function statementAccount(v){return String(v||'').replace(/[^a-zA-Z0-9]/g,'').replace(/^0+(?=\d)/,'');}
export function statementDate(raw){
 const m=/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?/.exec(raw||'');if(!m)return null;
 const day=`${m[1]}-${m[2]}-${m[3]}`;if(!isoDay(day))return null;
 if(!m[4])return day;
 const offset=/\[([+-]?\d+(?:\.\d+)?):/.exec(raw)?.[1];
 const minutes=offset===undefined?-180:Math.round(Number(offset)*60);
 const zone=`${minutes<0?'-':'+'}${String(Math.floor(Math.abs(minutes)/60)).padStart(2,'0')}:${String(Math.abs(minutes)%60).padStart(2,'0')}`;
 return `${day}T${m[4]}:${m[5]}:${m[6]}${zone}`;
}
const validAmount=v=>{const n=Number(v);return ['string','number'].includes(typeof v)&&String(v??'').trim()!==''&&Number.isFinite(n)&&Math.abs(n)<=1e11&&Math.abs(n*100-Math.round(n*100))<1e-5;};
function checked(snapshot,now){
 const s={...snapshot};const stamp=Date.parse(s.as_of?.length===10?s.as_of+'T00:00:00-03:00':s.as_of);
 if(!s.bank||!s.account||!validAmount(s.balance)||!Number.isFinite(stamp))return null;
 s.balance=Number(s.balance);
 if(stamp>new Date(now).getTime()+60000){s.reported_as_of=s.as_of;s.as_of=null;s.needs_date=true;}
 return s;
}
export function extractStatementBalances(content,{name='',now=new Date()}={}){
 const text=String(content||''),blocks=[...text.matchAll(/<(?:STMTRS|INVSTMTRS)>([\s\S]*?)<\/(?:STMTRS|INVSTMTRS)>/gi)].map(m=>m[1]);
 // OFC keeps ACCTFROM outside STMTRS, so read the surrounding statement for identity.
 const accounts=[...text.matchAll(/<(?:ACCTSTMT|STMTRS|INVSTMTRS)>([\s\S]*?)<\/(?:ACCTSTMT|STMTRS|INVSTMTRS)>/gi)].map(m=>m[1]);
 const statements=accounts.length?accounts:blocks.length?blocks:[text];
 const found=[];
 for(const block of statements){
  const account=statementAccount(tag(block,'ACCTID'));
  const bank=statementBank(tag(block,'BANKID'),tag(block,'ORG')||tag(text,'ORG'));
  const ledger=/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|$)/i.exec(block)?.[1];
  const amount=ledger?tag(ledger,'BALAMT'):tag(block,'LEDGER');
  const as_of=statementDate((ledger&&tag(ledger,'DTASOF'))||tag(block,'DTSERVER')||tag(text,'DTSERVER')||tag(block,'DTEND'));
  if(amount==null)continue;
  const snapshot=checked({bank,account,kind:'checking',balance:amount,as_of,source:name||'Extrato OFX/OFC'},now);
  if(snapshot)found.push(snapshot);
 }
 if(found.length)return found;
 if(/^[\s\uFEFF]*[\[{]/.test(text)){
  try{const data=JSON.parse(text.replace(/^\uFEFF/,''));const balances=data.balances || (data.bank&&data.balance!==undefined?[data]:[]);
   return balances.map(b=>checked({...b,account:statementAccount(b.account),kind:b.kind||'checking',source:name||b.source||'Extrato JSON'},now)).filter(Boolean);
  }catch{return [];}
 }
 return [];
}
export function extractUnicredBalance(rows,{name='',now=new Date()}={}){
 const text=rows.join('\n'),header=rows.slice(0,25).join('\n');
 const identity=/Coop:\s*\d+\s*-\s*AG:\s*\d+\s*-\s*Conta:\s*(\d+)/i.exec(text);
 if(!identity)return [];
 const closing=/Saldo no final do per[ií]odo\s*(?:R\$)?\s*(-?[\d.]+,\d{2})/i.exec(text)||/Saldo atual\s*(?:R\$)?\s*(-?[\d.]+,\d{2})/i.exec(header);
 const issued=/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)/.exec(header);
 const period=/Per[ií]odo de \d{2}\/\d{2}\/\d{4} a (\d{2})\/(\d{2})\/(\d{4})/i.exec(header);
 const as_of=issued?`${issued[3]}-${issued[2]}-${issued[1]}T${issued[4].length===5?issued[4]+':00':issued[4]}-03:00`:period?`${period[3]}-${period[2]}-${period[1]}`:null;
 if(!closing||!as_of)return [];
 const value=checked({bank:'Unicred',account:statementAccount(identity[1]),kind:'checking',balance:Number(closing[1].replaceAll('.','').replace(',','.')),as_of,source:name||'Extrato PDF Unicred'},now);
 return value?[value]:[];
}
