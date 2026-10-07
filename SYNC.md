# Acesso no computador e no celular

O painel salva lançamentos e orçamentos no mesmo Postgres usado pela Vercel. A atualização ocorre ao voltar à janela, reconectar e a cada 30 segundos enquanto o painel está aberto. O botão Atualizar permite buscar imediatamente. Uma falha mantém os dados exibidos e informa o erro; a confirmação de gravação depende da resposta do servidor.

## Configuração para publicar

1. Mantenha as variáveis de conexão Postgres já existentes na Vercel.
2. Adicione `FINANCE_PASSWORD` nas variáveis de ambiente da Vercel (Production e Preview). Use uma senha forte, exclusiva, com pelo menos 16 caracteres. Nunca use prefixo `VITE_`, nem coloque a senha no código ou em um commit.
3. Publique a alteração. Entre no site com essa senha. Sem a variável, os endpoints de dados ficam bloqueados.
4. Se aparecer erro de tabelas/colunas, clique **Preparar banco**. Isso faz a migração autenticada via POST /api/setup, preservando os lançamentos existentes. Execute também em bancos de Preview separados.
5. Importe o JSON revisado, confira a prévia e confirme. Depois entre com a mesma senha no celular. Os dados vêm do mesmo banco; não é necessário importar em cada aparelho.

## Importação e privacidade

Aceita o JSON do painel (array) e o arquivo revisado (objeto com transactions). Converte datas YYYYMMDD e valores com sinal; mantém categoria, banco, ID de origem, confirmação e reconciliação. Exportação inclui os metadados. IDs do banco de dados são separados dos IDs do extrato.

Uma importação usa um único comando SQL: se houver falha, nenhum item desse lote é gravado. Reimportar o mesmo par banco/ID de origem ignora itens existentes. CSV e arquivos sem esses identificadores não têm deduplicação garantida. Lançamentos antigos sem IDs não são reconciliados automaticamente com novos extratos. A prévia permite manter categorias personalizadas.

A senha autentica uma única conta pessoal compartilhada entre seus aparelhos. Sessão assinada de sete dias em cookie HttpOnly, Secure, SameSite=Strict; trocar a senha invalida as sessões. Não é uma solução para vários usuários. Não há recuperação de senha por email: altere a variável na Vercel e publique novamente. Não coloque extratos, arquivos financeiros ou senhas neste repositório público.

## Validação

`npm install`, `npm run build` e `node --test tests/*.test.js`. Verifique após publicar: login em dois aparelhos, gravação de um lançamento de teste e atualização no outro; reimportação sem duplicar; erro de rede sem mensagem falsa de sucesso. Esses testes de produção dependem do acesso à Vercel e ao banco e não foram executados nesta alteração.
