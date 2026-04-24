# 💰 Controle Financeiro Cloud (Vercel Blob)

Este é um sistema de controle financeiro pessoal simplificado, projetado para rodar na nuvem com sincronização automática entre dispositivos (PC e Celular).

---

## 🚀 Como Funciona
Diferente da versão anterior, este sistema utiliza o **Vercel Blob** para armazenar seus dados. Isso significa que você não precisa mais se preocupar em baixar backups ou perder dados ao trocar de navegador.

### 🛠️ Configuração Inicial (Feita uma única vez)
1. Certifique-se de que o seu `BLOB_READ_WRITE_TOKEN` da Vercel está configurado dentro do arquivo `index.html`.
2. Ao abrir o site pela primeira vez, use o botão **"Importar JSON"** para carregar seu histórico inicial (Janeiro a Abril).
3. Após a primeira importação, o sistema criará um banco de dados na nuvem e o status mudará para **"Sincronizado!"**.

---

## 📱 Uso Diário

### Lançamentos
- O sistema permite visualizar gastos detalhados (explosão de faturas).
- Novas categorias podem ser adicionadas na aba **Categorias**.

### Sincronização
- Tudo o que você fizer no **Computador** aparecerá no **Celular** automaticamente assim que você abrir o link.
- O status **"Conectado"** ou **"Sincronizado"** no topo confirma que seus dados estão salvos com segurança na Vercel.

---

## ⚠️ Segurança
O arquivo `index.html` contém o seu token de acesso. 
- **Privacidade:** Recomendamos manter este repositório como **Privado** no GitHub para que ninguém tenha acesso ao seu banco de dados.

---
*Desenvolvido para ser simples, rápido e eterno.*