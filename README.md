# Controle Financeiro Pessoal

Dashboard de controle financeiro pessoal com persistência local, gráficos e importação/exportação de dados.

---

## Deploy no Vercel (gratuito, 5 minutos)

### Passo 1 — Criar conta no GitHub
Se ainda não tiver: https://github.com/signup

### Passo 2 — Criar repositório
1. Acesse https://github.com/new
2. Nome: `financeiro-pessoal`
3. Deixe público ou privado (tanto faz)
4. Clique em **Create repository**

### Passo 3 — Subir os arquivos
No terminal (ou GitHub Desktop):
```bash
cd financeiro
git init
git add .
git commit -m "inicial"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/financeiro-pessoal.git
git push -u origin main
```

### Passo 4 — Deploy no Vercel
1. Acesse https://vercel.com e entre com sua conta GitHub
2. Clique em **Add New → Project**
3. Selecione o repositório `financeiro-pessoal`
4. Clique em **Deploy**
5. Aguarde ~2 minutos

Pronto. Você receberá uma URL como `https://financeiro-pessoal.vercel.app`

---

## Uso

### Lançar despesas/receitas
- Clique em **Lançar**
- Escolha tipo, categoria, descrição, valor e data

### Importar lançamentos (faturas/extratos)
- Use o botão ↑ para importar um arquivo `.json` gerado pelo Claude
- O Claude processa suas faturas de cartão e extratos e gera o JSON pronto para importar

### Exportar backup
- Use o botão ↓ para baixar todos os lançamentos em `.json`
- Guarde este arquivo para backup ou para importar em outro dispositivo

### Navegar por mês/ano
- Use os seletores no topo para filtrar qualquer período

---

## Dados
Os dados ficam salvos no **localStorage** do navegador. São persistentes entre sessões no mesmo navegador/dispositivo. Para usar em outro dispositivo, exporte o backup e importe no novo.
