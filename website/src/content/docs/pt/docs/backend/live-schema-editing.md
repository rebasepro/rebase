---
sourceHash: a8ca2780e6bbad15
title: Edição de schema em tempo real
description: Crie e altere tabelas em um backend em execução — a edição é gravada em backend/schema, confirmada primeiro em seu repositório e depois aplicada.
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O editor de schema no painel de administração reescreve os arquivos de tabela em
`backend/schema`. Isso funciona na sua máquina e em nenhum outro lugar: os
arquivos de um servidor implantado são reconstruídos a partir do seu repositório a
cada deploy, portanto, uma edição feita lá seria descartada no próximo.

A edição de schema em tempo real é a resposta para isso. Ela **faz o commit da
alteração no seu repositório e, em seguida, aplica o DDL** — para que a edição
sobreviva ao próximo deploy, pois o deploy é construído a partir dela.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

Status e plan precisam do escopo `schema:read`, e apply precisa de `schema:write`,
como qualquer outra superfície `/api/admin` que especifique um escopo. Um
administrador possui ambos. Aplicar também requer uma coisa a mais além do escopo
— veja [Quem pode aplicar](#quem-pode-aplicar).

## As edições: `TablePatch`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Cada rota que altera o schema recebe o mesmo corpo, `{ patches }`: uma lista
de edições, cada uma nomeando sua tabela por slug. O tipo é `TablePatch`, de
`@rebasepro/types`.

| `op` | O que ele grava em `backend/schema` |
|---|---|
| `createTable` | um novo `backend/schema/<name>.ts` contendo a tabela, exportado de `index.ts` |
| `deleteTable` | remove o arquivo e sua exportação |
| `addColumn` `{ key, column, before? }` | uma coluna, antes daquela indicada por `before`, ou por último |
| `changeColumn` `{ key, column }` | reescreve a cadeia de builders de uma coluna; um `.transform()` definido nela é mantido |
| `renameColumn` `{ key, to, column }` | renomeia a chave, mantendo a coluna SQL |
| `removeColumn` `{ key }`, `moveColumn` `{ key, before? }` | remove ou reordena uma coluna |
| `addRelation`, `changeRelation` `{ name, relation }`, `removeRelation` `{ name }` | uma entrada `rel.*`; o `target` da relação é um slug |
| `setRls` `{ rls }` | a postura: `"admin-only"`, `"inherit"` ou uma lista de regras |
| `addRule` `{ rule, index? }`, `replaceRule` `{ index, rule }`, `removeRule` `{ index }` | uma regra da lista |
| `setOption` `{ option, value }` | `description`, `tenant`, `softDelete`, `history`, `search`, `indexes`, `strictWrites`, `defaultPolicies` ou `metadata`; `null` remove |

Uma coluna é transmitida como sua definição — o tipo Postgres como `{ kind: … }` e
os modificadores como flags — sem seus hooks `.transform()`, que são código e
permanecem onde foram escritos:

```json
{ "patches": [
    { "op": "addColumn", "table": "posts", "key": "subtitle",
      "column": { "type": { "kind": "text" } } }
] }
```

Apenas o código indicado por uma edição é reescrito. Todo o restante permanece
como está — imports, comentários, formatação, uma coluna compartilhada de outro
módulo. O editor recusa, indicando a expressão, uma edição que acesse o *interior*
de algo definido no código: uma tabela construída com spread, uma coluna construída
por um helper, regras mantidas em uma variável, uma chave computada, uma coluna
cuja estrutura JSON contenha transformações. Ele também nunca renomeia um slug,
uma tabela, um schema ou o nome de uma definição (isso move dados: crie uma
migration), nunca remove a última regra (use `setRls` com `"admin-only"`),
recusa `rls` em uma view e recusa excluir uma tabela que outras relações tenham
como alvo. Uma edição cujo resultado não compila é recusada com
`SCHEMA_EDIT_DOES_NOT_COMPILE` e os erros do compilador. Nada é gravado em caso de
recusa.

A aparência de uma tabela no painel de administração — rótulos, ícones, grupos,
modos de visualização, cores de enum — não é uma edição de schema: ela reside em
`frontend/src/cms` e nas preferências salvas do painel, e nada disso trafega em
um `TablePatch`.

`$ADMIN_TOKEN` é um token de acesso — o `accessToken` que o login retorna — para
uma conta que possui `schema:read`: um administrador ou uma role que o declare.
Nada na máquina o define para você.

## Planeje antes de aplicar

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`/plan` não tem efeitos colaterais. Envie as edições via POST e ele informará o
que elas significam:

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

`files` lista todos os arquivos que o apply comita: o código-fonte da tabela,
quando o backend pode gravá-lo, e depois o schema gerado. Os registros de
alteração do planejador mantêm seus nomes de transmissão (`add-property`,
`collection`, `property`).

Isso não é apenas uma conveniência. Dois dos três vereditos são recusas, e um
deles é uma recusa que, de outra forma, você só descobriria ao pressionar o
botão em um banco de dados em produção.

## Os três vereditos

| Veredito | Significado |
|---|---|
| `safe` | O fluxo de verificação (ensure) no boot é capaz de expressá-lo e o resultado corresponde à sua configuração. Aplicado. |
| `diverges` | Aplica-se *em parte*, deixando o banco de dados desalinhado com a sua configuração — e nada relata isso. Recusado. |
| `needs-migration` | O fluxo de verificação (ensure) não é capaz de expressá-lo de forma alguma. Recusado. |

`diverges` é o que vale a pena compreender, pois essas alterações parecem ter
funcionado:

- **Uma coluna `.notNull()` adicionada a uma tabela que já contém linhas** chega
  como **nullable**. O `NOT NULL` é verificado em relação a cada linha já
  existente, e as linhas gravadas antes da coluna existir não têm valor para ela.
  Em uma tabela **vazia** não há nada a verificar, portanto a restrição é
  aplicada e isso é `safe`.
- **Tornar uma coluna existente `.notNull()`** tem o mesmo comportamento:
  `SET NOT NULL` faz uma varredura na tabela, portanto é `safe` em uma tabela
  vazia e `diverges` em uma tabela povoada até que você faça um backfill.

Duas alterações que costumavam ser `diverges` agora são `safe`, porque o fluxo
de ensure as executa:

- **Um valor adicionado a um enum existente** é aplicado via
  `ALTER TYPE … ADD VALUE IF NOT EXISTS`. Ele costumava ser ignorado junto com o
  tipo inteiro, e a primeira linha usando o novo valor era rejeitada por um tipo
  que não o conhecia.
- **Tornar uma coluna `.notNull()` flexível** remove o `NOT NULL`. Ela costumava
  ser mantida, fazendo com que gravações que omitiam a coluna continuassem falhando.

### Restrições solicitadas e não aplicadas

Uma alteração pode ser aplicável e ainda assim deixar de aplicar algo que sua
configuração solicita — uma coluna `.notNull()` em uma tabela com dados é um
exemplo. Isso não é uma recusa, portanto não aparece em `changes`; aparece em
`withheldConstraints`, detalhando o obstáculo e o que o resolveria:

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

O fluxo de ensure na inicialização relata a mesma coisa como um aviso. Até a
existência disso, uma restrição retida era omitida em silêncio.

`needs-migration` cobre tudo o que o fluxo de ensure não consegue fazer: remover
uma tabela ou coluna, alterar o tipo de uma coluna (um booleano para inteiro, uma
string se tornando enum, o tipo de elemento de um array, o tamanho de um varchar),
renomear uma coluna, alterar uma chave primária, remover um valor de enum, tornar
uma coluna existente única e alterar uma relação — seu tipo, seu destino, sua
`localKey`, seu `onDelete`. Um `hasMany` ou `hasOne` cuja coluna de ligação nada
cria também é recusado. Cada recusa informa a alteração e o que fazer em vez
disso.

O veredito é obtido a partir do schema que cada lado produz — o mesmo plano a
partir do qual `schema.generated.ts` e `db push` são gerados — de modo que uma
edição que altera o banco de dados não possa ser relatada como nenhuma alteração.
Duas edições que parecem alterações e não são recusadas:

- **Renomear a chave de uma coluna mantendo sua coluna SQL** (`renameColumn`,
  que escreve o nome antigo como o primeiro argumento do builder, `col.text("old_name")`)
  não move dados. É `safe`; os clientes da API leem o novo nome.
- **Definir, alterar ou remover um valor padrão (default)** afeta apenas gravações
  futuras. É `safe` e aplicado com `ALTER COLUMN … SET DEFAULT` / `DROP DEFAULT`.

### Editar somente o código-fonte

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma alteração recusada ainda pode ser gravada em `backend/schema` e confirmada em
commit, deixando o banco de dados como está — remover uma coluna que você não
disponibiliza mais é o caso comum. Faça um POST em `/apply` com
`"sourceOnly": true`. Nada é executado; a mensagem de commit especifica o que o
banco de dados mantém, por exemplo
`chore(schema): remove sku from products (source only — column products.sku kept)`,
e cada alteração no plano traz uma frase `sourceOnly` dizendo o que ela deixa
para trás — inclusive quando uma coluna deixada para trás for `NOT NULL` sem
valor padrão, o que fará com que qualquer inserção posterior falhe até que ela
seja removida ou se torne anulável. Uma alteração sem isso (mover uma chave
primária, uma relação cuja coluna de ligação nada cria) não pode ser gravada
apenas no código-fonte.

Em um deploy que não altera nada em seu banco de dados (`REBASE_PROVISION=false`),
nenhuma alteração é aplicada a partir do painel, portanto toda alteração segue
este caminho: o botão principal da caixa de diálogo exibe **Commit** e envia
`"sourceOnly": true`, e o processo responsável por alterar esse banco de dados
aplica o schema.

Excluir uma tabela pelo painel de administração segue o mesmo fluxo: `/apply`
com uma edição `deleteTable` e `"sourceOnly": true` exclui o arquivo da tabela
e sua exportação em `index.ts` e comita ambos; a tabela e suas linhas permanecem
no banco de dados. Isso é recusado enquanto uma relação de outra tabela a tiver
como destino, indicando essa tabela — excluí-la impediria o schema de compilar.

## O que entra no commit

Não apenas o arquivo da tabela. O schema do Drizzle é gerado a partir dele, e um
schema desatualizado quebra o próximo deploy, portanto ambos vão no mesmo
commit:

- `backend/schema/<name>.ts` — a própria tabela, e `backend/schema/index.ts` quando uma tabela é criada ou excluída
- `backend/src/schema.generated.ts` — o schema do Drizzle

Esses caminhos são relativos ao seu **projeto**, não ao seu repositório. Quando
os dois são o mesmo — um projeto `rebase init`, que é o caso padrão —, não há com
o que se preocupar. Quando seu projeto reside em um subdiretório de um
repositório maior, os caminhos recebem esse prefixo, localizado subindo do
diretório do seu schema até o `rebase.json` mais próximo. Um projeto sem
`rebase.json` mantém os caminhos simples.

Nenhum SQL entra no commit. O `rebase db push` e o `rebase db generate` geram seus
arquivos a partir das tabelas a cada execução, em `.rebase/sql/`, que está no
gitignore.

A mensagem de commit descreve a alteração em vez de apenas anunciá-la, e é
atribuída à pessoa que a realizou, por meio do nome de exibição e e-mail da conta
(um usuário sem nenhum dos dois é comitado como `<uid>@users.noreply.rebase.pro`).

Uma alteração de schema com autor e diff no histórico do seu projeto é algo que
nem o Firebase nem o Supabase oferecem — as edições de tabela neles são
invisíveis para o seu repositório.

## Quem pode aplicar

Ter `schema:read` é suficiente para **planejar** (`plan`). O planejamento não tem
efeitos colaterais, e um job de CI verificando se uma alteração de schema proposta
é aplicável é um bom caso de uso para isso.

Aplicar (`apply`) é um segundo privilégio, pois a aplicação grava um commit e um
commit carrega um autor:

| Solicitante | Plan | Apply |
|---|---|---|
| Uma pessoa autenticada que possua `schema:write` | sim | sim |
| Uma chave de API que possua `schema:read` / `schema:write` | sim | não |
| A chave de serviço do servidor | sim | não |

Uma credencial não é um autor. `api-key:7c3f…` no seu ambiente de CI não é
alguém, e permitir que ela grave no seu repositório gera exatamente o histórico
sem autoria que este recurso existe para substituir.

Se o que você deseja é uma alteração automatizada de schema — um pipeline de
migração, por exemplo —, ative isso explicitamente:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

ou `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. O commit será então atribuído
à credencial por nome — `Rebase API key (7c3f)` — de modo que ler o `git log`
um mês depois ainda informará quais alterações foram feitas por uma pessoa.

`GET /api/admin/schema/status` informa o que *você* pode fazer, não apenas o que
o servidor suporta, para que um painel possa desativar o controle e explicar o
motivo, em vez de recusar a ação depois que você já tiver decidido:

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

Aplicar aqui **não** cria uma migration, e nem poderia: uma migration segue o
formato do Atlas com um arquivo de integridade, gerada por um binário externo
contra um banco de dados temporário, e um servidor em execução não possui nenhum
dos dois.

O que ele comita é o arquivo da tabela, e é a partir dele que o
`rebase db generate` cria a migration. Portanto, a migration está a um comando de
distância:

```bash
rebase db generate
```

O planejamento e o resultado informam isso quando o seu projeto utiliza
migrations, pois de outra forma a falha seria silenciosa: seu banco de dados tem
a alteração e seu repositório a descreve, mas o próximo ambiente construído pela
execução das migrations não terá, sem nenhum aviso a respeito.

Um projeto provisionado por verificação na inicialização (boot-ensure) — o
runtime gerenciado e qualquer self-host mantendo `REBASE_MIGRATE_ON_BOOT` em seu
valor padrão — não precisa de nenhuma migration. Suas tabelas são o schema, e a
próxima inicialização faz a reconciliação.

## Faça o commit primeiro, depois aplique

A ordem importa e não é arbitrária.

Se o DDL fosse executado primeiro e o commit falhasse, seu banco de dados teria
uma coluna que o seu repositório não descreve. O fluxo de ensure nunca descarta
nada, então o próximo deploy não a removeria nem a mencionaria — uma coluna
invisível, ausente das suas tabelas, até que alguém fosse procurá-la.

Fazer o commit primeiro falha de maneira oposta: o repositório descreve algo que
o banco de dados ainda não possui. Esse é o estado normal de qualquer projeto
entre uma edição e um deploy, e a inicialização reconcilia isso na próxima
inicialização.

Portanto, uma aplicação que falha **não é um erro**. A resposta indica isso:

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## As regras entram em vigor na mesma aplicação

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma alteração no `rls` de uma tabela (ou uma nova tabela) passa a valer na mesma
aplicação: as políticas das tabelas alteradas são gravadas no banco de dados logo
após o DDL, e a resposta indica o que aconteceu em `policies`:

```json
{ "policies": { "status": "applied", "tables": ["posts"], "statements": 3 } }
```

Onde as políticas não podem ser gravadas — um backend sem permissão para
provisionar (`provision.tables` desativado) ou um driver sem essa capacidade —,
o status será `"deferred"`; quando a gravação falhar, será `"failed"`, acompanhado
do erro. Ambos trazem a mensagem "Rules saved to source; they take effect on the
next deploy.", e o painel continua exibindo as regras que o Postgres realmente
aplica até então, nunca regras que não estão em vigor.

Hooks editados no código-fonte também entram em vigor com a aplicação: o
servidor executa as tabelas compiladas do schema editado sem necessidade de
reinicialização.

## Disponibilizado sem reinicialização

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma alteração aplicada pelo Studio é disponibilizada imediatamente. O driver do
Postgres lê as tabelas alteradas de volta do banco de dados e as substitui: a API
de dados, includes, hooks e realtime enxergam uma nova tabela, coluna, relação ou
junction sem reinicialização, e uma nova tabela recebe seus privilégios (grants) e
captura de alterações. A resposta informa isso em `serving`:

```json
{ "serving": { "status": "now" } }
```

Em um deploy cujas tabelas são derivadas do banco de dados (sem `backend/schema`),
ou com um driver que não consegue atualizar suas tabelas, o banco de dados e o
código-fonte recebem a alteração, mas o processo continua servindo as tabelas com
as quais foi iniciado. O status será então `"after-restart"`, com uma mensagem
(`message`) que a confirmação do Studio exibe como aviso; reinicie o processo para
servir a alteração.

## Quando o arquivo é modificado durante a edição

Uma edição é preparada com base nos arquivos como eles estão. Se um deles for
modificado no disco antes de a edição ser aplicada — salvamento na IDE, outro
processo —, o apply não grava nada e retorna 409 `SCHEMA_EDIT_STALE_FILE`. O
editor de coleções oferece a opção Recarregar (Reload); faça a edição novamente
com base no arquivo em seu estado atual.

## Onde isso funciona

<span class="since-badge" data-since="0.31">Desde 0.31</span>

A edição de schema em tempo real reescreve `backend/schema` usando o mesmo editor
que os salvamentos somente em código-fonte do painel utilizam (requer `ts-morph`
instalado). A origem desse código-fonte define onde ele é executado:

- **No disco** (`schemaDir`, o padrão): ele roda onde o editor somente código-fonte
  roda. Esse editor fica desativado em `NODE_ENV=production`, a menos que o
  servidor defina `schemaEditor: true`.
- **Em um repositório especificado por você** (`liveSchema.repository`, ou
  `REBASE_LIVE_SCHEMA_REPOSITORY` para um bundle): o código-fonte é lido do
  GitHub e a alteração é comitada de volta para lá, funcionando em qualquer
  lugar, inclusive em produção. Esta é a opção de habilitação para um bundle
  compilado.

| Implantação | Funciona |
|---|---|
| `rebase dev` na sua máquina | sim |
| Self-host com o projeto e sua árvore de trabalho git montados | sim, quando `NODE_ENV` não for `production`, ou com `schemaEditor: true` |
| Um bundle compilado: um self-host servindo uma build, ou a imagem publicada | apenas quando habilitado com `REBASE_LIVE_SCHEMA_REPOSITORY` — veja [A partir de um bundle compilado](#a-partir-de-um-bundle-compilado) |
| Qualquer servidor com `liveSchema.repository` configurado | sim, incluindo `NODE_ENV=production` |

Um bundle é um artefato compilado, portanto não há código-fonte de `backend/schema`
nele, e o runtime que o executa desativa o editor somente código-fonte. A menos
que ele especifique um repositório, `/api/admin/schema/status` responderá
`enabled: false` com o código `SCHEMA_EDITOR_DISABLED`: edite `backend/schema` em
desenvolvimento, faça o commit e o deploy.

### A partir de um bundle compilado

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um bundle não tem código próprio para configurar, portanto a ativação é feita
por meio de variáveis de ambiente. Nada muda para um bundle que não as defina.

```bash
REBASE_LIVE_SCHEMA_REPOSITORY=acme/storefront     # turns it on
REBASE_LIVE_SCHEMA_GITHUB_TOKEN=github_pat_…       # or the three _GITHUB_APP_* variables
# REBASE_LIVE_SCHEMA_BRANCH=main                   # default
# REBASE_LIVE_SCHEMA_PATH=backend/schema           # default
```

A lista completa está em [Configuração](/docs/getting-started/configuration#live-schema-editing-from-a-bundle).
Um repositório informado sem uma credencial utilizável (nenhuma, ambos os tipos,
metade de um GitHub App), ou com um valor que não seja `owner/name`, se recusará a
inicializar, em vez de disponibilizar um editor que falha quando alguém clica em
Aplicar. O mesmo vale para a variável descontinuada
`REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`, com uma mensagem indicando
`REBASE_LIVE_SCHEMA_PATH`, e para qualquer caminho que aponte para fora do
repositório.

O que permanece igual quando está ativado:

- É uma superfície `/api/admin`: nenhuma resposta sem `schema:read`, e `/apply`
  requer `schema:write` e uma pessoa real (veja [Quem pode aplicar](#quem-pode-aplicar)).
- O destino de escrita é apenas o repositório especificado. O editor somente
  código-fonte, que grava arquivos ao lado do processo, continua desativado.
- Cada alteração é planejada, exibida, comitada e depois aplicada, exatamente
  como na sua máquina.

O processo que aplicou a alteração passa a disponibilizá-la imediatamente: suas
rotas REST, os descritores de `GET /api/schema/tables` e o painel de administração
acompanham a edição sem necessidade de reinicialização. Outras réplicas, e este
processo após reiniciar, servem as tabelas com as quais o bundle foi compilado até
que seu pipeline construa e faça o deploy do commit.

Portanto, uma alteração aguarda que a anterior seja servida. Uma alteração
planejada com base em tabelas em relação às quais o repositório já está à frente
comitaria arquivos de schema gerados que deixariam a alteração anterior de fora.
Cada apply, portanto, renderiza `schema.generated.ts` a partir das tabelas que
este processo serve e o compara com a cópia do repositório. Quando forem diferentes,
o apply é recusado com `SCHEMA_CHANGE_FAILED`, indicando o arquivo, até que um
processo executando aquele commit substitua este. A verificação lê o repositório,
não a memória deste processo, sendo válida após reinicializações, entre réplicas e
para alterações que um desenvolvedor tenha enviado (push) mas ainda não tenham sido
implantadas. O planejamento continua disponível nesse meio-tempo.

As cópias também divergem quando o arquivo foi gerado por outra versão do Rebase,
reformatado ou editado manualmente. Se não houver nada aguardando deploy, execute
`rebase schema generate` com a versão em execução na implantação, comite o
resultado e faça o deploy. Quebras de linha e espaços em branco no final de linha
não contam como diferença.

### Fazendo commit em um repositório remoto

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`liveSchema.repository` faz com que o servidor confirme cada alteração em um
repositório GitHub por meio da Git Data API, em vez de executar `git commit` em
uma árvore de trabalho (working tree). Isso não depende de o editor somente
código-fonte estar ativado: com um repositório configurado, a edição em tempo
real funciona sob `NODE_ENV=production` e com `schemaEditor: false`, porque nada
nesta máquina é gravado. Um bundle configura isso por meio das variáveis acima.

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

O diretório do schema é então lido do repositório, reescrito com o mesmo editor
que roda localmente, e o que mudou é comitado de volta pela Git Data API: um blob
por arquivo, uma árvore (tree), um commit e uma atualização de referência (ref
update). Nada é clonado e nada é deixado em disco. O diretório inteiro é lido, não
apenas o arquivo editado, para que uma relação possa apontar para outra tabela e
a exclusão de uma tabela funcione como localmente: recusada enquanto a relação de
outra tabela apontar para ela, e removida de `index.ts` no mesmo commit. Apenas
`backend/schema` é obtido, portanto, um arquivo de tabela que importe algo fora
dele não pode ser editado dessa forma.

`auth` aceita um token ou uma instalação de GitHub App:

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Use o token para um único projeto que comita em um repositório que você já
possui — configurar um App apenas para o seu servidor comitar nele é muita
burocracia para uma credencial de uma linha. Use o App para um painel de controle
(control plane) que mantém uma chave para vários projetos, que é o que o Rebase
Cloud faz: um App, uma instalação por projeto e nenhum segredo por cliente para
alternar.

O token precisa de `contents: read and write` nesse repositório, e nada mais.

Sem `liveSchema.repository`, o commit é um simples `git commit` na árvore de
trabalho que contém `schemaDir`: nada para autenticar, nenhum token, nenhuma rede.

Duas coisas que tornam seguro executar isso em um repositório em que outra pessoa
está trabalhando:

- Ele faz stage **apenas** dos arquivos que gerou. Um commit de schema que
  incluísse trabalhos pela metade seria um commit que ninguém conseguiria revisar,
  e ele recusa imediatamente se a árvore já tiver um de seus próprios arquivos
  modificado.
- O caminho remoto nunca força a atualização de uma ref (force-update). Se algo
  foi mesclado enquanto o commit estava sendo construído, a atualização é
  rejeitada — perder o commit de alguém silenciosamente é pior do que falhar.

## Limitações

- Apenas alterações aditivas. Todo o resto é recusado com um motivo, pois o
  fluxo de ensure é a única coisa que altera um schema e ele só pode adicionar.
- Nenhum arquivo de migration é gerado. Um projeto provisionado por boot-ensure
  não precisa de nenhum; um projeto provisionado por migrations deve executar
  `rebase db generate`, que gera uma através do Atlas com o hash de integridade
  exigido pelo Atlas.
- Apenas Postgres. O recurso é detectado no driver, e um driver sem ele
  responde com `SCHEMA_EDITING_UNSUPPORTED`.
- Uma implantação cujas tabelas são derivadas do banco de dados disponibiliza uma
  alteração aplicada após a próxima inicialização (`serving.status: "after-restart"`,
  veja [Disponibilizado sem reinicialização](#disponibilizado-sem-reinicialização)).

## Relacionados

- [Geração de Schema](/docs/cli/schema/) — as mesmas edições a partir da linha de comando
- [Tabelas](/docs/schema/) — o que o editor está reescrevendo
- [Studio](/docs/studio/) — o painel por trás dessas rotas
