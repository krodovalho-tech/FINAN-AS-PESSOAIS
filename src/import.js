export function normalizeImport(data) {
  const items = Array.isArray(data) ? data : data?.transactions;
  if (!Array.isArray(items)) throw new Error('O JSON deve conter lançamentos ou transactions.');
  return items.map((e, i) => {
    const amount = Number(e.amount);
    const rawDate = String(e.date || "");
    const date = /^\d{8}$/.test(rawDate) ? `${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}` : rawDate.slice(0,10);
    const reviewed = !Array.isArray(data);
    const entry = { ...e, date, type: reviewed ? (amount >= 0 ? 'income' : 'expense') : e.type,
      amount: Math.abs(amount), description: e.description || e.memo,
      source_id: e.source_id || (reviewed && e.id != null ? String(e.id) : null),
      bank: e.bank || null, confirmed: e.confirmed === true, recurring: !!e.recurring };
    if (!['income','expense'].includes(entry.type) || !Number.isFinite(amount) || amount === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date || '') || !entry.description || !entry.category) throw new Error(`Lançamento ${i+1} inválido. Revise data, valor, descrição e categoria.`);
    if (!entry.notes && e.reconciliation) entry.notes = JSON.stringify(e.reconciliation);
    return entry;
  });
}


export async function detectImportFormat(file) {
  if (!file.size) throw new Error('O arquivo está vazio. Baixe o extrato novamente antes de importar.');
  const header = await file.slice(0, 1024).text();
  if (header.includes('%PDF-')) return 'pdf';
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    throw new Error('O arquivo selecionado não contém um PDF válido. Baixe o extrato novamente.');
  }
  if (/\.(?:ofx|ofc)$/i.test(file.name) || /<(?:OFX|OFC)[\s>]|OFXHEADER:/i.test(header)) return 'ofx';
  if (/\.csv$/i.test(file.name)) return 'csv';
  if (/^[\s\uFEFF]*[\[{]/.test(header)) return 'json';
  throw new Error('Formato não reconhecido. Selecione um extrato PDF da Unicred, OFX, CSV ou JSON.');
}

export function parseImportJSON(content) {
  let data;
  try { data = JSON.parse(content.replace(/^\uFEFF/, '')); }
  catch { throw new Error('O arquivo JSON está incompleto ou inválido. Baixe ou exporte o arquivo novamente.'); }
  return normalizeImport(data);
}


const unicredHeader = ['Data','Horário','Descrição','Valor','Portador','Final do cartão','Valor em dólar','Cotação'];
const invoiceMonths = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

function splitInvoiceRow(line) {
  const fields = line.match(/(?:^|;)(?:"(?:[^"]|"")*"|[^;"]*)/g) || [];
  if (fields.join('') !== line) throw new Error('Linha CSV da Unicred inválida.');
  return fields.map((field,index) => field.slice(index ? 1 : 0).trim().replace(/^"|"$/g,'').replace(/""/g,'"'));
}

export function parseUnicredCardCSV(content, name, categorize) {
  const lines = content.replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim());
  if (!lines[0]?.includes('Final do cartão') || splitInvoiceRow(lines[0]).join(';') !== unicredHeader.join(';')) return null;
  const file = name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const reference = /_([a-z]+)_(\d{4})\.csv$/.exec(file);
  const month = reference ? invoiceMonths.indexOf(reference[1])+1 : 0;
  if (!month) throw new Error('Use o nome original da fatura Unicred, com mês e ano no final.');
  const cycle = reference[2]+'-'+String(month).padStart(2,'0');
  const occurrences = new Map();
  if (lines.length === 1) throw new Error('A fatura Unicred não contém lançamentos.');
  return lines.slice(1).map((line,index)=>{
    const [day,time,description,value,,lastFour] = splitInvoiceRow(line);
    const date = day?.split('/').reverse().join('-');
    const parsedDate = new Date(date);
    const amount = Number(value?.replace(',','.'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0,10)!==date || !/^\d{2}:\d{2}(?::\d{2})?$/.test(time || '') ||
        !description || !/^-?\d+(?:[.,]\d{1,2})?$/.test(value || '') ||
        !Number.isSafeInteger(Math.round(amount*100)) || amount===0 || !/^\d{4}$/.test(lastFour || '')) {
      throw new Error('Confira data, horário, descrição, valor e cartão na linha '+(index+2)+' da fatura Unicred.');
    }
    const part = /\((\d+)\/(\d+)\)\s*$/.exec(description);
    const installment = part ? Number(part[1]) : null;
    const count = part ? Number(part[2]) : null;
    if (part && (installment<1 || count<installment)) throw new Error('Parcela inválida na linha '+(index+2)+' da fatura Unicred.');
    const key = JSON.stringify([cycle,date,time,description,Math.round(amount*100)]);
    const occurrence = (occurrences.get(lastFour+key) || 0)+1;
    occurrences.set(lastFour+key,occurrence);
    return {
      type:amount<0?'income':'expense',amount:Math.abs(amount),date,description,
      category:amount<0?'Cartão de Crédito':categorize(description),recurring:false,
      bank:'Cartão · Unicred '+lastFour,source_id:'unicred-fatura:'+key+':'+occurrence,payment_method:'credit',
      reconciliation:{invoice:{cycle,date,last_four:lastFour,installment,count}},
    };
  });
}
