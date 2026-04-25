# 💰 Controle Financeiro Pessoal v2

App de controle financeiro pessoal com dashboard, orçamentos por categoria, importação OFX/CSV e tendências mensais.

**Stack:** React + Vite · Vercel Serverless Functions · Vercel Postgres (Neon)

---

## 🚀 Deploy em 5 passos

### 1. Crie o repositório no GitHub
1. Acesse [github.com/new](https://github.com/new)
2. Nome: `financeiro-pessoal` · Privado (recomendado)
3. **Não** inicialize com README (você já tem os arquivos)

```bash
# No terminal, dentro desta pasta:
git init
git add .
git commit -m "feat: controle financeiro v2"
git remote add origin https://github.com/SEU_USUARIO/financeiro-pessoal.git
git push -u origin main
```

---

### 2. Crie o banco de dados na Vercel

1. Acesse [vercel.com](https://vercel.com) e faça login
2. No painel, clique em **Storage** → **Create Database** → **Postgres**
3. Nome: `financeiro-db` → **Create**
4. Vá em **.env.local** e copie as 7 variáveis de ambiente mostradas

---

### 3. Conecte o repositório na Vercel

1. No painel Vercel → **Add New Project** → selecione seu repositório
2. Framework: **Vite** (detectado automaticamente)
3. Em **Environment Variables**, cole as 7 variáveis do passo 2
4. Clique em **Deploy**

---

### 4. Inicialize o banco de dados

Após o deploy, acesse uma vez:

```
https://SEU_APP.vercel.app/api/setup
```

Você verá: `{"ok":true,"message":"Tabelas criadas com sucesso."}`

✅ Pronto! O app está funcionando.

---

### 5. Desenvolvimento local

```bash
# Instale as dependências
npm install

# Baixe as variáveis de ambiente da Vercel
npx vercel link          # conecta ao projeto Vercel
npx vercel env pull      # baixa o .env.local com as credenciais do banco

# Inicie o servidor de desenvolvimento
npm run dev
```

> ⚠️ As funções da API (`/api/*`) só funcionam no deploy da Vercel ou com `npx vercel dev`.
> Em `npm run dev` puro, as chamadas de API retornarão 404. Use `npx vercel dev` para testar a stack completa localmente.

---

## 📁 Estrutura do projeto

```
financeiro-pessoal/
├── api/
│   ├── entries.js     ← CRUD de lançamentos (GET/POST/PUT/DELETE/PATCH)
│   ├── budgets.js     ← CRUD de orçamentos por categoria
│   └── setup.js       ← Inicialização das tabelas (rodar 1x)
├── src/
│   ├── main.jsx       ← Entry point React
│   └── App.jsx        ← Aplicação completa (~820 linhas)
├── index.html         ← Entry point Vite
├── vite.config.js
├── vercel.json
├── package.json
└── .env.example       ← Template de variáveis de ambiente
```

---

## 🔧 Funcionalidades

| Recurso | Descrição |
|---|---|
| **Lançamento manual** | Modal com tipo, categoria, descrição, valor, data, recorrência |
| **Edição inline** | Botão de lápis em cada lançamento — altera qualquer campo incluindo categoria |
| **Exclusão com desfazer** | Confirmação antes de excluir + botão "Desfazer" por 4 segundos |
| **Importar OFX** | Extrato bancário (Bradesco, Itaú, Santander, BB...) com auto-categorização |
| **Importar CSV** | Nubank e CSV genérico (date,desc,amount) |
| **Importar JSON** | Backup do próprio app |
| **Pré-visualização de importação** | Revise e corrija categorias antes de salvar |
| **Exportar JSON** | Backup completo de todos os lançamentos |
| **Dashboard** | KPIs com comparativo mês anterior (↑↓%), pizza com % labels, barras, tabela com barra de progresso |
| **Tendência** | Gráfico de linha com últimos 6 meses |
| **Maior despesa** | Destaque automático do maior gasto do mês |
| **Orçamentos** | Defina limite mensal por categoria com alertas visuais (amarelo ≥80%, vermelho ≥100%) |
| **Filtros** | Por tipo (receita/despesa), busca por texto, ordenação por data/valor/categoria |
| **Recorrentes** | Marque lançamentos como recorrentes (indicado visualmente) |
| **Backend real** | Dados em Postgres na nuvem — acessível de qualquer dispositivo |

---

## 🏦 Formatos de importação suportados

### OFX (extrato bancário)
- Bradesco, Itaú, Santander, Banco do Brasil, Caixa, Nubank
- Exporte pelo internet banking: `Extrato → Exportar → OFX`

### CSV Nubank
- App Nubank → Minha conta → Exportar transações → CSV

### CSV Genérico
- Colunas: `data;descrição;valor` ou `date,description,amount`
- Datas aceitas: `DD/MM/YYYY`, `YYYY-MM-DD`

### JSON
- Backup gerado pelo próprio app (botão Exportar)

---

## 🗄️ Schema do banco de dados

```sql
-- Lançamentos
CREATE TABLE entries (
  id          SERIAL PRIMARY KEY,
  type        VARCHAR(10)    NOT NULL,  -- 'income' | 'expense'
  category    VARCHAR(60)    NOT NULL,
  description TEXT           NOT NULL,
  amount      DECIMAL(12,2)  NOT NULL,
  date        DATE           NOT NULL,
  recurring   BOOLEAN        DEFAULT FALSE,
  created_at  TIMESTAMPTZ    DEFAULT NOW()
);

-- Orçamentos por categoria
CREATE TABLE budgets (
  id            SERIAL PRIMARY KEY,
  category      VARCHAR(60)   NOT NULL UNIQUE,
  monthly_limit DECIMAL(12,2) NOT NULL,
  updated_at    TIMESTAMPTZ   DEFAULT NOW()
);
```

---

## ❓ Problemas comuns

**API retorna 500 após deploy**
→ Verifique se as variáveis de ambiente do Postgres foram adicionadas na Vercel.

**Dados aparecem vazios após deploy**
→ Acesse `/api/setup` uma vez para criar as tabelas.

**Erro ao importar OFX**
→ Certifique-se de exportar no formato OFX (não QIF ou PDF).

**npm run dev não carrega dados**
→ Use `npx vercel dev` para rodar com as funções serverless localmente.
