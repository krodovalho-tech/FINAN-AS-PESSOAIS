# Diário Nutricional (módulo independente)
Acesse `/nutricao.html` após publicar a branch. A tela usa a mesma sessão autenticada do financeiro e a tabela exclusiva `nutrition_meals`, criada no primeiro acesso à API.

## API
- `GET /api/nutrition?date=YYYY-MM-DD` — listar dia.
- `POST /api/nutrition` — registrar {date, meal, description, calories, protein, carbs, fat, source_id?}.
- `PUT /api/nutrition?id=123` — corrigir registro.
- `DELETE /api/nutrition?id=123` — excluir registro.
- source_id opcional é único para evitar reenvios duplicados; retorna HTTP 409 se repetido.
- Não cria ou altera entradas financeiras.

## Limitações
Valores nutricionais são estimativas inseridas pelo usuário; reconhecimento automático de foto/voz e integração direta com ChatGPT ainda não fazem parte deste módulo. Não houve importação automática de refeições antigas. A publicação depende de aprovação/merge e acesso à Vercel.
