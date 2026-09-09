---
sourceHash: ffb0a0aaabda1c4c
title: Códigos de erro
sidebar_label: Códigos de erro
description: Todos os códigos de erro que um backend Rebase pode retornar, com seu status HTTP, o que significam e o que fazer a respeito — além do envelope de resposta, X-Request-ID e as regras de details.
---

Toda falha retornada por um backend Rebase usa um único envelope e contém um
`code` estável. O código é o elemento sobre o qual ramificar a lógica: a mensagem
é escrita para pessoas e pode ser reformulada, o status é compartilhado por uma
dúzia de problemas diferentes, e o código não é nenhum dos dois.

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

- **`message`** — legível por humanos. Para um `4xx`, é a própria mensagem do
  servidor; para um `5xx`, é deliberadamente genérica, pois o texto subjacente pode
  citar um host, uma role ou um nome de coluna.
- **`code`** — um dos valores abaixo. Estável entre versões secundárias (minor).
- **`details`** — opcional e nunca garantido. Veja as regras abaixo.
- **`requestId`** — presente sempre que a requisição passou pelo middleware de
  request-ID, o que inclui todas as rotas sob `basePath`.

### `X-Request-ID`

Toda requisição sob `basePath` recebe um ID: o cabeçalho `X-Request-ID` do
chamador quando for um UUID v4 válido, ou um novo caso contrário. Ele é retornado
na resposta como `X-Request-ID`, incluído no envelope de erro como `requestId` e
anexado à linha de log do servidor para essa requisição.

Essa é a chave de junção. Cite-a em um relatório de bug e um operador poderá
encontrar a linha de log exata que explica a falha, trazendo o motivo que nunca
foi exibido ao cliente.

Enviar o seu próprio é a forma como um rastreamento sobrevive a um salto (hop):
um gateway ou um executor de jobs que encaminha o cabeçalho obtém um único ID em
todos os serviços que processaram a requisição. Um valor inválido é ignorado em
vez de rejeitado — não vale a pena falhar uma requisição por causa de um cabeçalho
malformado vindo do chamador —, portanto, não presuma que o ID enviado é o ID
recebido. Leia o cabeçalho da resposta.

### O que há em `details`

`details` tem finalidade diagnóstica, não contratual. Três regras o regem:

1. **Qualquer coisa que uma rota defina explicitamente é sempre retornada.** São
   os próprios erros do chamador descritos com precisão: qual campo de filtro era
   desconhecido, qual relação não é gravável, qual valor não correspondeu ao seu tipo.
2. **Diagnósticos do banco de dados são omitidos em produção.** Quando a falha
   veio do Postgres, `details.dbCode` — o SQLSTATE — está sempre presente: ele
   nomeia a classe do problema e não revela nada sobre os dados. `dbMessage`,
   `detail` e `hint` são adicionados apenas quando `NODE_ENV` não for `production`,
   porque o Postgres inclui conteúdos de linhas neles. `23505` reporta
   `Key (email)=(a@b.c) already exists.`, o que responde à pergunta "essa pessoa está
   registrada?" para qualquer endereço que alguém tente consultar.
3. **Nunca faça ramificações condicionais com base em `details`.** Ramifique com base
   em `code`. O que está em `details` é simplesmente o que foi útil para uma pessoa
   naquele local de chamada, e isso muda.

## Lendo um status

| Status | O que ele diz sobre a requisição |
| --- | --- |
| `400` | Malformada, ou solicitando algo que não existe no schema. Corrija a requisição. |
| `401` | Não autenticado, ou a credencial expirou. Faça login ou renove a sessão. |
| `403` | Autenticado, mas não permitido. Tentar novamente com a mesma identidade não ajudará. |
| `404` | Rota, coleção ou linha inexistente — ou uma linha oculta por segurança em nível de linha (row-level security). |
| `409` | Um conflito com o estado existente: uma duplicata ou uma gravação concorrente. |
| `413` `415` `422` | O corpo é grande demais, tipo de mídia incorreto ou semanticamente rejeitado. |
| `429` | Limite de taxa atingido (rate limited). Reduza o ritmo; a mensagem informa por quanto tempo. |
| `500` | O erro está no servidor ou no banco de dados, não no chamador. Verifique os logs. |
| `501` | A rota existe, mas esta implantação não pode atendê-la — um recurso desativado ou não configurado. |
| `502` `503` `504` | Uma dependência estava inacessível, não configurada ou muito lenta. |

## Autenticação e contas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | A rota requer um segundo fator e a sessão possui apenas um. | Conclua o desafio de MFA e tente novamente. |
| `ALREADY_VERIFIED` | 400 | O endereço ou fator já foi verificado. | Nada — o estado desejado já é verdadeiro. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | O login anônimo está desativado neste servidor. | Ative-o ou faça login com uma identidade real. |
| `API_KEY_FORBIDDEN` | 403 | Uma chave de API foi usada em uma rota que apenas pessoas podem chamar. | Use uma sessão de usuário. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Uma chave de API tentou criar, listar ou revogar chaves de API. | Gerencie chaves como um administrador autenticado. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Uma rota protegida foi executada sem nenhum middleware de autenticação do Rebase antes dela, portanto a credencial do chamador nunca foi analisada. | Monte o app através do roteador de funções em vez de diretamente no seu próprio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | A inicialização do primeiro administrador foi tentada por um chamador anônimo. | Faça login primeiro. |
| `BOOTSTRAP_COMPLETED` | 403 | O primeiro administrador já existe. | Peça a um administrador existente para conceder a role. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | O bootstrap é apenas para o primeiríssimo usuário, e este não é ele. | Peça a um administrador existente para conceder a role. |
| `CAPTCHA_FAILED` | 400 | O provedor rejeitou o token de CAPTCHA. | Resolva um novo desafio. |
| `CAPTCHA_REQUIRED` | 400 | A rota requer um token de CAPTCHA e nenhum foi enviado. | Inclua o token. |
| `CHALLENGE_EXHAUSTED` | 401 | Tentativas incorretas em excesso para um mesmo desafio de MFA. | Inicie um novo desafio. |
| `EMAIL_EXISTS` | 409 | Já existe uma conta com esse endereço de e-mail. | Faça login ou inicie a redefinição de senha. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic links ou OTP foram solicitados, mas o servidor não tem transporte de e-mail. | Configure o SMTP ou use outro método de autenticação. |
| `EMAIL_NOT_VERIFIED` | 403 | A conta existe e seu endereço de e-mail não foi verificado. | Verifique o endereço. |
| `FACTOR_NOT_VERIFIED` | 400 | O fator de MFA foi registrado, mas nunca confirmado. | Confirme o fator. |
| `IDENTITY_ALREADY_LINKED` | 409 | Essa identidade OAuth pertence a outra conta. | Faça login com ela ou desvincule-a de lá primeiro. |
| `INVALID_ACCOUNT` | 400 | A conta está em um estado no qual esta operação não pode atuar. | Veja a mensagem. |
| `INVALID_CHALLENGE` | 400 | O desafio de MFA é desconhecido ou expirou. | Inicie um novo. |
| `INVALID_CODE` | 401 | O código OTP ou MFA está incorreto. | Tente novamente com o código atual. |
| `INVALID_CREDENTIALS` | 401 | E-mail ou senha incorretos — deliberadamente sem informar qual dos dois. | Tente novamente ou redefina a senha. |
| `INVALID_TOKEN` | 400 | Um token de verificação, redefinição ou magic link está malformado ou é desconhecido. | Solicite um novo link. |
| `LAST_ADMIN` | 403 | A alteração deixaria o projeto sem nenhum administrador. | Promova outro usuário primeiro. |
| `MFA_REQUIRED` | 401 | A senha estava correta e a conta possui um segundo fator verificado, portanto a autenticação está concluída apenas pela metade. `details` carrega um token de curta duração com escopo para o desafio de MFA — não é uma sessão. | Abra um desafio e responda-o; a resposta ao desafio emitirá a sessão. |
| `NO_SESSION` | 401 | Nenhum cookie de sessão ou refresh token foi apresentado. Comum no primeiro carregamento de página. | Faça login. |
| `NOT_ANONYMOUS` | 400 | Uma rota de upgrade a partir de anônimo foi chamada por uma conta real. | Nada a atualizar. |
| `OAUTH_ERROR` | 401 | O provedor OAuth recusou ou retornou um erro. | Tente o fluxo novamente; a mensagem informa o motivo do provedor. |
| `RATE_LIMITED` | 429 | Tentativas em excesso a partir deste chamador. | Reduza o ritmo; a mensagem informa por quanto tempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | O destino do redirecionamento não está na lista de permissões. | Adicione-o à configuração do provedor. |
| `REGISTRATION_DISABLED` | 403 | O cadastro autônomo está desativado. | Peça a um administrador para criar a conta. |
| `ROLE_EXISTS` | 409 | Esse nome de role já está em uso. | Escolha outro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Não foi possível ler as roles para uma requisição restrita a administradores. Falha fechada em vez de confiar na claim do próprio token. | Tente novamente; verifique o banco de dados. |
| `SELF_DELETE` | 400 | Um administrador tentou excluir a própria conta. | Peça a outro administrador para fazer isso. |
| `SESSION_REVOKED` | 401 | A sessão foi encerrada em outro lugar ou todas as sessões foram revogadas. | Faça login novamente. |
| `SETUP_REQUIRED` | 403 | O projeto ainda não tem nenhum administrador, portanto esta rota não está disponível. | Conclua a configuração do primeiro administrador. |
| `TOKEN_ALREADY_USED` | 401 | Um token de uso único foi reutilizado. | Solicite um novo. |
| `TOKEN_EXPIRED` | 401 | O token ultrapassou seu tempo de vida útil. | Solicite um novo. |
| `USER_NOT_FOUND` | 404 | Nenhuma conta com esse ID. | Verifique o ID. |
| `WEAK_PASSWORD` | 400 | A senha não atende à política configurada. | Escolha uma senha mais forte. |

## Dados, consultas e gravações

<span class="since-badge" data-since="0.20">Desde 0.20</span>

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este driver não consegue calcular a agregação solicitada. | Use um driver compatível ou calcule-a no cliente. |
| `BRANCHING_UNSUPPORTED` | — | Uma ramificação do banco de dados foi solicitada pelo WebSocket do Studio no banco de dados gerenciado de desenvolvimento (PGlite), onde um branch *é* o pai e nada seria isolado. A recusa é a mesma exibida por `rebase db branch`. | Aponte `DATABASE_URL` para uma instância própria do Postgres (`rebase dev --docker` inicia uma) e ramifique lá. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contém mais operações do que o limite por lote (1000 por padrão). Um lote é uma única transação e retém seus bloqueios durante todo o processo. | Envie em partes; a mensagem informa o limite e a sua contagem. |
| `BATCH_UNSUPPORTED` | 400 | O driver deste backend não suporta gravações atômicas entre coleções, e um loop de gravações individuais não seria atômico nem executado em uma única viagem de ida e volta (round trip). | Envie as gravações como requisições separadas ou como chamadas `/bulk` por coleção. |
| `BULK_TOO_LARGE` | 400 | O corpo da operação em massa excede o limite configurado de itens. | Divida a requisição. |
| `BULK_UNSUPPORTED` | 400 | Esta coleção ou driver não oferece suporte a gravações em massa. | Grave as linhas uma a uma. |
| `CALLBACK_REJECTED` | 400 | Um callback de coleção recusou a gravação. Um `throw` originado em `beforeSave`/`beforeDelete`/`after*` resulta em um 400 com a mensagem do próprio autor; um `beforeDelete` que retorna `false` resulta em 403. `details.stage` identifica qual callback, e `details.path`, a coleção. | Leia a mensagem — ela foi escrita por este projeto, não pelo Rebase. |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` foi combinado com `?offset=` ou `?page=`. Um cursor já indica onde a página começa; portanto, um deslocamento aplicado sobre ele pula silenciosamente essa quantidade de linhas após o cursor — uma lacuna que o chamador não consegue visualizar na resposta. | Use um ou o outro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` foi combinado com uma busca textual ou consulta vetorial. Ambas atribuem uma pontuação individual por linha, de forma que duas linhas nunca são iguais e `DISTINCT` não agruparia nada — pareceria que funcionou, mas não mudaria nada. | Remova um dos dois. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Uma leitura `distinct` está ordenada por uma coluna que ela não retorna. Um `SELECT DISTINCT` só pode ser ordenado por colunas presentes em sua lista de seleção; caso contrário, as linhas que ele agrupa não têm uma ordem definida. `details.fields` indica quais são. | Adicione esses campos a `?fields=` ou remova-os de `?orderBy=`. |
| `DB_PERMISSION_DENIED` | 500 | O Postgres recusou a instrução (`42501`): uma política de segurança em nível de linha negando esta role ou um `GRANT` ausente. | Consulte a [Solução de problemas](/docs/troubleshooting/). |
| `FIELD_NOT_READABLE` | 400 | Um filtro, `orderBy`, `fields`, `select` de agregação ou `groupBy` especifica um campo que as roles deste chamador não podem ler (`access.read`). Um campo que nenhuma resposta pode conter precisa ser um campo que nenhuma consulta possa interrogar, caso contrário o valor poderia ser lido predicado por predicado. `details.violations` indica cada campo. | Remova o campo da consulta ou obtenha a role necessária. Consulte [Acesso a campos](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | O corpo define um campo que as roles deste chamador não podem gravar (`access.write`). O campo é recusado em vez de descartado: uma gravação que descarta um campo reportaria sucesso para uma edição que não ocorreu. `details.violations` indica cada campo. | Remova o campo ou obtenha a role necessária. Um campo que ninguém pode gravar retorna `VALIDATION_EXCLUDED_FIELDS`. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Uma requisição anterior com a mesma `Idempotency-Key` ainda está em execução. | Tente novamente assim que ela terminar. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | A mesma `Idempotency-Key` foi enviada com um corpo diferente. | Use uma nova chave ou envie o corpo original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` especificou uma função que não é `count`, `sum`, `avg`, `min` ou `max`. | Use uma dessas opções; a mensagem lista as disponíveis. |
| `INVALID_AGGREGATE_SELECT` | 400 | Uma entrada em `?select=` não está no formato `fn(campo)`, ou uma função diferente de `count()` foi informada sem campo. | Escreva `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_BATCH_BODY` | 400 | Uma operação em `/_batch` não contém `op`, `collection`, `values` ou `id`, especifica uma coleção não atendida por este backend ou reutiliza um nome de `ref`. | Veja a mensagem; ela identifica a operação pelo índice. |
| `INVALID_BATCH_REF` | 400 | Um `{ "$ref": "<nome>.<campo>" }` não referencia nenhuma operação anterior, aponta para a frente ou solicita um campo que a linha referenciada não possui. Apenas referências retroativas são resolvidas. | Dê um nome à operação com `ref` *antes* de referenciá-la. |
| `INVALID_BULK_BODY` | 400 | O corpo da operação em massa não possui o formato esperado. | Envie o array `items` documentado. |
| `INVALID_CONFLICT_TARGET` | 400 | O parâmetro `on_conflict` / `onConflict` de um upsert especifica colunas sem garantia de unicidade ou as nomeia sem `upsert: true`. Caso contrário, o Postgres retornaria 42P10 de dentro de uma transação que já realizou operações. | Declare `validation: { unique: true }` ou um índice `unique`; a mensagem lista os destinos existentes. |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` não é `include` nem `only`. O valor é recusado em vez de ignorado: um erro de digitação como `?deleted=true` que ocultasse silenciosamente todas as linhas excluídas pareceria funcionar, mas responderia à pergunta oposta. | Envie `include` (ativas e excluídas) ou `only` (apenas excluídas). Omita o parâmetro para apenas linhas ativas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` não é `true` nem `false`. | Envie um desses valores; `1` e `0` também são aceitos. |
| `INVALID_FIELD_OPERATION` | 400 | Um `$inc` / `$push` / `$pull` / `$merge` foi usado em um tipo de propriedade para o qual não está definido, com um operando no formato incorreto, com dois operadores em um único campo, com erro de digitação ou em uma operação de criação — onde não há valor armazenado para operar. | Consulte [Gravando via REST](/docs/backend/writes/#field-operations); a mensagem indica o campo. |
| `INVALID_FILTER_FIELD` | 400 | O filtro especifica uma propriedade que esta coleção não possui. | Verifique a grafia em relação à coleção. |
| `INVALID_FILTER_OPERATOR` | 400 | O operador não é suportado por este tipo de propriedade. | Consulte [Consultando dados](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Um valor de filtro não pode ser interpretado como o tipo da coluna com a qual foi comparado: `?id=eq.abc` em uma chave inteira, um rótulo que não está no enum, um timestamp inválido, um número fora do intervalo do tipo. `details.dbCode` traz o SQLSTATE. | Envie um valor compatível com o tipo da coluna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` não é `true` nem `false`. Qualquer outro valor é recusado em vez de interpretado como "não" — um erro de digitação que faça exclusão lógica quando o chamador pediu para purgar faz com que ele acredite que os dados foram apagados em definitivo. | Envie `true` ou `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: não é uma lista de caminhos válida ou está aninhado além da profundidade máxima. Tratado na borda em vez de escapar do driver como um erro 500. | Veja a mensagem; ela indica o caminho problemático. |
| `INVALID_INPUT` | 400 | O corpo da requisição falhou na validação. | Veja a mensagem. |
| `INVALID_LIMIT` | — | Uma assinatura em tempo real solicitou um limite fora do intervalo permitido. Entregue como um frame `ERROR` de WebSocket, não como uma resposta HTTP. | Diminua o limite. |
| `INVALID_LOGICAL_GROUP` | 400 | Um grupo `?or=` / `?and=` está malformado ou aninhado além da profundidade permitida. | Veja a mensagem; ela mostra a regra de nivelamento (flattening). |
| `INVALID_OFFSET` | 400 | `?offset=` não é um número inteiro maior ou igual a 0. | Envie um número inteiro não negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` não é `field`, `field:desc` ou um array JSON de `{ field, direction }`. | Veja a mensagem; ela demonstra as três formas válidas de escrita. |
| `INVALID_PAGE` | 400 | `?page=` não é um número inteiro maior ou igual a 1. As páginas são indexadas a partir de 1, portanto `?page=0` é considerado um erro em vez da primeira página. | Envie `1` ou mais, ou use `?offset=`. |
| `INVALID_PARAM` | 400 | Um parâmetro de consulta está malformado. | Veja a mensagem. |
| `INVALID_VECTOR` | 400 | `?vector=` não é um array JSON de números. | Envie `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` não é `cosine`, `l2` nem `inner_product`. | Use uma dessas três opções. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` não é um número. | Envie um número. |
| `INVALID_WHERE` | 400 | `?where=` não é um objeto JSON mapeando campos a condições. | Envie `{"status":["==","active"]}`. |
| `MISSING_AGGREGATE_SELECT` | 400 | A rota de agregação foi chamada sem `?select=`. | Adicione um, por exemplo: `?select=count()`. |
| `NO_COLLECTIONS` | 404 | O projeto não serve nenhuma coleção: nenhuma declarada no código e nenhuma tabela a partir da qual derivá-las. | Crie tabelas — via migração, SQL ou um arquivo de coleção seguido de `rebase db push` — e reinicie. |
| `NOT_FOUND` | 404 | Nenhuma linha com esse ID nessa coleção — ou trata-se de uma linha que a segurança em nível de linha oculta deste chamador. | Verifique o ID e, em seguida, as `securityRules` da coleção. |
| `UNKNOWN_RELATION` | 400 | `?include=` especifica algo que não é uma relação na coleção. O mesmo código responde com **404** quando um *caminho de URL* aninhado a indica, como `/api/data/authors/1/posts` onde `authors` não declara nenhuma relação — nesse caso, a URL não aponta para nada, configurando um "não encontrado" em vez de uma requisição malformada. | Verifique o nome da relação — a mensagem lista as existentes na coleção. Uma referência inversa precisa estar declarada no elemento pai para ser navegável. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | A ordenação especifica uma propriedade que não permite ordenação. | Ordene por uma propriedade associada a uma coluna. |
| `PAYLOAD_TOO_LARGE` | 413 | O corpo da requisição excede o limite configurado. | Envie menos dados ou aumente o limite. |
| `READ_ONLY_TRANSACTION` | 409 | Um callback `afterRead` tentou gravar dados. Uma leitura com escopo de requisição roda em uma transação `READ ONLY`, portanto nem o callback nem nada chamado por ele pode realizar gravações. | Mova a gravação para fora da leitura: um background job ou `rebase.dataAsAdmin` a partir de um cron job ou função personalizada. |
| `RELATION_MISCONFIGURED` | 500 | Uma relação não resolve em relação ao schema registrado. A operação é recusada em vez de ignorada: descartá-la reportaria sucesso para uma gravação que nunca ocorreu, ou ausência de dados para linhas existentes. | Execute `rebase schema generate` se o schema gerado for mais antigo que o banco de dados. |
| `RELATION_NOT_UNLINKABLE` | 400 | A relação não pode ser desvinculada a partir deste lado. | Realize a gravação a partir do lado proprietário da relação. |
| `RELATION_NOT_WRITABLE` | 400 | O caminho aninhado não é uma relação gravável. | Consulte [Relações](/docs/collections/relations/). |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Uma gravação de relação não possuía chave de origem para ancorar o vínculo. | Salve a linha pai primeiro. |
| `SCHEMA_DRIFT` | 500 | Uma tabela ou coluna esperada pelo código não existe no banco de dados. | Execute `rebase db push` em desenvolvimento; faça novo deploy em um tenant gerenciado. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` foi combinado com `orderBy: "_score"`. A relevância é calculada por consulta em vez de armazenada, portanto não pode servir como chave para um cursor. | Pagine a relevância com `limit`/`offset` ou ordene por uma coluna. |
| `TENANT_IMMUTABLE` | 400 | Uma gravação moveria uma linha de um tenant para outro. Uma linha não pode mudar de tenant. `details.violations` indica o campo. | Crie a linha no outro tenant e exclua esta, ou realize a gravação com uma role presente em `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | A gravação especifica um tenant ao qual este chamador não pertence; o banco de dados também a recusaria. | Grave em um tenant ao qual o chamador pertença ou autentique-se como alguém que pertença a ele. |
| `TENANT_REQUIRED` | 400 | A coleção tem escopo de tenant e o tenant não pode ser inferido: a requisição não inclui nenhum, ou o chamador pertence a múltiplos tenants. | Envie o campo do tenant explicitamente ou autentique-se como um chamador associado a exatamente um tenant. |
| `UNKNOWN_FIELD` | 400 | `?fields=` especifica um campo que a coleção não possui. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Uma agregação ou `groupBy` especifica um campo que a coleção não possui. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | O filtro especifica um campo que esta coleção — ou o destino de uma relação — não possui. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | O filtro especifica um operador inexistente. | A mensagem lista todos os operadores válidos. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | A ordenação especifica um campo que esta coleção não possui. | Verifique a grafia; a mensagem lista os campos válidos. |
| `PRECONDITION_FAILED` | 412 | Um `If-Match` informou uma versão da linha que não é mais a atual: alguém alterou o registro entre a sua leitura e esta gravação. Nada foi gravado. | Leia a linha novamente, aplique as alterações novamente e envie o novo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita um campo que a coleção não possui. | Verifique a grafia; a mensagem lista os campos conhecidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Uma busca vetorial especificou uma propriedade que não é do tipo `vector` nesta coleção. | A mensagem lista as propriedades vetoriais da coleção. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | O `Content-Type` não é aceito por esta rota. | Envie o tipo documentado para a rota. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | O filtro cruza uma relação `via`, cujo caminho de junção é definido em apenas uma direção, não havendo como correlacionar uma subconsulta de volta. | Filtre a partir do lado proprietário da relação. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | O operador não está definido para esse campo: uma relação sem coluna nesta linha é filtrada por pertinência/associação, e a correspondência sem distinção entre maiúsculas e minúsculas só se aplica a textos. | Veja a mensagem; ela lista o que o campo aceita. |
| `VALIDATION_CONSTRAINT` | 400 | Um valor violou uma regra de `validation` declarada pela propriedade — tamanho, intervalo, padrão ou campo obrigatório. | Veja a mensagem; ela indica cada violação. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | O corpo tenta gravar em uma coluna marcada como `excludeFromApi` ou `access: { write: [] }` — a mesma regra com duas sintaxes diferentes. Esses campos devem ser definidos exclusivamente pelo servidor: hash de senha, token de verificação. Diferente de `FIELD_NOT_WRITABLE`, esta é a mesma resposta para qualquer chamador, incluindo `admin`. | Remova o campo. Consulte [Acesso a campos](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Um valor não é compatível com o tipo de sua propriedade. | Veja a mensagem; ela indica a propriedade. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | O corpo especifica um campo inexistente na coleção — incluindo um argumento `id` em uma coleção cuja chave primária é outro elemento. | Verifique a grafia; a mensagem lista os campos conhecidos. |
| `WRITE_DENIED` | 403 | Uma regra de segurança ou política de segurança em nível de linha recusou a gravação. | Verifique as `securityRules` da coleção. |

## `PG_<SQLSTATE>` — uma restrição rejeitada pelo banco de dados

Uma gravação que o Postgres rejeita por um motivo referente aos *dados do
chamador* responde com o SQLSTATE no código: `PG_23505`, `PG_23503`, e assim por
diante. Essa é uma família, não uma lista fixa — o Postgres define centenas de
SQLSTATEs —, mas apenas duas classes chegam a esse ponto, pois somente essas duas
são de responsabilidade do chamador:

- **classe 23**, violação de restrição de integridade: duplicata, chave
  estrangeira apontando para algo inexistente, coluna NOT NULL deixada em branco;
- **classe 22**, exceção de dados: um valor incompatível com o tipo da coluna.

Tudo o mais — conexão perdida, coluna ausente, problema de privilégio — é falha
do servidor e permanece como `500`. Portanto, `code.startsWith("PG_")` é um teste
seguro para "o registro que enviei estava incorreto", sendo que os quatro abaixo
são os que o cliente efetivamente encontra. `details.dbCode` traz o mesmo
SQLSTATE para todos eles, e a mensagem informa o nome da restrição.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Um valor não pôde ser interpretado como o tipo da coluna — o equivalente no lado da gravação para `INVALID_FILTER_VALUE`. | Envie um valor compatível com o tipo da coluna. |
| `PG_23502` | 400 | Uma coluna `NOT NULL` foi deixada vazia. | Envie o campo ou defina um valor padrão para a coluna. |
| `PG_23503` | 400 | Uma chave estrangeira aponta para uma linha inexistente. | Crie a linha de destino primeiro ou corrija o ID. |
| `PG_23505` | 409 | Uma restrição de unicidade foi violada. A mensagem informa o nome da restrição. | Use um valor diferente ou atualize a linha existente. |

## Armazenamento

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_STORAGE_BUCKET` | 400 | O nome do bucket está malformado. | Verifique o nome. |
| `INVALID_STORAGE_KEY` | 400 | A chave do objeto está malformada ou escapa do seu prefixo. | Verifique a chave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Os parâmetros de transformação de imagem estão fora do intervalo ou são contraditórios. | Consulte [Armazenamento](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | O upload excede o `maxSize` declarado pela propriedade de destino. Aplicado no servidor, não apenas no navegador. `details` indica a propriedade, o limite e o tamanho real. | Faça upload de um arquivo menor ou aumente o `maxSize` na propriedade. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | O tipo do arquivo enviado não está no `acceptedFiles` da propriedade. `details` indica a propriedade, a lista de aceitos e o Content-Type enviado. | Faça upload de um tipo aceito ou amplie o `acceptedFiles`. |
| `STORAGE_NOT_CONFIGURED` | 503 | Nenhum backend de armazenamento está configurado neste servidor. | Configure S3, GCS ou armazenamento local. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | A fonte de armazenamento está declarada, mas não possui credenciais aqui. | Defina as variáveis de ambiente dessa fonte. |
| `STORAGE_WRITE_FAILED` | 502 | O backend de armazenamento recusou ou interrompeu a gravação. | Verifique seus próprios logs e credenciais. |
| `TRANSFORM_OVERLOADED` | 503 | Muitas transformações de imagem em andamento. | Tente novamente; considere colocar uma CDN à frente. |
| `UNKNOWN_STORAGE_SOURCE` | 400 | A requisição indicou uma fonte de armazenamento (`?storageId=`) que este projeto não declara. Um `bucket` não atendido por esta implantação retorna o mesmo código com **404** — o repositório é o que está ausente, e `details` lista os buckets e as fontes que existem. Ambos costumavam retornar "arquivo não encontrado", idêntico a uma chave simplesmente inexistente. | Declare a fonte em `config/resources.ts` ou consulte `GET /api/storage/sources`. |

## Funções personalizadas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nenhuma função com esse nome é disponibilizada — ou existe uma, mas suas rotas não cobrem o caminho posterior. Um chamador autenticado também é informado sobre o que *está* disponível; um anônimo não, pois essa lista é um inventário de todos os endpoints personalizados. Quando um arquivo com esse nome falha ao carregar, a mensagem explicita o fato: essa é a diferença entre um erro de digitação e uma implantação com falhas. | Verifique o nome em `GET /api/functions` ou o log de inicialização em busca de arquivos não carregados. |
| `FUNCTION_TIMEOUT` | 504 | O manipulador (handler) excedeu o tempo limite. Ele continua em execução e não pode ser cancelado a partir daqui. | Defina um `AbortSignal` nas chamadas de saída ou aumente `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este processo atua como proxy de funções para outro processo, o qual não respondeu. | Verifique se a unidade de funções está em execução. |

## Superfícies administrativas e edição de schema

Estes códigos indicam que um recurso está desativado ou não configurado, e não que
a requisição estava incorreta. Cada um também é reportado na respectiva rota
`/status` com um `200`, permitindo que um painel desabilite o recurso visualmente
em vez de exibir um erro.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Uma interface exclusiva de administração foi chamada em um servidor sem autenticação configurada, impossibilitando distinguir um administrador de qualquer usuário anônimo. | Defina `auth.jwtSecret` ou passe um `AuthAdapter`. |
| `CONTRACT_UNAVAILABLE` | 404 | O contrato do projeto só é servido quando a autenticação está configurada — ele descreve todas as tabelas e relações. | Configure a autenticação. `/meta/schema-version` é sempre servido. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nenhuma caixa de correio de desenvolvimento ativa. E-mails só são capturados quando `SMTP_HOST` não está definido e `NODE_ENV` não é produção. | Remova a definição de `SMTP_HOST` em desenvolvimento ou leia a caixa de entrada real. |
| `INVALID_CHANGE` | 400 | A alteração de schema proposta não está bem formatada. | Veja a mensagem. |
| `SCHEMA_CHANGE_FAILED` | 400 | A aplicação de uma alteração planejada de schema falhou por um motivo não coberto por códigos mais específicos. | Veja a mensagem; trata-se da falha subjacente na íntegra. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | A alteração é válida, mas não pode ser aplicada ao schema no estado atual. | Veja a mensagem. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | O repositório possui alterações não commitadas, portanto a edição não pôde ser aplicada com segurança. | Faça commit ou stash e tente novamente. |
| `SCHEMA_EDIT_REFUSED` | 400 | O editor de schema recusou a alteração. | Veja a mensagem; trata-se da recusa do próprio editor. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Uma chave de API ou outro agente automatizado tentou aplicar uma alteração de schema. | Faça login como usuário ou defina `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | A edição de schema em tempo real precisa de `collectionsDir` ou `liveSchema.repository`, e este servidor foi iniciado sem nenhum deles. | Configure um deles. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | O planejamento funciona; não há repositório para commitar a alteração. | Configure `liveSchema.repository`. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este driver não suporta o planejamento de alterações de schema. | A edição em tempo real está disponível no Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | As coleções são introspectadas a partir do banco de dados aqui, portanto não há arquivos de origem para editar. | Altere o schema por meio de uma migração. |
| `SCHEMA_EDITOR_DISABLED` | 501 | O editor de schema está desativado para este servidor. | Ative-o com `schemaEditor`. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | O editor de schema precisa do pacote `ts-morph`, que não está instalado. | `pnpm add -D ts-morph@28.0.0`. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | O servidor não possui `collectionsDir`, portanto o editor não tem onde gravar. | Defina `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | O editor fica desativado sob `NODE_ENV=production`: os arquivos de um servidor em produção são reconstruídos a partir do seu repositório a cada deploy, portanto uma alteração feita aqui seria descartada. | Edite as coleções em desenvolvimento e faça o deploy. |

## Códigos genéricos

Uma rota utiliza um destes quando nada mais específico se aplica.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformada, e nada mais específico se aplica. | Veja a mensagem. |
| `UNAUTHORIZED` | 401 | Não autenticado ou a credencial foi rejeitada. | Faça login ou renove a sessão. |
| `FORBIDDEN` | 403 | Autenticado, mas não permitido. | Tentar novamente com a mesma identidade não ajudará. |
| `CONFLICT` | 409 | Conflito com o estado existente. | Veja a mensagem. |
| `INTERNAL_ERROR` | 500 | Ocorreu uma falha no servidor. A mensagem é genérica propositalmente. | Cite o `requestId`; o motivo detalhado está nos logs. |
| `NOT_CONFIGURED` | 503 | Uma dependência necessária para esta rota não está configurada neste servidor. | Veja a mensagem. |
| `SERVICE_UNAVAILABLE` | 503 | Uma dependência estava inacessível. | Tente novamente; verifique os logs. |

## Mantendo esta página precisa

O comando `pnpm verify:docs` falha quando um código que o servidor pode emitir
está ausente destas tabelas, quando uma tabela lista um código que nada pode
gerar, quando um status informado diverge do código-fonte ou quando uma família
de códigos como `PG_<SQLSTATE>` não contém uma linha para um SQLSTATE encontrado
pelos chamadores. O script responsável é
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Ele valida a si próprio primeiro. A varredura lê os códigos diretamente do
TypeScript em vez de um servidor em execução, portanto seus pontos cegos seriam
silenciosos por definição: em uma ocasião, o script não identificava um código
repassado por um wrapper de linha única, ou outro declarado após uma mensagem
contendo `)`, e reportava que "todos os códigos possíveis estavam documentados"
em uma página que omitia dezessete deles. Por isso, a rotina executa uma fixture
com exatamente esses formatos antes de ler esta página, e recusa-se a validar
qualquer item se não conseguir encontrá-los.

---
