---
sourceHash: 972a11a8dc0defac
title: Edição de schema ao vivo
description: Crie e altere tabelas em um backend em execução — a edição é gravada em backend/schema, commitada no seu repositório primeiro e depois aplicada.
---

O editor de schema no painel de administração reescreve os arquivos de tabela em
`backend/schema`. Isso funciona na sua máquina e em nenhum outro lugar: os arquivos
de um servidor em produção são reconstruídos a partir do seu repositório a cada deploy,
portanto, uma edição feita lá seria descartada no próximo.

A edição de schema ao vivo é a resposta para isso. Ela **faz o commit da alteração no seu
repositório e, em seguida, aplica o DDL** — para que a edição sobreviva ao próximo deploy,
pois o deploy é construído a partir dele.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

Status e plan precisam do escopo `schema:read`, e apply precisa de `schema:write`, como
qualquer outra superfície de `/api/admin` que define um escopo. Um administrador possui ambos.
A aplicação também precisa de mais uma coisa além do escopo — consulte [Quem pode aplicar](#quem-pode-aplicar).

## As edições: `TablePatch`

Toda rota que altera o schema recebe o mesmo corpo, `{ patches }`: uma lista
de edições, cada uma nomeando sua tabela por slug. O tipo é `TablePatch`, de
`@rebasepro/types`.

| `op` | O que grava em `backend/schema` |
|---|---|
| `createTable` | um novo `backend/schema/<name>.ts` contendo a tabela, exportado de `index.ts` |
| `deleteTable` | remove o arquivo e sua exportação |
| `addColumn` `{ key, column, before? }` | uma coluna, antes da especificada por `before`, ou por último |
| `changeColumn` `{ key, column }` | reescreve a cadeia de builders de uma coluna; um `.transform()` escrito nela é mantido |
| `renameColumn` `{ key, to, column }` | renomeia a chave, mantendo a coluna SQL |
| `removeColumn` `{ key }`, `moveColumn` `{ key, before? }` | remove ou reordena uma coluna |
| `addRelation`, `changeRelation` `{ name, relation }`, `removeRelation` `{ name }` | uma entrada `rel.*`; o `target` da relação é um slug |
| `setRls` `{ rls }` | a postura: `"admin-only"`, `"inherit"` ou uma lista de regras |
| `addRule` `{ rule, index? }`, `replaceRule` `{ index, rule }`, `removeRule` `{ index }` | uma regra da lista |
| `setOption` `{ option, value }` | `description`, `tenant`, `softDelete`, `history`, `search`, `indexes`, `strictWrites`, `defaultPolicies` ou `metadata`; `null` a remove |

Uma coluna trafega como sua definição — o tipo Postgres como `{ kind: … }` e os
modificadores como flags — sem seus hooks `.transform()`, que são código e permanecem
onde foram escritos:

```json
{ "patches": [
    { "op": "addColumn", "table": "posts", "key": "subtitle",
      "column": { "type": { "kind": "text" } } }
] }
```

Apenas o código indicado por uma edição é reescrito. Todo o resto permanece como está —
importações, comentários, formatação, uma coluna compartilhada de outro módulo. O editor
recusa, indicando a expressão, uma edição que tenta acessar *dentro* de algo definido
em código: uma tabela construída com spread, uma coluna construída por um helper, regras
contidas em uma variável, uma chave computada, uma coluna cuja estrutura JSON carrega transforms.
Ele também nunca renomeia um slug, uma tabela, um schema ou o nome de uma definição (isso
move dados: escreva uma migração), nunca remove a última regra (use `setRls` com
`"admin-only"`), recusa `rls` em uma view e recusa excluir uma tabela apontada por outras
relações. Uma edição cujo resultado não compila é recusada com
`SCHEMA_EDIT_DOES_NOT_COMPILE` e os problemas do compilador. Nada é gravado em caso de recusa.

A aparência de uma tabela no painel de administração — rótulos, ícones, grupos, modos
de visualização, cores de enum — não é uma edição de schema: ela reside em `frontend/src/cms`
e nas preferências salvas do painel, e nada disso trafega em um `TablePatch`.

`$ADMIN_TOKEN` é um token de acesso — o `accessToken` retornado por um login — para uma
conta que possui `schema:read`: um administrador ou uma role que o declare. Nada na
máquina define isso para você.

## Planeje antes de aplicar

O `/plan` não tem efeitos colaterais. Envie as edições via POST e ele informará o que elas significam:

```bash
curl -X POST https://your-app/api/admin/schema/plan \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"patches":[{"op":"addColumn","table":"posts","key":"subtitle","column":{"type":{"kind":"text"}}}]}'
```

```json
{
  "applicable": true,
  "verdict": "safe",
  "changes": [
    { "kind": "add-property", "verdict": "safe", "collection": "posts",
      "property": "subtitle", "detail": "New optional property subtitle …" }
  ],
  "statements": ["ALTER TABLE \"public\".\"posts\" ADD COLUMN IF NOT EXISTS \"subtitle\" TEXT;"],
  "files": ["backend/schema/posts.ts", "backend/src/schema.generated.ts"],
  "message": "…the commit message the apply would use…",
  "withheldConstraints": [],
  "followUp": []
}
```

`files` são todos os arquivos commitados pelo apply: o código-fonte da tabela, quando
o backend pode gravá-lo, e depois o schema gerado. Os registros de alteração do planejador
mantêm seus nomes de transmissão (`add-property`, `collection`, `property`).

Isso não é apenas uma conveniência. Dois dos três vereditos são recusas, e um deles é
uma recusa que, de outra forma, você só descobriria ao apertar o botão em um banco de dados
em produção.

## Os três vereditos

| Veredito | Significado |
|---|---|
| `safe` | O caminho de ensure durante o boot consegue expressá-lo e o resultado corresponde à sua configuração. Aplicado. |
| `diverges` | Aplica-se *em parte*, deixando um banco de dados que não corresponde à sua configuração — e nada relata isso. Recusado. |
| `needs-migration` | O caminho de ensure não consegue expressá-lo de forma alguma. Recusado. |

`diverges` é o que vale a pena entender, porque essas alterações parecem ter funcionado:

- **Uma coluna `.notNull()` adicionada a uma tabela que já possui linhas** chega
  como **nullable**. O `NOT NULL` é verificado em cada linha já existente, e as linhas
  gravadas antes da existência da coluna não têm valor para ela. Em uma tabela **vazia**,
  não há nada a verificar, portanto a constraint é aplicada e isso é `safe`.
- **Tornar uma coluna existente `.notNull()`** segue a mesma lógica: `SET NOT NULL`
  faz uma varredura na tabela, portanto é `safe` em uma tabela vazia e `diverges` em
  uma populada até que você faça o backfill.

Duas alterações que costumavam ser `diverges` agora são `safe`, porque o caminho de
ensure as executa:

- **Um valor adicionado a um enum existente** é aplicado via
  `ALTER TYPE … ADD VALUE IF NOT EXISTS`. Antes, ele era ignorado junto com o tipo
  inteiro, e a primeira linha que usava o novo valor era rejeitada por um tipo que
  nunca tinha ouvido falar dele.
- **Relaxar uma coluna `.notNull()`** remove o `NOT NULL`. Antes, ele era mantido
  no lugar, fazendo com que gravações que omitiam a coluna ainda falhassem.

### Constraints solicitadas e não aplicadas

Uma alteração pode ser aplicável e ainda deixar algo que sua configuração solicita
sem ser aplicado — uma coluna `.notNull()` sobre uma tabela populada é o caso. Isso não
é uma recusa, portanto não aparece em `changes`; aparece em `withheldConstraints`,
com o obstáculo e o que o resolveria:

```json
{
  "withheldConstraints": [
    {
      "target": "public.posts.author",
      "kind": "not-null",
      "reason": "\"author\" is required, but \"public.posts\" already holds rows …",
      "remedy": "Backfill the column, then apply this again."
    }
  ]
}
```

O caminho de ensure durante o boot relata a mesma coisa como um aviso. Até a existência
disso, uma constraint retida era retida em silêncio.

`needs-migration` cobre tudo o que o caminho de ensure não pode fazer: remover uma
tabela ou uma coluna, alterar o tipo de uma coluna (um toggle de inteiro, uma string
tornando-se um enum, o tipo de elemento de um array, o tamanho de um varchar), renomear
uma coluna, alterar uma chave primária, remover um valor de enum, tornar uma coluna
existente única e alterar uma relação — seu tipo, seu target, seu `localKey`, seu
`onDelete`. Um `hasMany` ou `hasOne` cuja coluna de ligação nada cria também é recusado.
Cada recusa especifica a alteração e o que fazer em vez disso.

O veredito é lido a partir do schema que cada lado produz — o mesmo plano a partir do
qual `schema.generated.ts` e `db push` são gerados —, de modo que uma edição que altera
o banco de dados não pode ser relatada como nenhuma alteração. Duas edições que parecem
alterações e não são recusadas:

- **Renomear a chave de uma coluna mantendo sua coluna SQL** (`renameColumn`, que
  grava o nome antigo como o primeiro argumento do builder, `col.text("old_name")`)
  não move dados. É `safe`; os clientes da API leem o novo nome.
- **Definir, alterar ou remover um default** afeta apenas gravações futuras. É
  `safe` e aplicado com `ALTER COLUMN … SET DEFAULT` / `DROP DEFAULT`.

### Editar apenas o código-fonte

Uma alteração recusada ainda pode ser gravada em `backend/schema` e commitada,
deixando o banco de dados como está — remover uma coluna que você não atende mais é o
caso comum. Faça um POST em `/apply` com `"sourceOnly": true`. Nada é executado; a mensagem
de commit especifica o que o banco de dados mantém, por exemplo
`chore(schema): remove sku from products (source only — column products.sku kept)`,
e cada alteração no plano traz uma frase de `sourceOnly` dizendo o que ela deixa para
trás — inclusive quando uma coluna deixada para trás for `NOT NULL` sem default, o que
faz com que cada insert posterior falhe até que ela seja removida ou tornada anulável.
Uma alteração sem isso (mover uma chave primária, uma relação cuja coluna de ligação nada
cria) não pode ser gravada apenas no código-fonte.

Em uma implantação que não altera nada em seu banco de dados (`REBASE_PROVISION=false`),
nenhuma alteração é aplicada a partir do painel, portanto toda alteração segue este
caminho: o botão principal da caixa de diálogo exibe **Commit** e envia `"sourceOnly": true`,
e o processo que altera esse banco de dados aplica o schema.

Excluir uma tabela do painel de administração segue o mesmo caminho: `/apply` com uma
edição `deleteTable` e `"sourceOnly": true` exclui o arquivo da tabela e sua exportação
em `index.ts` e commita ambos; a tabela e suas linhas permanecem no banco de dados.
Isso é recusado enquanto uma relação de outra tabela apontar para ela, especificando
essa tabela — excluí-la impediria o schema de compilar.

## O que é commitado

Não apenas o arquivo da tabela. O schema do Drizzle é gerado a partir dele, e um
schema desatualizado quebra o próximo deploy, então ambos entram no mesmo commit:

- `backend/schema/<name>.ts` — a própria tabela, e `backend/schema/index.ts` quando uma tabela é criada ou excluída
- `backend/src/schema.generated.ts` — o schema do Drizzle

Esses caminhos são relativos ao seu **projeto**, não ao seu repositório. Quando os
dois são iguais — um projeto `rebase init`, que é o caso comum —, não há com o que
se preocupar. Quando o seu projeto está em um subdiretório de um repositório maior,
os caminhos recebem esse prefixo, localizado subindo a partir do seu diretório de schema
até o `rebase.json` mais próximo. Um projeto sem `rebase.json` mantém os caminhos simples.

Nenhum SQL entra no commit. `rebase db push` e `rebase db generate` geram seus SQLs a
partir das tabelas a cada execução, em `.rebase/sql/`, que está no gitignore.

A mensagem de commit descreve a alteração em vez de simplesmente anunciar uma, e é
atribuída à pessoa que a realizou, pelo nome de exibição e e-mail da conta (um usuário
sem nenhum dos dois é commitado como `<uid>@users.noreply.rebase.pro`).

Uma alteração de schema com autor e um diff no histórico do seu projeto é algo que nem
o Firebase nem o Supabase oferecem — as edições de tabela deles são invisíveis para o
seu repositório.

## Quem pode aplicar

Possuir `schema:read` é suficiente para fazer o **plan**. O planejamento não tem efeitos
colaterais, e um job de CI verificando se uma alteração de schema proposta é aplicável
é um bom caso de uso para ele.

A aplicação é um segundo privilégio, porque aplicar grava um commit e um commit
carrega um autor:

| Chamador | Plan | Apply |
|---|---|---|
| Uma pessoa conectada possuindo `schema:write` | sim | sim |
| Uma chave de API possuindo `schema:read` / `schema:write` | sim | não |
| A chave de serviço do servidor | sim | não |

Uma credencial não é um autor. `api-key:7c3f…` no seu ambiente de CI não é uma pessoa,
e permitir que ela grave no seu repositório produz exatamente o histórico sem atribuição
que esta funcionalidade existe para substituir.

Se uma alteração de schema automatizada é o que você deseja — digamos, um pipeline
de migração —, ative-a deliberadamente:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

ou `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. O commit é então atribuído à credencial
pelo nome — `Rebase API key (7c3f)` — para que a leitura do `git log` um mês depois ainda
informe quais alterações foram feitas por uma pessoa.

`GET /api/admin/schema/status` relata o que *você* pode fazer, não apenas o que o servidor
suporta, para que um painel possa desativar o controle e explicar o motivo, em vez de
recusá-lo depois de você ter decidido:

```json
{
  "enabled": true,
  "canPlan": true,
  "canApply": false,
  "applyRefusedCode": "SCHEMA_EDIT_REQUIRES_A_PERSON",
  "applyRefusedBecause": "This request is authenticated with an API key …"
}
```

## Se o seu projeto mantém migrações versionadas

Aplicar aqui **não** grava uma migração, e não pode fazê-lo: uma migração está no
formato do Atlas com um arquivo de integridade, gerada por um binário externo contra um
banco de dados temporário, e um servidor em execução não possui nenhum dos dois.

O que ele commita é o arquivo da tabela, e é a partir dele que o `rebase db generate`
cria a migração. Portanto, a migração está a apenas um comando de distância:

```bash
rebase db generate
```

Tanto o plano quanto o resultado informam isso quando o seu projeto possui migrações,
pois, caso contrário, a falha é silenciosa: seu banco de dados tem a alteração e seu
repositório a descreve, mas o próximo ambiente construído pela reprodução das migrações
não a terá, e nada avisará sobre isso.

Um projeto provisionado por boot-ensure — o runtime gerenciado e qualquer self-host
deixando `REBASE_MIGRATE_ON_BOOT` em seu padrão — não precisa de nenhuma migração.
Suas tabelas são o schema, e a próxima inicialização faz a reconciliação.

## Commit primeiro, depois aplique

A ordem importa e não é arbitrária.

Se o DDL fosse executado primeiro e o commit falhasse, seu banco de dados teria uma coluna
que seu repositório não descreve. O caminho de ensure nunca remove nada, portanto o
próximo deploy não a removeria nem a mencionaria — uma coluna invisível, ausente das
suas tabelas, até que alguém fosse procurá-la.

Fazer o commit primeiro falha no sentido oposto: o repositório descreve algo que o banco
de dados ainda não possui. Esse é o estado comum de todo projeto entre uma edição e um
deploy, e o boot o reconcilia na próxima inicialização.

Portanto, uma aplicação que falha **não é um erro**. A resposta diz isso:

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## As regras entram em vigor na mesma aplicação

Uma alteração no `rls` de uma tabela (ou uma nova tabela) entra em vigor na mesma
aplicação: as políticas das tabelas alteradas são gravadas no banco de dados logo após
o DDL, e a resposta informa o que aconteceu em `policies`:

```json
{ "policies": { "status": "applied", "tables": ["posts"], "statements": 3 } }
```

Onde as políticas não podem ser gravadas — um backend que não pode provisionar
(`provision.tables` desativado) ou um driver sem essa capacidade —, o status é
`"deferred"`; quando a gravação falha, é `"failed"`, acompanhado do erro. Ambos trazem
a mensagem "Rules saved to source; they take effect on the next deploy.", e o painel
continua mostrando as regras que o Postgres aplica até então, nunca regras que não
estejam em vigor.

Hooks editados no código-fonte também entram em vigor com a aplicação: o servidor executa
as tabelas compiladas do schema editado sem a necessidade de reinicialização.

## Disponibilizado sem reinicialização

Uma alteração aplicada a partir do Studio é disponibilizada imediatamente. O driver do
Postgres lê as tabelas alteradas de volta do banco de dados e as substitui em tempo real:
a API de dados, includes, hooks e realtime enxergam uma nova tabela, coluna, relação ou
junção sem necessidade de reinicialização, e uma nova tabela obtém seus privilégios (grants)
e captura de alterações. A resposta informa isso em `serving`:

```json
{ "serving": { "status": "now" } }
```

Em uma implantação cujas tabelas são derivadas do banco de dados (sem `backend/schema`),
ou com um driver que não pode atualizar suas tabelas, o banco de dados e o código-fonte
têm a alteração, mas o processo continua servindo as tabelas com as quais foi iniciado.
O status é então `"after-restart"`, com uma `message` que o recibo do Studio mostra como
aviso; reinicie o processo para disponibilizar a alteração.

## Quando o arquivo foi alterado durante a edição

Uma edição é preparada com base nos arquivos como eles estão. Se um deles mudar no disco
antes que a edição seja aplicada — um salvamento na IDE, outro processo —, o apply
não grava nada e responde com 409 `SCHEMA_EDIT_STALE_FILE`. Faça a edição novamente
com base no arquivo como ele está agora.

## Onde isso funciona

A edição de schema ao vivo reescreve `backend/schema` com o mesmo editor usado pelos
salvamentos somente no código-fonte do painel (requer `ts-morph` instalado). A origem
desse código-fonte determina onde ele é executado:

- **No disco** (`schemaDir`, o padrão): ele é executado onde o editor somente de
  código-fonte é executado. Esse editor fica desativado sob `NODE_ENV=production`, a
  menos que o servidor defina `schemaEditor: true`.
- **Em um repositório especificado por você** (`liveSchema.repository` ou
  `REBASE_LIVE_SCHEMA_REPOSITORY` para um bundle): o código-fonte é lido do GitHub e a
  alteração é commitada de volta para lá, funcionando em qualquer lugar, incluindo
  produção. Essa é a forma de ativação para um bundle compilado.

| Implantação | Funciona |
|---|---|
| `rebase dev` na sua máquina | sim |
| Self-host com o projeto e sua árvore de trabalho git montados | sim, quando `NODE_ENV` não é `production`, ou com `schemaEditor: true` |
| Um bundle compilado: um self-host servindo uma build ou a imagem publicada | apenas quando ativado com `REBASE_LIVE_SCHEMA_REPOSITORY` — consulte [A partir de um bundle compilado](#a-partir-de-um-bundle-compilado) |
| Qualquer servidor com `liveSchema.repository` configurado | sim, incluindo `NODE_ENV=production` |

Um bundle é uma saída compilada, portanto não há código-fonte de `backend/schema` nele,
e o runtime que o executa desativa o editor somente de código-fonte. A menos que ele
especifique um repositório, `/api/admin/schema/status` responde com `enabled: false` e
o código `SCHEMA_EDITOR_DISABLED`: edite `backend/schema` em desenvolvimento, commite e
faça o deploy.

### A partir de um bundle compilado

Um bundle não tem código próprio para configurar, portanto ele é ativado via variáveis
de ambiente. Nada muda para um bundle que não as defina.

```bash
REBASE_LIVE_SCHEMA_REPOSITORY=acme/storefront     # turns it on
REBASE_LIVE_SCHEMA_GITHUB_TOKEN=github_pat_…       # or the three _GITHUB_APP_* variables
# REBASE_LIVE_SCHEMA_BRANCH=main                   # default
# REBASE_LIVE_SCHEMA_PATH=backend/schema           # default
```

A lista completa está em [Configuração](/docs/getting-started/configuration#live-schema-editing-from-a-bundle).
Um repositório especificado sem uma credencial utilizável (nenhuma, ambos os tipos,
metade de um GitHub App) ou com um valor que não seja `owner/name` recusa-se a
inicializar, em vez de servir um editor que falha quando alguém pressiona Apply. O mesmo
se aplica ao removido `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`, com uma mensagem indicando
`REBASE_LIVE_SCHEMA_PATH`, e a um caminho que saia do repositório.

O que permanece igual quando está ativado:

- É uma superfície de `/api/admin`: nenhuma resposta sem `schema:read`, e
  `/apply` precisa de `schema:write` e de uma pessoa (consulte [Quem pode aplicar](#quem-pode-aplicar)).
- O destino de gravação é apenas o repositório que você especificou. O editor somente de
  código-fonte, que grava arquivos ao lado do processo, permanece desativado.
- Cada alteração é planejada, exibida, commitada e depois aplicada, exatamente como na
  sua máquina.

O processo que aplicou a alteração a disponibiliza imediatamente: suas rotas REST, os
descritores de `GET /api/schema/tables` e o painel de administração acompanham a edição
sem reinicialização. Outras réplicas, e este processo após uma reinicialização, atendem
com as tabelas com as quais o bundle foi construído até que seu pipeline construa e
faça o deploy do commit.

Portanto, uma alteração aguarda a anterior ser disponibilizada. Uma alteração planejada
com base em tabelas em relação às quais o repositório já está à frente commitaria
arquivos de schema gerados que deixariam a alteração anterior de fora. Cada apply,
portanto, renderiza `schema.generated.ts` a partir das tabelas que este processo atende
e o compara com a cópia do repositório. Quando diferem, o apply é recusado com
`SCHEMA_CHANGE_FAILED`, indicando o arquivo, até que um processo executando esse commit
substitua este. A verificação lê o repositório, não a memória deste processo, portanto é
válida entre reinicializações, entre réplicas e para uma alteração que um desenvolvedor
enviou via push mas que ainda não foi implantada. O planejamento permanece disponível
nesse meio-tempo.

As cópias também diferem quando o arquivo foi gerado por outra versão do Rebase,
reformatado ou editado manualmente. Se não houver nada aguardando deploy, execute
`rebase schema generate` com a versão que a implantação executa, commite o resultado
e faça o deploy. Quebras de linha e espaços em branco no final não contam como diferença.

### Fazendo commit em um repositório remoto

`liveSchema.repository` faz com que o servidor commite cada alteração em um repositório
GitHub por meio da Git Data API em vez de executar `git commit` em uma árvore de trabalho.
Isso não depende de o editor somente de código-fonte estar ativado: com um repositório
configurado, a edição ao vivo funciona sob `NODE_ENV=production` e com `schemaEditor: false`,
porque nada nesta máquina é gravado. Um bundle configura isso por meio das variáveis acima.

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: {
        repository: {
            kind: "github",
            owner: "acme",
            repo: "storefront",
            branch: "main",
            // Where backend/schema lives in that repository.
            // Defaults to "backend/schema".
            schemaPath: "backend/schema",
            auth: { kind: "token", token: process.env.GITHUB_TOKEN! }
        }
    }
})
```

O diretório do schema é então lido a partir do repositório, reescrito com o mesmo editor
que executa localmente, e o que mudou é commitado de volta por meio da Git Data API: um blob
por arquivo, uma árvore (tree), um commit e uma atualização de ref. Nada é clonado e nada
é deixado no disco. O diretório inteiro é lido, não apenas o arquivo editado, para que
uma relação possa ter como alvo outra tabela e a exclusão de uma tabela funcione como
funciona localmente: recusada enquanto a relação de outra tabela apontar para ela e
removida de `index.ts` no mesmo commit. Apenas `backend/schema` é buscado, portanto um
arquivo de tabela que importe algo fora dele não pode ser editado dessa maneira.

`auth` aceita um token ou uma instalação de GitHub App:

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Use o token para um único projeto fazendo commit em um repositório que você já possui —
configurar um App apenas para que seu próprio servidor possa fazer commit nele é muita
burocracia para uma credencial de uma linha. Use o App para um plano de controle que
mantém uma chave em vários projetos, que é o que o Rebase Cloud faz: um App, uma instalação
por projeto e nenhum segredo por cliente para rotacionar.

O token precisa de `contents: read and write` nesse repositório, e nada mais.

Sem `liveSchema.repository`, o commit é um simples `git commit` na árvore de trabalho que
contém `schemaDir`: nada para autenticar, nenhum token, nenhuma rede.

Duas coisas que tornam seguro executá-lo em um repositório no qual outra pessoa está
trabalhando:

- Ele adiciona à stage **apenas** os arquivos que gerou. Um commit de schema que
  incluísse trabalho inacabado seria um commit que ninguém conseguiria revisar, e ele
  recusa imediatamente se a árvore já tiver um de seus próprios arquivos modificado.
- O caminho remoto nunca atualiza uma ref com force. Se algo foi enviado enquanto o
  commit estava sendo construído, a atualização é rejeitada — perder o commit de alguém
  silenciosamente é pior do que falhar.

## Limitações

- Apenas alterações aditivas. Todo o resto é recusado com um motivo, porque o caminho
  de ensure é a única coisa que altera um schema e ele só pode adicionar.
- Nenhum arquivo de migração é gravado. Um projeto provisionado por boot-ensure não precisa
  de nenhum; um projeto provisionado por migrações deve executar `rebase db generate`,
  que gera uma migração por meio do Atlas com o hash de integridade que o Atlas exige.
- Apenas Postgres. O recurso é detectado no driver, e um driver sem ele responde com
  `SCHEMA_EDITING_UNSUPPORTED`.
- Uma implantação cujas tabelas são derivadas do banco de dados disponibiliza uma alteração
  aplicada após a próxima inicialização (`serving.status: "after-restart"`, consulte
  [Disponibilizado sem reinicialização](#disponibilizado-sem-reinicialização)).

## Relacionado

- [Geração de Schema](/docs/cli/schema/) — as mesmas edições a partir da linha de comando
- [Tabelas](/docs/schema/) — o que o editor está reescrevendo
- [Studio](/docs/studio/) — o painel por trás dessas rotas
