---
sourceHash: 98630809329b42c5
title: Códigos de erro
sidebar_label: Códigos de erro
description: Todos os códigos de erro que um backend Rebase pode retornar, com seu status HTTP, significado e o que fazer a respeito — além do envelope de resposta, X-Request-ID e as regras de details.
---

Cada falha retornada por um backend Rebase usa um único envelope e contém um
`code` estável. O código é o elemento sobre o qual tomar decisões condicionais:
a mensagem é escrita para humanos e pode ser reformulada, o status é
compartilhado por dezenas de problemas diferentes, e o código não é nenhum dos dois.

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
  servidor; para um `5xx`, é deliberadamente genérica, pois o texto subjacente
  pode citar um host, uma role ou o nome de uma coluna.
- **`code`** — um dos valores abaixo. Estável entre versões menores.
- **`details`** — opcional e nunca garantido. Veja as regras abaixo.
- **`requestId`** — presente sempre que a requisição tiver passado pelo
  middleware de request-ID, o que inclui todas as rotas sob `basePath`.

### `X-Request-ID`

Toda requisição sob `basePath` recebe um ID: o cabeçalho `X-Request-ID` do
chamador quando for um UUID v4 válido, ou um novo caso contrário. Ele é
retornado na resposta como `X-Request-ID`, incluído no envelope de erro como
`requestId` e anexado à linha de log do servidor referente àquela requisição.

Essa é a chave de correlação. Ao informá-la em um relatório de bug, um operador
pode encontrar a linha de log exata que explica a falha, trazendo o motivo que
nunca foi exibido ao cliente.

Enviar o seu próprio ID é como um rastreamento sobrevive a um salto (hop): um
gateway ou um job runner que encaminha o cabeçalho obtém um único ID em todos
os serviços que processaram a requisição. Um valor inválido é ignorado em vez
de rejeitado — não vale a pena falhar uma requisição por causa de um cabeçalho
malformado enviado pelo chamador —, portanto, não presuma que o ID enviado foi o
ID recebido. Leia o cabeçalho de resposta.

### O que há em `details`

`details` tem finalidade diagnóstica, não contratual. Três regras o regem:

1. **Tudo o que uma rota define explicitamente é sempre retornado.** Esses são
   os próprios erros do chamador descritos com precisão: qual campo de filtro
   era desconhecido, qual relação não permite escrita, qual valor não
   correspondia ao seu tipo.
2. **Os diagnósticos do banco de dados são simplificados em produção.** Quando
   a falha vem do Postgres, `details.dbCode` — o SQLSTATE — está sempre
   presente: ele nomeia a classe do problema e não revela nada sobre os dados.
   `dbMessage`, `detail` e `hint` são adicionados apenas quando `NODE_ENV` não
   for `production`, pois o Postgres inclui o conteúdo das linhas neles.
   `23505` relata `Key (email)=(a@b.c) already exists.`, o que responderia "essa
   pessoa está registrada?" para qualquer endereço que alguém resolvesse testar.
3. **Nunca ramifique a lógica com base em `details`.** Faça condicionais usando
   `code`. O que está sob `details` é apenas o que foi útil para uma pessoa
   naquele ponto de chamada e pode mudar.

## Lendo um status

| Status | O que ele diz sobre a requisição |
| --- | --- |
| `400` | Malformada ou solicitando algo que não existe no schema. Corrija a requisição. |
| `401` | Não autenticado ou a credencial expirou. Faça login ou atualize o token. |
| `403` | Autenticado, mas não permitido. Tentar novamente com a mesma identidade não ajudará. |
| `404` | Rota, collection ou linha inexistente — ou uma linha oculta pela segurança em nível de linha (RLS). |
| `409` | Um conflito com o estado existente: duplicata ou gravação concorrente. |
| `413` `415` `422` | O corpo é grande demais, o tipo de mídia é incorreto ou a requisição foi rejeitada semanticamente. |
| `429` | Limite de taxa excedido (Rate limited). Aguarde; a mensagem informa por quanto tempo. |
| `500` | O erro está no servidor ou em seu banco de dados, não no chamador. Verifique os logs. |
| `501` | A rota existe, mas este deploy não pode atendê-la — um recurso que está desativado ou não configurado. |
| `502` `503` `504` | Uma dependência estava inacessível, não configurada ou muito lenta. |

## Autenticação e contas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | A rota requer um segundo fator e a sessão possui apenas um. | Complete o desafio de MFA e tente novamente. |
| `ALREADY_VERIFIED` | 400 | O endereço ou fator já foi verificado. | Nada — o estado desejado já é verdadeiro. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | O login anônimo está desativado neste servidor. | Ative-o ou faça login com uma identidade real. |
| `API_KEY_FORBIDDEN` | 403 | Uma chave de API foi usada em uma rota que apenas pessoas podem chamar. | Use uma sessão de usuário. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Uma chave de API tentou criar, listar ou revogar chaves de API. | Gerencie as chaves como um administrador autenticado. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Uma rota protegida foi executada sem o middleware de autenticação do Rebase antes dela, portanto a credencial do chamador nunca foi avaliada. | Monte o aplicativo por meio do roteador de funções em vez de diretamente no seu próprio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | O bootstrap do primeiro administrador foi tentado por um chamador anônimo. | Faça login primeiro. |
| `BOOTSTRAP_COMPLETED` | 403 | O primeiro administrador já existe. | Solicite que um administrador existente conceda a role. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | O bootstrap é apenas para o primeiro usuário absoluto, e este não é o caso. | Solicite que um administrador existente conceda a role. |
| `CAPTCHA_FAILED` | 400 | O provedor rejeitou o token de CAPTCHA. | Resolva um novo desafio. |
| `CAPTCHA_REQUIRED` | 400 | A rota requer um token de CAPTCHA e nenhum foi enviado. | Inclua o token. |
| `CHALLENGE_EXHAUSTED` | 401 | Muitas tentativas incorretas para um mesmo desafio de MFA. | Inicie um novo desafio. |
| `EMAIL_EXISTS` | 409 | Já existe uma conta com esse endereço. | Faça login ou inicie uma redefinição de senha. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic links ou OTP foram solicitados e o servidor não possui transporte de e-mail. | Configure o SMTP ou use outro método de autenticação. |
| `EMAIL_NOT_VERIFIED` | 403 | A conta existe e seu endereço não foi verificado. | Verifique o endereço. |
| `FACTOR_NOT_VERIFIED` | 400 | O fator de MFA foi cadastrado, mas nunca confirmado. | Confirme o fator. |
| `IDENTITY_ALREADY_LINKED` | 409 | Essa identidade OAuth pertence a outra conta. | Faça login com ela ou desvincule-a de lá primeiro. |
| `INVALID_ACCOUNT` | 400 | A conta está em um estado sobre o qual esta operação não pode atuar. | Veja a mensagem. |
| `INVALID_CHALLENGE` | 400 | O desafio de MFA é desconhecido ou expirou. | Inicie um novo. |
| `INVALID_CODE` | 401 | O código OTP ou MFA está incorreto. | Tente novamente com o código atual. |
| `INVALID_CREDENTIALS` | 401 | E-mail ou senha incorretos — deliberadamente sem especificar qual. | Tente novamente ou redefina a senha. |
| `INVALID_TOKEN` | 400 | Um token de verificação, redefinição ou magic link está malformado ou é desconhecido. | Solicite um novo link. |
| `LAST_ADMIN` | 403 | A alteração deixaria o projeto sem nenhum administrador. | Promova outra pessoa primeiro. |
| `MFA_REQUIRED` | 401 | A senha estava correta e a conta possui um segundo fator verificado, portanto o login foi concluído apenas pela metade. `details` traz um token de curta duração com escopo para o desafio de MFA — não é uma sessão. | Abra um desafio e responda-o; a resposta do desafio emitirá a sessão. |
| `NO_SESSION` | 401 | Nenhum cookie de sessão ou refresh token foi apresentado. Normal no primeiro carregamento de página. | Faça login. |
| `NOT_ANONYMOUS` | 400 | Uma rota de upgrade a partir de anônimo foi chamada por uma conta real. | Nada para atualizar. |
| `OAUTH_ERROR` | 401 | O provedor de OAuth recusou ou retornou um erro. | Tente o fluxo novamente; a mensagem contém o motivo do provedor. |
| `RATE_LIMITED` | 429 | Muitas tentativas deste chamador. | Aguarde; a mensagem diz por quanto tempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | O destino do redirecionamento não está na lista de permissões. | Adicione-o à configuração do provedor. |
| `REGISTRATION_DISABLED` | 403 | O cadastro de autoatendimento está desativado. | Peça a um administrador para criar a conta. |
| `ROLE_EXISTS` | 409 | Esse nome de role já está em uso. | Escolha outro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Não foi possível ler as roles para uma requisição restrita a administradores. Falha de forma segura (fail-closed) em vez de confiar na declaração do próprio token. | Tente novamente; verifique o banco de dados. |
| `SELF_DELETE` | 400 | Um administrador tentou excluir a própria conta. | Peça a outro administrador para fazê-lo. |
| `SESSION_REVOKED` | 401 | A sessão foi encerrada em outro lugar ou todas as sessões foram revogadas. | Faça login novamente. |
| `SETUP_REQUIRED` | 403 | O projeto ainda não possui nenhum administrador, portanto esta rota não está disponível. | Conclua a configuração do primeiro administrador. |
| `TOKEN_ALREADY_USED` | 401 | Um token de uso único foi reutilizado. | Solicite um novo. |
| `TOKEN_EXPIRED` | 401 | O token ultrapassou seu tempo de vida. | Solicite um novo. |
| `USER_NOT_FOUND` | 404 | Nenhuma conta com esse id. | Verifique o id. |
| `WEAK_PASSWORD` | 400 | A senha não atende à política configurada. | Escolha uma senha mais forte. |

## Dados, consultas e escritas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este driver não pode computar a agregação solicitada. | Use um driver compatível ou calcule-a no cliente. |
| `BRANCHING_UNSUPPORTED` | — | Uma ramificação (branch) do banco de dados foi solicitada via websocket do Studio no banco de dados de desenvolvimento gerenciado (PGlite), onde uma branch *é* o pai e nada seria isolado. A recusa é a mesma que `rebase db branch` exibe. | Aponte `DATABASE_URL` para um Postgres próprio (`rebase dev --docker` inicia um) e crie ramificações lá. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contém mais operações do que o limite por lote (1000 por padrão). Um lote é uma única transação e mantém seus bloqueios durante todo o processo. | Envie em partes menores; a mensagem informa o limite e a sua contagem. |
| `BATCH_UNSUPPORTED` | 400 | O driver deste backend não pode gravar em várias collections de forma atômica, e um loop de escritas individuais não seria atômico nem executado em uma única ida e volta. | Envie as gravações como requisições separadas ou como chamadas `/bulk` por collection. |
| `BULK_TOO_LARGE` | 400 | O corpo da operação em massa excede o limite de itens configurado. | Divida a requisição. |
| `BULK_UNSUPPORTED` | 400 | Esta collection ou driver não oferece suporte a gravações em massa. | Grave as linhas uma de cada vez. |
| `CALLBACK_REJECTED` | 400 | Um callback da collection recusou a escrita. Um `throw` a partir de `beforeSave`/`beforeDelete`/`after*` é um 400 contendo a própria mensagem do autor; um `beforeDelete` que retorna `false` é um 403. `details.stage` informa qual callback, `details.path` a collection. | Leia a mensagem — ela foi escrita por este projeto, não pelo Rebase. |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` foi combinado com `?offset=` ou `?page=`. Um cursor já indica onde a página começa; portanto, um deslocamento além dele pula silenciosamente aquela quantidade de linhas após o cursor — uma lacuna que o chamador não consegue ver na resposta. | Use um ou outro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` foi combinado com uma consulta de busca ou vetorial. Ambas atribuem uma pontuação por linha, de modo que duas linhas nunca são iguais e o `DISTINCT` não agruparia nada — pareceria ter funcionado, mas não mudaria nada. | Remova um dos dois. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Uma leitura `distinct` é ordenada por uma coluna que ela não retorna. Um `SELECT DISTINCT` só pode ser ordenado por colunas contidas em sua lista de seleção, caso contrário as linhas que ele agrupa não têm uma ordem definida. `details.fields` indica quais são. | Adicione esses campos a `?fields=` ou remova-os de `?orderBy=`. |
| `DB_PERMISSION_DENIED` | 500 | O Postgres recusou a instrução (`42501`): seja por uma política de segurança em nível de linha (RLS) negando esta role ou por um `GRANT` ausente. | Consulte [Troubleshooting](/docs/troubleshooting/). |
| `FIELD_NOT_READABLE` | 400 | Um filtro, `orderBy`, `fields`, `select` agregado ou `groupBy` referencia um campo que as roles deste chamador não podem ler (`access.read`). Um campo que nenhuma resposta pode conter deve ser um que nenhuma consulta possa interrogar, caso contrário o valor poderia ser lido predicado por predicado. `details.violations` indica cada campo. | Remova o campo da consulta ou obtenha a role necessária. Consulte [Acesso a campos](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | O corpo define um campo que as roles deste chamador não podem gravar (`access.write`). Recusado em vez de ignorado: uma escrita que descarta um campo reportaria sucesso para uma edição que não ocorreu. `details.violations` indica cada campo. | Remova o campo ou obtenha a role necessária. Um campo que ninguém pode gravar retorna `VALIDATION_EXCLUDED_FIELDS` em vez disso. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Uma requisição anterior com a mesma `Idempotency-Key` ainda está em execução. | Tente novamente assim que ela terminar. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | A mesma `Idempotency-Key` foi enviada com um corpo diferente. | Use uma nova chave ou envie o corpo original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` especificou uma função que não é `count`, `sum`, `avg`, `min` ou `max`. | Use uma dessas opções; a mensagem lista todas elas. |
| `INVALID_AGGREGATE_SELECT` | 400 | Uma entrada de `?select=` não está no formato `fn(field)` ou uma função diferente de `count()` foi passada sem um campo. | Escreva `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_BATCH_BODY` | 400 | Uma operação de `/_batch` não possui `op`, `collection`, `values` ou `id`, especifica uma collection não atendida por este backend ou reutiliza um nome de `ref`. | Veja a mensagem; ela identifica a operação pelo índice. |
| `INVALID_BATCH_REF` | 400 | Um `{ "$ref": "<name>.<field>" }` não referencia nenhuma operação anterior, aponta para a frente ou solicita um campo que a linha referenciada não possui. Apenas referências retroativas são resolvidas. | Nomeie a operação com `ref` *antes* de referenciá-la. |
| `INVALID_BULK_BODY` | 400 | O corpo da operação em massa não está no formato esperado. | Envie o array `items` documentado. |
| `INVALID_CONFLICT_TARGET` | 400 | O `on_conflict` / `onConflict` de um upsert referencia colunas sem garantia de unicidade ou as referencia sem `upsert: true`. Caso contrário, o Postgres retornaria 42P10 de dentro de uma transação que já realizou operações. | Declare `validation: { unique: true }` ou um índice `unique`; a mensagem lista os alvos que realmente existem. |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` não é `include` nem `only`. Recusado em vez de ignorado: um erro de digitação `?deleted=true` que ocultasse silenciosamente todas as linhas excluídas pareceria funcionar, mas responderia à pergunta oposta. | Envie `include` (ativas e excluídas) ou `only` (apenas excluídas). Omita-o para obter somente linhas ativas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` não é `true` nem `false`. | Envie um desses valores; `1` e `0` também são aceitos. |
| `INVALID_FIELD_OPERATION` | 400 | Um `$inc` / `$push` / `$pull` / `$merge` foi usado em um tipo de propriedade para o qual não está definido, com um operando de formato incorreto, com dois operadores no mesmo campo, com erro de digitação ou em uma operação de criação — onde não há valor armazenado para operar. | Consulte [Gravações via REST](/docs/backend/writes/#field-operations); a mensagem indica o campo. |
| `INVALID_FILTER_FIELD` | 400 | O filtro especifica uma propriedade que esta collection não possui. | Verifique a ortografia em relação à collection. |
| `INVALID_FILTER_OPERATOR` | 400 | O operador não é suportado por este tipo de propriedade. | Consulte [Consultando dados](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Um valor de filtro não pode ser interpretado como o tipo da coluna com a qual foi comparado: `?id=eq.abc` em uma chave inteira, um rótulo que não está no enum, um timestamp inválido, um número fora do intervalo do tipo. `details.dbCode` contém o SQLSTATE. | Envie um valor compatível com o tipo da coluna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` não é `true` nem `false`. Qualquer outro valor é recusado em vez de interpretado como "não" — um erro de digitação que faça exclusão lógica quando o chamador pediu para purgar faz com que ele acredite que os dados foram removidos definitivamente. | Envie `true` ou `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: não é uma lista de caminhos válida ou está aninhado além da profundidade máxima. Tratado no limite da requisição em vez de escapar do driver como um erro 500. | Veja a mensagem; ela informa o caminho problemático. |
| `INVALID_INPUT` | 400 | O corpo da requisição falhou na validação. | Veja a mensagem. |
| `INVALID_LIMIT` | — | Uma assinatura em tempo real solicitou um limite fora do intervalo permitido. Retornado como um frame de `ERROR` no WebSocket, não como uma resposta HTTP. | Diminua o limite. |
| `INVALID_LOGICAL_GROUP` | 400 | Um grupo `?or=` / `?and=` está malformado ou aninhado além da profundidade permitida. | Veja a mensagem; ela ilustra a regra de nivelamento. |
| `INVALID_OFFSET` | 400 | `?offset=` não é um número inteiro maior ou igual a 0. | Envie um número inteiro não negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` não é `field`, `field:desc` ou um array JSON de `{ field, direction }`. | Veja a mensagem; ela mostra as três formas aceitas. |
| `INVALID_PAGE` | 400 | `?page=` não é um número inteiro maior ou igual a 1. As páginas são baseadas em 1, portanto `?page=0` é um erro e não a primeira página. | Envie `1` ou mais, ou use `?offset=`. |
| `INVALID_PARAM` | 400 | Um parâmetro de consulta está malformado. | Veja a mensagem. |
| `INVALID_VECTOR` | 400 | `?vector=` não é um array JSON de números. | Envie `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` não é `cosine`, `l2` ou `inner_product`. | Use uma dessas três opções. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` não é um número. | Envie um número. |
| `INVALID_WHERE` | 400 | `?where=` não é um objeto JSON mapeando campos a condições. | Envie `{"status":["==","active"]}`. |
| `MISSING_AGGREGATE_SELECT` | 400 | A rota de agregação foi chamada sem `?select=`. | Adicione um, ex.: `?select=count()`. |
| `NO_COLLECTIONS` | 404 | O projeto não disponibiliza nenhuma collection: nenhuma declarada em código e nenhuma tabela a partir da qual derivá-las. | Crie tabelas — por meio de migration, SQL ou um arquivo de collection com `rebase db push` — e reinicie. |
| `NOT_FOUND` | 404 | Nenhuma linha com esse id nessa collection — ou uma linha oculta para este chamador pelas regras de segurança em nível de linha (RLS). | Verifique o id e, em seguida, as `securityRules` da collection. |
| `UNKNOWN_RELATION` | 400 | `?include=` especifica algo que não é uma relação na collection. O mesmo código responde com **404** quando um *caminho de URL* aninhado referencia uma relação, ex.: `/api/data/authors/1/posts` onde `authors` não declara nenhuma — nesse caso a URL não aponta para nada, sendo um recurso não encontrado e não uma requisição malformada. | Verifique o nome da relação — a mensagem lista as que a collection possui. Uma referência reversa precisa ser declarada no pai para ser percorrível. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | A ordenação referencia uma propriedade que não permite ordenação. | Ordene por uma propriedade vinculada a uma coluna. |
| `PAYLOAD_TOO_LARGE` | 413 | O corpo excede o limite configurado. | Envie menos dados ou aumente o limite. |
| `READ_ONLY_TRANSACTION` | 409 | Um callback `afterRead` tentou realizar uma escrita. Uma leitura com escopo de requisição roda em uma transação `READ ONLY`, portanto nem o callback nem nada chamado por ele pode realizar escritas. | Mova a escrita para fora da leitura: um background job ou `rebase.dataAsAdmin` a partir de um cron job ou função personalizada. |
| `RELATION_HAS_NO_PIVOT` | 400 | A escrita continha dados de vinculação, mas o caminho não alcança seu destino através de um `manyToMany` que declare `through.properties` — logo, não há tabela intermediária onde gravá-los. | Declare `through.properties` na relação ou remova os dados da escrita. Consulte [Relações](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Uma relação não pode ser resolvida em relação ao schema registrado. A operação é recusada em vez de ignorada: descartá-la reportaria sucesso para uma escrita que nunca ocorreu, ou ausência de dados para linhas existentes. | Execute `rebase schema generate` se o schema gerado for mais antigo que o banco de dados. |
| `RELATION_NOT_UNLINKABLE` | 400 | A relação não pode ser desvinculada a partir deste lado. | Realize a escrita a partir do lado proprietário. |
| `RELATION_NOT_WRITABLE` | 400 | O caminho aninhado não é uma relação gravável. | Consulte [Relações](/docs/collections/relations/). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | A relação declara colunas na tabela de junção, mas esta fonte de dados não suporta escrevê-las. | O vínculo em si ainda funciona; apenas os dados adicionais não. Verifique as capacidades do driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Uma escrita de relação não possuía uma chave de origem para associar o vínculo. | Salve a linha pai primeiro. |
| `SCHEMA_DRIFT` | 500 | Uma tabela ou coluna esperada pelo código não existe no banco de dados. | Execute `rebase db push` em desenvolvimento; faça um novo deploy em um ambiente gerenciado. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` foi combinado com `orderBy: "_score"`. A relevância é computada por consulta em vez de armazenada, portanto não pode servir como chave de cursor. | Pagine a relevância com `limit`/`offset` ou ordene por uma coluna. |
| `TENANT_IMMUTABLE` | 400 | Uma escrita moveria uma linha de um tenant para outro. Uma linha não pode mudar de tenant. `details.violations` informa o campo. | Crie a linha no outro tenant e exclua esta, ou realize a escrita com uma role em `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | A escrita especifica um tenant ao qual este chamador não pertence; o banco de dados também a recusaria. | Grave em um tenant ao qual o chamador pertença ou autentique-se como um usuário desse tenant. |
| `TENANT_REQUIRED` | 400 | A collection tem escopo por tenant e o tenant não pode ser inferido: a requisição não contém nenhum ou o chamador pertence a vários. | Envie o campo do tenant explicitamente ou autentique-se como um chamador que pertença a exatamente um. |
| `UNKNOWN_FIELD` | 400 | `?fields=` especifica um campo que a collection não possui. | Verifique a ortografia; a mensagem lista os campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Uma agregação ou `groupBy` especifica um campo que a collection não possui. | Verifique a ortografia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | O filtro especifica um campo que esta collection — ou o destino de uma relação — não possui. | Verifique a ortografia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | O filtro especifica um operador inexistente. | A mensagem lista todos os operadores. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | A ordenação especifica um campo que esta collection não possui. | Verifique a ortografia; a mensagem lista os campos válidos. |
| `PRECONDITION_FAILED` | 412 | Um cabeçalho `If-Match` especificou uma versão da linha que não é mais a atual: alguém a modificou entre a leitura e esta escrita. Nada foi gravado. | Leia a linha novamente, reaplique a alteração e envie o novo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita um campo que a collection não possui. | Verifique a ortografia; a mensagem lista os campos conhecidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Uma busca vetorial especificou uma propriedade que não é do tipo `vector` nesta collection. | A mensagem lista as propriedades vetoriais da collection. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | O cabeçalho `Content-Type` não é aceito por esta rota. | Envie o tipo documentado para a rota. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | O filtro atravessa uma relação `via`, cujo caminho de junção é unidirecional, não havendo como correlacionar uma subconsulta de volta. | Filtre a partir do lado proprietário. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | O operador não está definido para esse campo: uma relação sem coluna nesta linha é filtrada por pertinência, e a correspondência sem diferenciação de maiúsculas/minúsculas só se aplica a texto. | Veja a mensagem; ela lista o que o campo aceita. |
| `VALIDATION_CONSTRAINT` | 400 | Um valor violou uma regra de `validation` declarada pela propriedade — comprimento, intervalo, padrão ou campo obrigatório. | Veja a mensagem; ela identifica cada violação. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | O corpo tenta gravar em uma coluna marcada como `excludeFromApi` ou `access: { write: [] }` — a mesma regra, duas formas de escrita. Essas propriedades são reservadas para o servidor: hash de senha, token de verificação. Ao contrário de `FIELD_NOT_WRITABLE`, essa resposta é idêntica para todos os chamadores, incluindo `admin`. | Remova o campo. Consulte [Acesso a campos](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Um valor não é compatível com o tipo de sua propriedade. | Veja a mensagem; ela identifica a propriedade. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | O corpo referencia um campo que a collection não possui — incluindo um argumento `id` em uma collection cuja chave é outra propriedade. | Verifique a ortografia; a mensagem lista os campos conhecidos. |
| `WRITE_DENIED` | 403 | Uma regra de segurança ou política de segurança em nível de linha (RLS) recusou a escrita. | Verifique as `securityRules` da collection. |

## `PG_<SQLSTATE>` — uma restrição recusada pelo banco de dados

Uma escrita que o Postgres rejeita por um motivo relacionado aos *dados do
chamador* responde com o SQLSTATE no próprio código: `PG_23505`, `PG_23503` e
assim por diante. Trata-se de uma família, não de uma lista fixa — o Postgres
define centenas de SQLSTATEs —, mas apenas duas classes chegam a ser expostas,
pois somente essas duas decorrem de erro do chamador:

- **classe 23**, violação de restrição de integridade: uma duplicata, uma chave
  estrangeira que aponta para o vazio, uma coluna NOT NULL deixada em branco;
- **classe 22**, exceção de dados: um valor que o tipo da coluna não suporta.

Tudo o mais — uma conexão perdida, uma coluna ausente, um problema de
privilégios — é de responsabilidade do servidor e permanece como `500`. Portanto,
`code.startsWith("PG_")` é um teste seguro para "a linha enviada estava errada",
e os quatro abaixo são os que um cliente realmente encontra. `details.dbCode`
traz o mesmo SQLSTATE para todos eles, e a mensagem informa a restrição violada.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Não foi possível interpretar o valor como o tipo da coluna — o equivalente no lado da escrita a `INVALID_FILTER_VALUE`. | Envie um valor compatível com o tipo da coluna. |
| `PG_23502` | 400 | Uma coluna `NOT NULL` foi deixada em branco. | Envie o campo ou defina um valor padrão para a coluna. |
| `PG_23503` | 400 | Uma chave estrangeira aponta para uma linha inexistente. | Crie a linha de destino primeiro ou corrija o id. |
| `PG_23505` | 409 | Uma restrição de unicidade (unique constraint) foi violada. A mensagem informa o nome da restrição. | Use um valor diferente ou atualize a linha existente. |

## Armazenamento (Storage)

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_STORAGE_BUCKET` | 400 | O nome do bucket está malformado. | Verifique o nome. |
| `INVALID_STORAGE_KEY` | 400 | A chave do objeto está malformada ou escapa do seu prefixo. | Verifique a chave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Os parâmetros de transformação de imagem estão fora do intervalo ou são contraditórios. | Consulte [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | O upload excede o `maxSize` declarado pela propriedade de destino. Aplicado no servidor, não apenas no navegador. `details` informa a propriedade, o limite e o tamanho real. | Envie um arquivo menor ou aumente o `maxSize` na propriedade. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | O tipo do arquivo enviado não está no `acceptedFiles` da propriedade. `details` informa a propriedade, a lista aceita e o tipo de conteúdo enviado. | Envie um tipo aceito ou amplie o `acceptedFiles`. |
| `STORAGE_NOT_CONFIGURED` | 503 | Nenhum backend de armazenamento está configurado neste servidor. | Configure S3, GCS ou armazenamento local. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | A fonte de armazenamento está declarada, mas não possui credenciais aqui. | Defina as variáveis de ambiente dessa fonte. |
| `STORAGE_WRITE_FAILED` | 502 | O backend de armazenamento recusou ou interrompeu a gravação. | Verifique os logs e as credenciais do próprio serviço. |
| `TRANSFORM_OVERLOADED` | 503 | Muitas transformações de imagem em andamento simultaneamente. | Tente novamente; considere colocar uma CDN à frente. |
| `UNKNOWN_STORAGE_SOURCE` | 400 | A requisição indicou uma fonte de armazenamento (`?storageId=`) que este projeto não declara. Um `bucket` que este deploy não atende retorna o mesmo código com **404** — o repositório é o que está ausente, e `details` informa os buckets e as fontes que realmente existem. Ambos costumavam retornar como "arquivo não encontrado", idêntico a uma chave simplesmente inexistente. | Declare a fonte em `config/resources.ts` ou consulte `GET /api/storage/sources`. |

## Funções personalizadas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nenhuma função com esse nome está disponível — ou ela existe, mas suas rotas internas não cobrem o caminho solicitado. Um chamador autenticado também é informado sobre o que *está* disponível; um chamador anônimo não recebe essa informação, pois essa lista é um inventário de todos os endpoints customizados. Quando um arquivo com esse nome falha ao carregar, a mensagem explicita o fato: essa é a diferença entre um erro de digitação e um deploy quebrado. | Compare o nome com `GET /api/functions` ou verifique o log de inicialização em busca de um arquivo que não pôde ser carregado. |
| `FUNCTION_TIMEOUT` | 504 | O handler excedeu seu tempo limite. Ele continua em execução; não pode ser cancelado a partir daqui. | Passe um `AbortSignal` para chamadas externas ou aumente `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este processo faz proxy de funções para outro, que não respondeu. | Verifique se a unidade de funções está em execução. |

## Superfícies de administração e edição de schema

Estes códigos indicam que um recurso está desativado ou não configurado, e não
que a requisição estava incorreta. Cada um deles também é informado na rota
`/status` correspondente com status `200`, permitindo que um painel desabilite
visualmente o recurso em vez de exibir um erro.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Uma interface exclusiva para administradores foi chamada em um servidor sem autenticação configurada, impossibilitando distinguir um administrador de qualquer outro usuário. | Defina `auth.jwtSecret` ou forneça um `AuthAdapter`. |
| `CONTRACT_UNAVAILABLE` | 404 | O contrato do projeto é servido apenas quando a autenticação está configurada — ele descreve todas as tabelas e relações. | Configure a autenticação. `/meta/schema-version` é sempre servido. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nenhuma caixa de correio de desenvolvimento está ativa. As mensagens só são capturadas quando `SMTP_HOST` não está definido e `NODE_ENV` não é production. | Remova `SMTP_HOST` em desenvolvimento ou consulte a caixa de entrada real. |
| `INVALID_CHANGE` | 400 | A alteração de schema proposta não está bem formatada. | Veja a mensagem. |
| `SCHEMA_CHANGE_FAILED` | 400 | A aplicação de uma alteração planejada de schema falhou por um motivo não coberto por códigos mais específicos. | Veja a mensagem; ela reproduz a falha subjacente na íntegra. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | A alteração é válida, mas não pode ser aplicada ao schema no estado atual. | Veja a mensagem. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | O repositório possui alterações não commitadas, portanto a edição não pôde ser aplicada com segurança. | Faça commit ou stash e tente novamente. |
| `SCHEMA_EDIT_REFUSED` | 400 | O editor de schema recusou a alteração. | Veja a mensagem; trata-se da própria recusa emitida pelo editor. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Uma chave de API ou outro agente automatizado tentou aplicar uma alteração de schema. | Faça login como usuário humano ou defina `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | A edição de schema em tempo real requer `collectionsDir` ou `liveSchema.repository`, e este servidor foi iniciado sem nenhum deles. | Configure um deles. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | O planejamento funciona; não há repositório no qual commitar a alteração. | Configure `liveSchema.repository`. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este driver não pode planejar alterações de schema. | A edição em tempo real está disponível no Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | As collections são derivadas por introspecção do banco de dados aqui, portanto não há arquivos-fonte para editar. | Altere o schema por meio de uma migration. |
| `SCHEMA_EDITOR_DISABLED` | 501 | O editor de schema está desativado para este servidor. | Ative-o com `schemaEditor`. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | O editor de schema requer o `ts-morph`, que não está instalado. | Execute `pnpm add -D ts-morph@28.0.0`. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | O servidor não possui `collectionsDir`, portanto o editor não tem onde gravar. | Defina `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | O editor fica desativado sob `NODE_ENV=production`: os arquivos de um servidor em produção são reconstruídos a partir do seu repositório a cada deploy, logo uma edição aqui seria descartada. | Edite as collections em desenvolvimento e faça o deploy. |

## Códigos genéricos

Uma rota usa um destes códigos quando nenhum outro mais específico se aplica.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformada, e nada mais específico se aplica. | Veja a mensagem. |
| `UNAUTHORIZED` | 401 | Não autenticado ou a credencial foi rejeitada. | Faça login ou renove as credenciais. |
| `FORBIDDEN` | 403 | Autenticado, mas não permitido. | Tentar novamente com a mesma identidade não resolverá. |
| `CONFLICT` | 409 | Um conflito com o estado existente. | Veja a mensagem. |
| `INTERNAL_ERROR` | 500 | Algo falhou no servidor. A mensagem é deliberadamente genérica. | Informe o `requestId`; o motivo detalhado está nos logs. |
| `NOT_CONFIGURED` | 503 | Uma dependência que esta rota requer não está configurada neste servidor. | Veja a mensagem. |
| `SERVICE_UNAVAILABLE` | 503 | Uma dependência estava inacessível. | Tente novamente; verifique os logs. |

## Mantendo esta página precisa

O comando `pnpm verify:docs` falha quando um código que o servidor pode emitir
está ausente nestas tabelas, quando uma tabela lista um código que nada pode
gerar, quando um status declarado diverge do código-fonte, ou quando uma
família de códigos como `PG_<SQLSTATE>` não possui linha para um SQLSTATE
encontrado pelos chamadores. O script correspondente é
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Ele valida a si próprio primeiro. A varredura extrai os códigos diretamente do
TypeScript em vez de consultar um servidor em execução, de modo que seus pontos
cegos são silenciosos por concepção: no passado, ele não conseguia identificar
um código passado por um wrapper de linha única ou escrito após uma mensagem
contendo `)`, relatando falsamente que "todos os códigos emitidos pelo servidor
estão documentados" em uma página que omitia dezessete deles. Por isso, a rotina
executa um teste com essas estruturas exatas antes de ler esta página e se
recusa a gerar qualquer relatório caso não consiga detectá-las.

---
