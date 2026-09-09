---
sourceHash: b82ed0c23d6537de
title: Códigos de erro
sidebar_label: Códigos de erro
description: Todos os códigos de erro que um backend Rebase pode retornar, com seu status HTTP, o que significam e o que fazer a respeito — além do envelope de resposta, X-Request-ID e as regras de detalhes.
---

Toda falha retornada por um backend Rebase utiliza um envelope e carrega um
`code` estável. O código é o elemento a ser usado para tomada de decisão no código: a mensagem é escrita para pessoas
e pode ser reformulada, o status é compartilhado por uma dúzia de problemas diferentes, e o
código não é nenhum dos dois.

## O envelope

```json
{
  "error": {
    "message": "Schema drift: table \"posts\" does not exist.",
    "code": "SCHEMA_DRIFT",
    "details": { "dbCode": "42P01" },
    "requestId": "6f1b2f3e-8a0c-4d1b-9c3e-2a5b7c9d1e0f"
  }
}
```

- **`message`** — legível por humanos. Para um `4xx`, é a mensagem do próprio
  servidor; para um `5xx`, é deliberadamente genérica, pois o texto subjacente pode citar
  um host, uma role ou um nome de coluna.
- **`code`** — um dos valores abaixo. Estável entre versões secundárias (minor).
- **`details`** — opcional e nunca garantido. Veja as regras abaixo.
- **`requestId`** — presente sempre que a requisição passou pelo middleware
  de request-ID, o que inclui todas as rotas sob `basePath`.

### `X-Request-ID`

Toda requisição sob `basePath` recebe um ID: o cabeçalho `X-Request-ID` do chamador
quando for um UUID v4 válido; caso contrário, um novo. Ele é retornado no
cabeçalho da resposta como `X-Request-ID`, incluído no envelope de erro como `requestId` e
anexado à linha de log do servidor para essa requisição.

Essa é a chave de correlação. Mencione-a em um relatório de bug e um operador poderá encontrar a
linha de log exata que explica a falha, contendo o motivo que nunca foi
exibido ao cliente.

Enviar o seu próprio ID é a maneira como um trace sobrevive a um salto de rede (hop): um gateway ou um executor de tarefas que
reencaminha o cabeçalho obtém o mesmo ID em todos os serviços que processaram a requisição.
Um valor inválido é ignorado em vez de rejeitado — não vale a pena falhar uma requisição
por causa de um cabeçalho malformado enviado pelo chamador —, portanto, não presuma que o ID enviado é
o ID retornado. Leia o cabeçalho da resposta.

### O que há em `details`

`details` tem finalidade diagnóstica, não contratual. Três regras o regem:

1. **Tudo o que uma rota define explicitamente é sempre retornado.** Esses são os
   erros do próprio chamador descritos precisamente: qual campo de filtro era desconhecido,
   qual relação não permite escrita, qual valor não corresponde ao seu tipo.
2. **Diagnósticos de banco de dados são omitidos em produção.** Quando a falha tem origem
   no Postgres, `details.dbCode` — o SQLSTATE — está sempre presente: ele indica
   a classe do problema e não revela nada sobre os dados. `dbMessage`,
   `detail` e `hint` são adicionados apenas quando `NODE_ENV` não for `production`,
   pois o Postgres inclui o conteúdo das linhas neles. `23505` informa
   `Key (email)=(a@b.c) already exists.`, o que responde "esta pessoa está
   cadastrada?" para qualquer endereço que alguém decida testar.
3. **Nunca tome decisões de código com base em `details`.** Tome decisões com base em `code`. O conteúdo sob
   `details` é o que quer que tenha sido útil para uma pessoa naquele ponto da chamada, e ele muda.

## Interpretando um status

| Status | O que diz sobre a requisição |
| --- | --- |
| `400` | Malformada ou solicitando algo que não existe no esquema. Corrija a requisição. |
| `401` | Não autenticado ou a credencial expirou. Faça login ou renove o token. |
| `403` | Autenticado e não autorizado. Tentar novamente com a mesma identidade não resolverá. |
| `404` | Rota, coleção ou linha inexistente — ou uma linha ocultada pela segurança em nível de linha (RLS). |
| `409` | Um conflito com o estado existente: uma duplicata ou uma gravação concorrente. |
| `413` `415` `422` | O corpo é grande demais, o tipo de mídia está incorreto ou foi rejeitado semanticamente. |
| `429` | Limite de taxa excedido (Rate limited). Aguarde; a mensagem informa por quanto tempo. |
| `500` | O erro está no servidor ou em seu banco de dados, não no chamador. Verifique os logs. |
| `501` | A rota existe, mas esta implantação não pode atendê-la — um recurso desativado ou não configurado. |
| `502` `503` `504` | Uma dependência estava inacessível, não configurada ou demorou demais para responder. |

## Autenticação e contas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | A rota requer um segundo fator e a sessão possui apenas um. | Conclua o desafio de MFA e tente novamente. |
| `ALREADY_VERIFIED` | 400 | O endereço ou fator já foi verificado. | Nada — o estado desejado já é verdadeiro. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | O login anônimo está desativado neste servidor. | Ative-o ou faça login com uma identidade real. |
| `API_KEY_FORBIDDEN` | 403 | Uma chave de API foi utilizada em uma rota que apenas pessoas podem chamar. | Use uma sessão de usuário. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Uma chave de API tentou criar, listar ou revogar chaves de API. | Gerencie as chaves como um administrador autenticado. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Uma rota protegida foi executada sem nenhum middleware de autenticação Rebase antes dela, portanto a credencial do chamador nunca foi analisada. | Monte o aplicativo através do roteador de funções em vez de montá-lo diretamente no seu servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | O bootstrap do primeiro administrador foi tentado por um chamador anônimo. | Faça login primeiro. |
| `BOOTSTRAP_COMPLETED` | 403 | O primeiro administrador já existe. | Peça para um administrador existente conceder a role. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | O bootstrap é apenas para o primeiro usuário de todos, e este não é o caso. | Peça para um administrador existente conceder a role. |
| `CAPTCHA_FAILED` | 400 | O provedor rejeitou o token de CAPTCHA. | Resolva um novo desafio. |
| `CAPTCHA_REQUIRED` | 400 | A rota requer um token de CAPTCHA e nenhum foi enviado. | Inclua o token. |
| `CHALLENGE_EXHAUSTED` | 401 | Muitas tentativas incorretas para um único desafio de MFA. | Inicie um novo desafio. |
| `EMAIL_EXISTS` | 409 | Uma conta com esse endereço já existe. | Faça login ou inicie a redefinição de senha. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic links ou OTP foram solicitados e o servidor não possui transporte de e-mail configurado. | Configure o SMTP ou use outro método de login. |
| `EMAIL_NOT_VERIFIED` | 403 | A conta existe e seu endereço não foi verificado. | Verifique o endereço. |
| `FACTOR_NOT_VERIFIED` | 400 | O fator MFA foi cadastrado, mas nunca confirmado. | Confirme o fator. |
| `IDENTITY_ALREADY_LINKED` | 409 | Essa identidade OAuth pertence a outra conta. | Faça login com ela ou desvincule-a da outra conta primeiro. |
| `INVALID_ACCOUNT` | 400 | A conta está em um estado sobre o qual esta operação não pode atuar. | Veja a mensagem. |
| `INVALID_CHALLENGE` | 400 | O desafio de MFA é desconhecido ou expirou. | Inicie um novo. |
| `INVALID_CODE` | 401 | O código OTP ou MFA está incorreto. | Tente novamente com o código atual. |
| `INVALID_CREDENTIALS` | 401 | E-mail ou senha incorretos — deliberadamente sem especificar qual deles. | Tente novamente ou redefina a senha. |
| `INVALID_TOKEN` | 400 | Um token de verificação, redefinição ou magic link está malformado ou é desconhecido. | Solicite um novo link. |
| `LAST_ADMIN` | 403 | A alteração deixaria o projeto sem nenhum administrador. | Promova outra pessoa primeiro. |
| `MFA_REQUIRED` | 401 | A senha estava correta e a conta possui um segundo fator verificado, portanto o login foi concluído apenas pela metade. `details` traz um token de curta duração com escopo restrito ao desafio de MFA — não é uma sessão. | Abra um desafio e responda a ele; a resposta ao desafio emite a sessão. |
| `NO_SESSION` | 401 | Nenhum cookie de sessão ou refresh token foi apresentado. Normal no primeiro carregamento da página. | Faça login. |
| `NOT_ANONYMOUS` | 400 | Uma rota de upgrade a partir de conta anônima foi chamada por uma conta real. | Nada a atualizar. |
| `OAUTH_ERROR` | 401 | O provedor de OAuth recusou ou retornou um erro. | Tente o fluxo novamente; a mensagem contém o motivo do provedor. |
| `RATE_LIMITED` | 429 | Muitas tentativas feitas por este chamador. | Aguarde; a mensagem informa por quanto tempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | O destino do redirecionamento não está na lista de permissões. | Adicione-o à configuração do provedor. |
| `REGISTRATION_DISABLED` | 403 | O cadastro autônomo está desativado. | Peça a um administrador para criar a conta. |
| `ROLE_EXISTS` | 409 | Esse nome de role já está em uso. | Escolha outro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | As roles não puderam ser lidas para uma requisição restrita a administradores. Falha de forma segura (fails closed) em vez de confiar na claim do próprio token. | Tente novamente; verifique o banco de dados. |
| `SELF_DELETE` | 400 | Um administrador tentou excluir a própria conta. | Peça a outro administrador para fazê-lo. |
| `SESSION_REVOKED` | 401 | A sessão foi encerrada em outro lugar ou todas as sessões foram revogadas. | Faça login novamente. |
| `SETUP_REQUIRED` | 403 | O projeto ainda não possui um administrador, portanto esta rota não está disponível. | Conclua a configuração do primeiro administrador. |
| `TOKEN_ALREADY_USED` | 401 | Um token de uso único foi reutilizado. | Solicite um novo. |
| `TOKEN_EXPIRED` | 401 | O token ultrapassou seu tempo de vida útil. | Solicite um novo. |
| `USER_NOT_FOUND` | 404 | Nenhuma conta encontrada com esse id. | Verifique o id. |
| `WEAK_PASSWORD` | 400 | A senha não atende à política configurada. | Escolha uma senha mais forte. |

## Dados, consultas e gravações

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este driver não consegue calcular a agregação solicitada. | Use um driver compatível ou calcule-a no cliente. |
| `BRANCHING_UNSUPPORTED` | — | Uma ramificação (branch) do banco de dados foi solicitada via websocket do Studio no banco de dados de desenvolvimento gerenciado (PGlite), onde uma branch *é* a origem e nada seria isolado. A recusa é a mesma exibida por `rebase db branch`. | Aponte `DATABASE_URL` para uma instância própria do Postgres (`rebase dev --docker` inicia uma) e ramifique lá. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contém mais operações do que o limite por lote (1000 por padrão). Um lote é uma transação única e mantém seus bloqueios (locks) durante toda a execução. | Envie em partes; a mensagem informa o limite e a sua contagem. |
| `BATCH_UNSUPPORTED` | 400 | O driver deste backend não pode gravar entre coleções de forma atômica, e um loop de gravações individuais não seria atômico nem executado em uma única viagem de ida e volta (round trip). | Envie as gravações como requisições separadas ou como chamadas `/bulk` por coleção. |
| `BULK_TOO_LARGE` | 400 | O corpo da operação em massa excede o limite de itens configurado. | Divida a requisição. |
| `BULK_UNSUPPORTED` | 400 | Esta coleção ou driver não suporta gravações em massa. | Grave as linhas uma por vez. |
| `CALLBACK_REJECTED` | 400 | Um callback de coleção recusou a gravação. Um `throw` lançado de `beforeSave`/`beforeDelete`/`after*` é um 400 contendo a mensagem do próprio autor; um `beforeDelete` que retorna `false` é um 403. `details.stage` identifica qual callback, e `details.path` a coleção. | Leia a mensagem — ela foi escrita por este projeto, não pelo Rebase. |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` foi combinado com `?offset=` ou `?page=`. Um cursor já informa onde a página começa, de modo que um offset adicional pula silenciosamente essa quantidade de linhas após o cursor — uma lacuna invisível para o chamador na resposta. | Use um ou outro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` foi combinado com uma busca textual ou vetorial. Ambas atribuem uma pontuação (score) por linha, de forma que duas linhas nunca são iguais e o `DISTINCT` não agruparia nada — pareceria ter funcionado sem alterar nada. | Remova um dos dois parâmetros. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Uma leitura com `distinct` está ordenada por uma coluna que ela não retorna. Um `SELECT DISTINCT` só pode ser ordenado por colunas presentes em sua lista de seleção, caso contrário as linhas agrupadas não têm uma ordem definida. `details.fields` indica os campos envolvidos. | Adicione esses campos a `?fields=` ou remova-os de `?orderBy=`. |
| `DB_PERMISSION_DENIED` | 500 | O Postgres recusou a instrução (`42501`): uma política de segurança em nível de linha (RLS) negando esta role ou a ausência de um `GRANT`. | Consulte [Solução de problemas](/docs/troubleshooting/). |
| `FIELD_NOT_READABLE` | 400 | Um filtro, `orderBy`, `fields`, `select` de agregação ou `groupBy` referencia um campo que as roles deste chamador não podem ler (`access.read`). Um campo que nenhuma resposta pode conter deve ser um campo que nenhuma consulta possa verificar, caso contrário o valor poderia ser deduzido predicado por predicado. `details.violations` indica cada campo. | Remova o campo da consulta ou obtenha a role necessária. Veja [Acesso a campos](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | O corpo define um campo que as roles deste chamador não podem gravar (`access.write`). O campo é recusado em vez de descartado silenciosamente: uma gravação que ignora um campo reportaria sucesso para uma edição que não ocorreu. `details.violations` indica cada campo. | Remova o campo ou obtenha a role necessária. Um campo que ninguém pode gravar responde com `VALIDATION_EXCLUDED_FIELDS`. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Uma requisição anterior com a mesma `Idempotency-Key` ainda está em execução. | Tente novamente assim que ela terminar. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | A mesma `Idempotency-Key` foi enviada com um corpo diferente. | Use uma nova chave ou envie o corpo original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` definiu uma função diferente de `count`, `sum`, `avg`, `min` ou `max`. | Use uma dessas opções; a mensagem lista as disponíveis. |
| `INVALID_AGGREGATE_SELECT` | 400 | Uma entrada em `?select=` não segue o padrão `fn(field)`, ou uma função diferente de `count()` foi informada sem campo. | Escreva `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_BATCH_BODY` | 400 | Uma operação em `/_batch` não contém `op`, `collection`, `values` ou `id`, referencia uma coleção que este backend não atende ou reutiliza um nome de `ref`. | Veja a mensagem; ela indica o índice da operação. |
| `INVALID_BATCH_REF` | 400 | Um `{ "$ref": "<name>.<field>" }` não referencia nenhuma operação anterior, aponta para a frente ou solicita um campo inexistente na linha referenciada. Apenas referências anteriores são resolvidas. | Defina a operação com `ref` *antes* de referenciá-la. |
| `INVALID_BULK_BODY` | 400 | O corpo da operação em massa não possui o formato esperado. | Envie o array `items` conforme documentado. |
| `INVALID_CONFLICT_TARGET` | 400 | O parâmetro `on_conflict` / `onConflict` de um upsert referencia colunas sem garantia de unicidade, ou as especifica sem `upsert: true`. Caso contrário, o Postgres retornaria 42P10 de dentro de uma transação que já realizou trabalho. | Declare `validation: { unique: true }` ou um índice `unique`; a mensagem lista os alvos válidos existentes. |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` não é `include` nem `only`. O valor é recusado em vez de ignorado: um erro de digitação como `?deleted=true` que ocultasse silenciosamente todas as linhas excluídas pareceria funcionar, respondendo à pergunta oposta. | Envie `include` (ativas e excluídas) ou `only` (apenas excluídas). Omita o parâmetro para apenas linhas ativas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` não é `true` nem `false`. | Envie um desses valores; `1` e `0` também são aceitos. |
| `INVALID_FIELD_OPERATION` | 400 | Um operador `$inc` / `$push` / `$pull` / `$merge` foi usado em um tipo de propriedade incompatível, com um operando de formato incorreto, com dois operadores no mesmo campo, digitado incorretamente ou em uma criação — onde não há valor armazenado anterior para operar. | Consulte [Gravações via REST](/docs/backend/writes/#field-operations); a mensagem indica o campo. |
| `INVALID_FILTER_FIELD` | 400 | O filtro referencia uma propriedade que esta coleção não possui. | Verifique a ortografia em relação à coleção. |
| `INVALID_FILTER_OPERATOR` | 400 | O operador não é suportado por este tipo de propriedade. | Consulte [Consultando dados](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | O valor do filtro não pode ser lido como o tipo da coluna com a qual foi comparado: `?id=eq.abc` em uma chave inteira, um rótulo que não está no enum, um timestamp inválido, um número fora do intervalo do tipo. `details.dbCode` contém o SQLSTATE. | Envie um valor compatível com o tipo da coluna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` não é `true` nem `false`. Qualquer outro valor é recusado em vez de interpretado como "não" — um erro de digitação que faz soft-delete quando o chamador pediu para purgar faz com que ele acredite que os dados foram removidos permanentemente. | Envie `true` ou `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: não é uma lista de caminhos válida ou está aninhado além da profundidade máxima. Tratado na borda em vez de escapar do driver como um erro 500. | Veja a mensagem; ela indica o caminho problemático. |
| `INVALID_INPUT` | 400 | O corpo da requisição falhou na validação. | Veja a mensagem. |
| `INVALID_LIMIT` | — | Uma assinatura em tempo real solicitou um limite fora do intervalo permitido. Retornado como um frame `ERROR` de WebSocket, não como uma resposta HTTP. | Diminua o limite. |
| `INVALID_LOGICAL_GROUP` | 400 | Um grupo `?or=` / `?and=` está malformado ou aninhado além da profundidade permitida. | Veja a mensagem; ela mostra a regra de achatamento (flattening). |
| `INVALID_OFFSET` | 400 | `?offset=` não é um número inteiro maior ou igual a 0. | Envie um inteiro não negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` não é `field`, `field:desc` ou um array JSON de `{ field, direction }`. | Veja a mensagem; ela mostra os três formatos válidos. |
| `INVALID_PAGE` | 400 | `?page=` não é um número inteiro maior ou igual a 1. As páginas têm base 1, portanto `?page=0` é um erro e não a primeira página. | Envie `1` ou superior, ou use `?offset=`. |
| `INVALID_PARAM` | 400 | Um parâmetro de consulta está malformado. | Veja a mensagem. |
| `INVALID_VECTOR` | 400 | `?vector=` não é um array JSON de números. | Envie `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` não é `cosine`, `l2` nem `inner_product`. | Use uma dessas três opções. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` não é um número. | Envie um número. |
| `INVALID_WHERE` | 400 | `?where=` não é um objeto JSON mapeando campos para condições. | Envie `{"status":["==","active"]}`. |
| `MISSING_AGGREGATE_SELECT` | 400 | A rota de agregação foi chamada sem `?select=`. | Adicione um parâmetro, por exemplo `?select=count()`. |
| `NO_COLLECTIONS` | 404 | O projeto não serve nenhuma coleção: nenhuma declarada no código e nenhuma tabela para derivá-las. | Crie tabelas — via migração, SQL ou um arquivo de coleção mais `rebase db push` — e reinicie. |
| `NOT_FOUND` | 404 | Nenhuma linha com esse id encontrada nessa coleção — ou trata-se de uma linha ocultada deste chamador pela segurança em nível de linha. | Verifique o id e, em seguida, as `securityRules` da coleção. |
| `UNKNOWN_RELATION` | 400 | `?include=` referencia algo que não é uma relação na coleção. O mesmo código responde com **404** quando um *caminho de URL* aninhado a referencia, por exemplo `/api/data/authors/1/posts` onde `authors` não declara nenhuma relação — nesse caso a URL não aponta para nada, sendo um recurso não encontrado em vez de requisição malformada. | Verifique o nome da relação — a mensagem lista as relações existentes na coleção. Uma referência inversa precisa estar declarada no elemento pai para ser navegável. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | A ordenação referencia uma propriedade que não permite ordenação. | Ordene por uma propriedade mapeada para coluna. |
| `PAYLOAD_TOO_LARGE` | 413 | O corpo excede o limite configurado. | Envie menos dados ou aumente o limite. |
| `READ_ONLY_TRANSACTION` | 409 | Um callback `afterRead` tentou realizar uma gravação. Uma leitura vinculada à requisição executa em uma transação `READ ONLY`, portanto nem o callback nem nada chamado por ele pode gravar. | Mova a gravação para fora da leitura: um job em segundo plano ou `rebase.dataAsAdmin` a partir de um cron job ou função customizada. |
| `RELATION_MISCONFIGURED` | 500 | Uma relação não resolve em relação ao esquema registrado. A operação é recusada em vez de ignorada: descartá-la reportaria sucesso para uma gravação que nunca ocorreu ou um resultado vazio para linhas existentes. | Execute `rebase schema generate` se o esquema gerado for mais antigo do que o banco de dados. |
| `RELATION_NOT_UNLINKABLE` | 400 | A relação não pode ser desvinculada a partir deste lado. | Realize a gravação a partir do lado proprietário da relação. |
| `RELATION_NOT_WRITABLE` | 400 | O caminho aninhado não é uma relação que permite escrita. | Consulte [Relações](/docs/collections/relations/). |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Uma gravação de relação não possuía a chave de origem para vincular a associação. | Salve a linha pai primeiro. |
| `SCHEMA_DRIFT` | 500 | Uma tabela ou coluna esperada pelo código não existe no banco de dados. | Execute `rebase db push` em desenvolvimento; faça novo deploy em um tenant gerenciado. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` foi combinado com `orderBy: "_score"`. A relevância é calculada por consulta em vez de armazenada, portanto não pode servir como chave para um cursor. | Pagine a relevância com `limit`/`offset` ou ordene por uma coluna. |
| `TENANT_IMMUTABLE` | 400 | Uma gravação moveria uma linha de um tenant para outro. Uma linha não pode mudar de tenant. `details.violations` indica o campo. | Crie a linha no outro tenant e exclua esta, ou realize a gravação com uma role presente em `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | A gravação indica um tenant ao qual este chamador não pertence; o banco de dados também a recusaria. | Grave em um tenant ao qual o chamador pertença ou autentique-se como um usuário que pertença a ele. |
| `TENANT_REQUIRED` | 400 | A coleção possui escopo de tenant e o tenant não pôde ser inferido: a requisição não contém nenhum ou o chamador pertence a vários. | Envie o campo de tenant explicitamente ou autentique-se como um chamador associado a exatamente um tenant. |
| `UNKNOWN_FIELD` | 400 | `?fields=` referencia um campo que a coleção não possui. | Verifique a ortografia; a mensagem lista os campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Uma agregação ou `groupBy` referencia um campo que a coleção não possui. | Verifique a ortografia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | O filtro referencia um campo que esta coleção — ou o alvo de uma relação — não possui. | Verifique a ortografia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | O filtro especifica um operador inexistente. | A mensagem lista todos os operadores disponíveis. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | A ordenação referencia um campo que esta coleção não possui. | Verifique a ortografia; a mensagem lista os campos válidos. |
| `PRECONDITION_FAILED` | 412 | Um cabeçalho `If-Match` indicou uma versão da linha que não é mais a atual: alguém a modificou entre a leitura e esta gravação. Nada foi gravado. | Leia a linha novamente, reaplique a alteração e envie o novo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita um campo que a coleção não possui. | Verifique a ortografia; a mensagem lista os campos conhecidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Uma busca vetorial referenciou uma propriedade que não é do tipo `vector` nesta coleção. | A mensagem lista as propriedades vetoriais da coleção. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | O `Content-Type` não é aceito por esta rota. | Envie o tipo documentado para a rota. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | O filtro atravessa uma relação `via`, cujo caminho de junção (join) foi configurado apenas em uma direção, de modo que não há como correlacionar uma subconsulta de volta. | Filtre a partir do lado proprietário. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | O operador não está definido para esse campo: uma relação sem coluna nesta linha é filtrada por pertinência/associação, e a correspondência sem diferenciação de maiúsculas/minúsculas aplica-se apenas a texto. | Veja a mensagem; ela lista o que o campo aceita. |
| `VALIDATION_CONSTRAINT` | 400 | Um valor violou uma regra de `validation` declarada pela propriedade — tamanho, intervalo, padrão regex, campo obrigatório. | Veja a mensagem; ela indica cada violação. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | O corpo tenta gravar uma coluna marcada com `excludeFromApi` ou `access: { write: [] }` — a mesma regra, duas formas de declarar. Esses campos são definidos apenas pelo servidor: hash de senha, token de verificação. Ao contrário de `FIELD_NOT_WRITABLE`, esta resposta é idêntica para qualquer chamador, incluindo `admin`. | Remova o campo. Consulte [Acesso a campos](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Um valor não é compatível com o tipo de sua propriedade. | Veja a mensagem; ela indica a propriedade. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | O corpo referencia um campo que a coleção não possui — incluindo um argumento `id` em uma coleção cuja chave primária é outro campo. | Verifique a ortografia; a mensagem lista os campos conhecidos. |
| `WRITE_DENIED` | 403 | Uma regra de segurança ou política de segurança em nível de linha (RLS) recusou a gravação. | Verifique as `securityRules` da coleção. |

## `PG_<SQLSTATE>` — uma restrição recusada pelo banco de dados

Uma gravação rejeitada pelo Postgres por um motivo relacionado aos *dados do chamador*
retorna com o SQLSTATE no código: `PG_23505`, `PG_23503`, e assim por diante. Essa é uma
família de erros, não uma lista estática — o Postgres define centenas de SQLSTATEs —, mas apenas duas
classes chegam a esse ponto, pois somente essas duas decorrem de falhas do chamador:

- **classe 23**, violação de restrição de integridade: duplicata, chave estrangeira que
  aponta para nada, coluna NOT NULL deixada em branco;
- **classe 22**, exceção de dados: um valor que o tipo da coluna não suporta.

Tudo o mais — conexão perdida, coluna ausente, problema de privilégios —
é responsabilidade do servidor e permanece como `500`. Portanto, `code.startsWith("PG_")` é um teste
seguro para "a linha que enviei estava incorreta", e os quatro códigos abaixo são os que o cliente
costuma encontrar na prática. `details.dbCode` traz o mesmo SQLSTATE para todos eles, e
a mensagem informa o nome da restrição.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Um valor não pôde ser lido como o tipo da coluna — o equivalente no lado da gravação para `INVALID_FILTER_VALUE`. | Envie um valor compatível com o tipo da coluna. |
| `PG_23502` | 400 | Uma coluna `NOT NULL` foi deixada vazia. | Envie o campo ou defina um valor padrão (default) para a coluna. |
| `PG_23503` | 400 | Uma chave estrangeira aponta para uma linha inexistente. | Crie a linha de destino primeiro ou corrija o id. |
| `PG_23505` | 409 | Uma restrição de unicidade (unique) foi violada. A mensagem informa a restrição violada. | Use um valor diferente ou atualize a linha existente. |

## Armazenamento (Storage)

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_STORAGE_BUCKET` | 400 | O nome do bucket está malformado. | Verifique o nome. |
| `INVALID_STORAGE_KEY` | 400 | A chave do objeto está malformada ou escapa de seu prefixo. | Verifique a chave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Os parâmetros de transformação de imagem estão fora do intervalo ou são contraditórios. | Consulte [Armazenamento](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | O upload excede o `maxSize` declarado na propriedade de destino. Validado no servidor, não apenas no navegador. `details` informa a propriedade, o limite e o tamanho real. | Envie um arquivo menor ou aumente o `maxSize` na propriedade. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | O tipo do arquivo enviado não está listado no `acceptedFiles` da propriedade. `details` informa a propriedade, a lista aceita e o content-type enviado. | Envie um tipo aceito ou amplie o `acceptedFiles`. |
| `STORAGE_NOT_CONFIGURED` | 503 | Nenhum backend de armazenamento está configurado neste servidor. | Configure S3, GCS ou armazenamento local. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | A fonte de armazenamento está declarada, mas não possui credenciais configuradas aqui. | Defina as variáveis de ambiente dessa fonte. |
| `STORAGE_WRITE_FAILED` | 502 | O backend de armazenamento recusou ou interrompeu a gravação. | Verifique os logs e credenciais do próprio serviço de armazenamento. |
| `TRANSFORM_OVERLOADED` | 503 | Há muitas transformações de imagem em andamento simultaneamente. | Tente novamente; considere colocar uma CDN à frente. |
| `UNKNOWN_STORAGE_SOURCE` | 400 | A requisição indicou uma fonte de armazenamento (`?storageId=`) que este projeto não declara. Um `bucket` que esta implantação não atende retorna o mesmo código em **404** — o repositório é o que está ausente, e `details` informa os buckets e fontes existentes. Ambos costumavam retornar como "arquivo não encontrado", idêntico a uma chave que simplesmente não existe. | Declare a fonte em `config/resources.ts` ou consulte `GET /api/storage/sources`. |

## Funções customizadas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nenhuma função com esse nome é servida — ou ela existe, mas suas próprias rotas não cobrem o caminho posterior. Um chamador autenticado também é informado sobre o que *é* servido; um chamador anônimo não recebe essa informação, pois a lista representa um inventário de todos os endpoints customizados. Se um arquivo com esse nome falhou ao carregar, a mensagem explicita isso: essa é a diferença entre um erro de digitação e uma implantação com falhas. | Verifique o nome com `GET /api/functions` ou consulte os logs de inicialização para identificar arquivos que não puderam ser carregados. |
| `FUNCTION_TIMEOUT` | 504 | O handler excedeu o tempo limite (timeout). Ele continua em execução; não pode ser cancelado a partir daqui. | Passe um `AbortSignal` para chamadas externas ou aumente `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este processo atua como proxy de funções para outro, que não respondeu. | Verifique se o serviço de funções está em execução. |

## Superfícies de administração e edição de esquema

Estes códigos indicam que um recurso está desativado ou não configurado, e não que a requisição
estava incorreta. Cada um também é reportado na rota correspondente `/status` com status `200`,
permitindo que um painel desabilite visualmente o recurso em vez de exibir um erro.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Uma interface exclusiva para administradores foi chamada em um servidor sem autenticação configurada, impossibilitando distinguir um administrador de um usuário qualquer. | Defina `auth.jwtSecret` ou passe um `AuthAdapter`. |
| `CONTRACT_UNAVAILABLE` | 404 | O contrato do projeto é servido apenas quando a autenticação está configurada — ele descreve cada tabela e relação. | Configure a autenticação. `/meta/schema-version` é sempre servido. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nenhuma caixa de e-mail de desenvolvimento está ativa. As mensagens só são capturadas quando `SMTP_HOST` não estiver definido e `NODE_ENV` não for production. | Remova a definição de `SMTP_HOST` em desenvolvimento ou consulte a caixa de entrada real. |
| `INVALID_CHANGE` | 400 | A alteração de esquema proposta não está bem formatada. | Veja a mensagem. |
| `SCHEMA_CHANGE_FAILED` | 400 | A aplicação de uma alteração de esquema planejada falhou por um motivo não coberto por códigos mais específicos. | Veja a mensagem; ela traz a falha subjacente na íntegra. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | A alteração é válida, mas não pode ser aplicada ao esquema em seu estado atual. | Veja a mensagem. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | O repositório possui alterações não commitadas, impedindo que a edição seja aplicada com segurança. | Faça commit ou stash e tente novamente. |
| `SCHEMA_EDIT_REFUSED` | 400 | O editor de esquema recusou a alteração. | Veja a mensagem; trata-se da recusa gerada pelo próprio editor. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Uma chave de API ou outro agente automatizado tentou aplicar uma alteração de esquema. | Faça login como usuário humano ou defina `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | A edição de esquema ao vivo precisa de `collectionsDir` ou `liveSchema.repository`, e este servidor foi iniciado sem nenhum dos dois. | Configure um deles. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | O planejamento funciona; não há repositório para commitar a alteração. | Configure `liveSchema.repository`. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este driver não suporta o planejamento de alterações de esquema. | A edição em tempo real está disponível no Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | As coleções são inspecionadas a partir do banco de dados neste ambiente, portanto não há arquivos-fonte para editar. | Altere o esquema por meio de uma migração. |
| `SCHEMA_EDITOR_DISABLED` | 501 | O editor de esquema está desativado para este servidor. | Ative-o com `schemaEditor`. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | O editor de esquema precisa do pacote `ts-morph`, que não está instalado. | Execute `pnpm add -D ts-morph@28.0.0`. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | O servidor não possui `collectionsDir`, portanto o editor não tem onde gravar. | Defina `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | O editor fica desativado sob `NODE_ENV=production`: os arquivos de um servidor em produção são reconstruídos a partir do seu repositório a cada deploy, portanto uma alteração feita aqui seria descartada. | Edite as coleções em desenvolvimento e faça o deploy. |

## Códigos genéricos

Uma rota utiliza um destes códigos quando nenhum outro mais específico for aplicável.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Requisição malformada, sem código mais específico aplicável. | Veja a mensagem. |
| `UNAUTHORIZED` | 401 | Não autenticado ou a credencial foi rejeitada. | Faça login ou renove o token. |
| `FORBIDDEN` | 403 | Autenticado e não autorizado. | Tentar novamente com a mesma identidade não resolverá. |
| `CONFLICT` | 409 | Um conflito com o estado existente. | Veja a mensagem. |
| `INTERNAL_ERROR` | 500 | Ocorreu uma falha no servidor. A mensagem é genérica por padrão de segurança. | Mencione o `requestId`; o motivo detalhado está nos logs. |
| `NOT_CONFIGURED` | 503 | Uma dependência necessária para esta rota não está configurada neste servidor. | Veja a mensagem. |
| `SERVICE_UNAVAILABLE` | 503 | Uma dependência estava inacessível. | Tente novamente; verifique os logs. |

## Mantendo esta página precisa

O comando `pnpm verify:docs` falha quando um código que o servidor pode gerar está ausente destas
tabelas, quando uma tabela lista um código que nada pode disparar, quando um status declarado
diverge do código-fonte ou quando uma família de códigos como `PG_<SQLSTATE>` não possui uma linha
para um SQLSTATE que os chamadores encontram. Essa verificação é executada em
`tooling/scripts/docs-verify/check-error-codes.mjs`.

O script valida a si mesmo primeiro. A varredura extrai códigos do TypeScript em vez de inspecionar
um servidor em execução, portanto seus pontos cegos seriam silenciosos por definição: em uma ocasião,
ele não conseguia detectar um código passado por um wrapper de linha única ou escrito após uma mensagem
contendo `)`, relatando que "todos os códigos geráveis pelo servidor estão documentados"
em uma página que omitia dezessete deles. Por isso, o verificador executa um teste contendo exatamente
esses padrões estruturais antes de ler esta página e se recusa a emitir qualquer relatório se não puder detectá-los.

---
