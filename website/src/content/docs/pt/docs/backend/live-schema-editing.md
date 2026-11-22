---
sourceHash: 45b2459dff0e5ec4
title: Edição de esquema em tempo real
description: Crie e altere tabelas em um backend em execução — a edição é gravada em backend/schema, commitada no seu repositório primeiro e depois aplicada.
---

O editor de esquema focado apenas no código-fonte, `/api/admin/schema-editor/*`, reescreve os
arquivos de tabela em `backend/schema` e não mexe em mais nada. Isso funciona na sua
máquina e em nenhum outro lugar: os arquivos de um servidor em produção são reconstruídos a partir do
seu repositório a cada deploy, portanto, uma edição feita lá seria descartada no
próximo deploy.

A edição de esquema em tempo real (live schema editing) é a resposta para isso. Ela **commita a alteração no seu
repositório e, em seguida, aplica o DDL** — garantindo que a edição sobreviva ao próximo deploy,
já que o deploy é construído a partir dela. O editor de RLS do Studio salva as
políticas de uma tabela por meio dessas rotas — planejadas, exibidas como SQL, confirmadas e depois
aplicadas — e um script ou agente com o escopo necessário pode enviar as mesmas edições.

```
GET  /api/admin/schema/status   se este backend pode fazer isso e se você tem permissão
POST /api/admin/schema/plan     o que aconteceria, sem executar a alteração
POST /api/admin/schema/apply    commitar e depois aplicar
```

Status e plan precisam do escopo `schema:read`, e apply precisa de `schema:write`, como
qualquer outra superfície de `/api/admin` que exige um escopo. Um administrador possui ambos.
A aplicação também precisa de mais uma condição além do escopo — veja [Quem pode aplicar](#quem-pode-aplicar).

## As edições: `TablePatch`

Toda rota que altera o esquema recebe o mesmo corpo, `{ patches }`: uma lista
de edições, cada uma identificando sua tabela pelo slug. O tipo é `TablePatch`, do
`@rebasepro/types`.

| `op` | O que grava em `backend/schema` |
|---|---|
| `createTable` | um novo arquivo `backend/schema/<name>.ts` contendo a tabela, exportado a partir de `index.ts` |
| `deleteTable` | remove o arquivo e sua exportação |
| `addColumn` `{ key, column, before? }` | uma coluna, antes daquela indicada por `before`, ou no final |
| `changeColumn` `{ key, column }` | reescreve a cadeia de builder de uma coluna; um `.transform()` definido nela é mantido |
| `renameColumn` `{ key, to, column }` | renomeia a chave, mantendo a coluna SQL |
| `removeColumn` `{ key }`, `moveColumn` `{ key, before? }` | remove ou reordena uma coluna |
| `addRelation`, `changeRelation` `{ name, relation }`, `removeRelation` `{ name }` | uma entrada `rel.*`; o `target` da relação é um slug |
| `setRls` `{ rls }` | a postura: `"admin-only"`, `"inherit"` ou uma lista de regras |
| `addRule` `{ rule, index? }`, `replaceRule` `{ index, rule }`, `removeRule` `{ index }` | uma regra da lista |
| `setOption` `{ option, value }` | `description`, `tenant`, `softDelete`, `history`, `search`, `indexes`, `strictWrites`, `defaultPolicies` ou `metadata`; `null` remove a opção |

Uma coluna trafega como sua definição — o tipo Postgres como `{ kind: … }` e os
modificadores como flags — sem seus hooks `.transform()`, que são código e permanecem
onde foram escritos:

```json
{ "patches": [
    { "op": "addColumn", "table": "posts", "key": "subtitle",
      "column": { "type": { "kind": "text" } } }
] }
```

Apenas o código indicado por uma edição é reescrito. Todo o restante permanece inalterado —
imports, comentários, formatação, uma coluna compartilhada de outro módulo. O editor
recusa, indicando a expressão, qualquer edição que tente acessar algo definido
diretamente em código: uma tabela construída com spread, uma coluna construída por um helper, regras contidas em
uma variável, uma chave computada, uma coluna cuja estrutura JSON contenha transforms. Ele
também nunca renomeia um slug, uma tabela, um esquema ou o nome de uma definição (isso move
dados: crie uma migration), nunca remove a última regra (use `setRls` com
`"admin-only"`), recusa `rls` em uma view e recusa a exclusão de uma tabela que seja
alvo de outras relações. Uma edição cujo resultado não compile é recusada com
`SCHEMA_EDIT_DOES_NOT_COMPILE` e os erros apontados pelo compilador. Nada é gravado
em caso de recusa.

A aparência de uma tabela no painel de administração — labels, ícones, grupos, modos de visualização, cores
de enums — não é uma edição de esquema: ela reside em `frontend/src/cms` e nas preferências
salvas do painel, e nada disso trafega em um `TablePatch`.

`$ADMIN_TOKEN` é um token de acesso — o `accessToken` retornado por um login — para uma
conta que possua `schema:read`: um administrador ou uma role que o declare. Nada na
máquina o define automaticamente para você.

## Planeje antes de aplicar

`/plan` não produz efeitos colaterais. Envie as edições via POST e ele informará o que elas representam:

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

`files` lista todos os arquivos que o apply commita: o código-fonte da tabela, quando o backend
puder gravá-lo, seguido pelo esquema gerado. Os registros de alteração do planejador mantêm
seus nomes originais de transmissão (`add-property`, `collection`, `property`).

Isso não é apenas uma conveniência. Dois dos três vereditos são recusas, e um
deles é uma recusa que, de outra forma, você só descobriria ao acionar a alteração diretamente em um
banco de dados em produção.

## Os três vereditos

| Veredito | Significado |
|---|---|
| `safe` | O fluxo de ensure na inicialização consegue expressá-la e o resultado corresponde à sua configuração. Aplicada. |
| `diverges` | Aplica-se *parcialmente*, deixando um banco de dados que não corresponde à sua configuração — e nada relata isso. Recusada. |
| `needs-migration` | O fluxo de ensure não consegue expressá-la de forma alguma. Recusada. |

`diverges` é o veredito que merece atenção, porque essas alterações parecem ter
funcionado:

- **Uma coluna `.notNull()` adicionada a uma tabela que já contém registros** é criada como
  **nullable**. O `NOT NULL` é verificado contra cada linha já existente, e as linhas
  criadas antes de a coluna existir não possuem valor para ela. Em uma tabela **vazia**,
  não há nada para verificar, portanto a constraint é aplicada e isso é considerado
  `safe`.
- **Tornar uma coluna existente `.notNull()`** segue o mesmo padrão: `SET NOT NULL`
  faz uma varredura na tabela; portanto, é `safe` em uma tabela vazia e `diverges` em uma
  populada até que você faça o backfill.

Duas alterações que antes resultavam em `diverges` agora são `safe`, pois o fluxo de ensure
as executa:

- **Um valor adicionado a um enum existente** é aplicado via
  `ALTER TYPE … ADD VALUE IF NOT EXISTS`. Antes, era ignorado juntamente com o
  tipo inteiro, e a primeira linha que utilizava o novo valor era rejeitada por um tipo que
  nunca tinha ouvido falar dele.
- **Tornar opcional uma coluna `.notNull()`** remove o `NOT NULL`. Antes, ele era mantido,
  portanto escritas que omitiam a coluna continuavam falhando.

### Constraints solicitadas e não aplicadas

Uma alteração pode ser aplicável e ainda assim deixar algo solicitado na sua configuração
sem ser imposto — uma coluna `.notNull()` em uma tabela populada é um exemplo. Isso não é
uma recusa, portanto não aparece em `changes`; aparece em
`withheldConstraints`, detalhando o obstáculo e como resolvê-lo:

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

O fluxo de ensure na inicialização reporta a mesma situação como um aviso. Antes da existência
disso, uma constraint retida era omitida silenciosamente.

`needs-migration` cobre tudo o que o fluxo de ensure não consegue fazer: remover uma
tabela ou coluna, alterar o tipo de uma coluna (um booleano para inteiro, uma string
virando enum, o tipo de elemento de um array, o tamanho de um varchar), renomear uma
coluna, alterar uma chave primária, remover um valor de enum, tornar única uma coluna
já existente e alterar uma relação — seu tipo, seu destino, seu `localKey`,
seu `onDelete`. Um `hasMany` ou `hasOne` cuja coluna de vínculo não seja criada por nada também é
recusado. Cada recusa informa a alteração e o que fazer em vez disso.

O veredito é determinado a partir do esquema gerado por cada lado — o mesmo plano
a partir do qual `schema.generated.ts` e `db push` são renderizados — portanto, uma edição que altere
o banco de dados não pode ser reportada como sem alterações. Duas edições que parecem alterações
e não são recusadas:

- **Renomear a chave de uma coluna mantendo sua coluna SQL** (`renameColumn`,
  que grava o nome antigo como primeiro argumento do builder, `col.text("old_name")`) não move dados. É `safe`; os clientes da API passam a ler o novo nome.
- **Definir, alterar ou remover um valor padrão (default)** vincula apenas gravações futuras. É
  `safe`, e aplicado com `ALTER COLUMN … SET DEFAULT` / `DROP DEFAULT`.

### Edição apenas no código-fonte

Uma alteração recusada ainda pode ser gravada em `backend/schema` e commitada,
deixando o banco de dados como está — remover uma coluna que você não disponibiliza mais é o
caso comum. Envie um POST para `/apply` com `"sourceOnly": true`. Nada é executado no banco; a mensagem
do commit descreve o que o banco de dados mantém, por exemplo
`chore(schema): remove sku from products (source only — column products.sku kept)`,
e cada alteração no plano traz uma frase `sourceOnly` informando o que foi
deixado para trás — inclusive quando uma coluna mantida é `NOT NULL` sem valor
padrão, o que fará com que qualquer inserção posterior falhe até que ela seja removida ou tornada
opcional. Uma alteração sem essa indicação (mover uma chave primária, uma relação cuja coluna de
vínculo nada cria) não pode ser gravada apenas no código-fonte.

Em um deploy que não altera nada no banco de dados (`REBASE_PROVISION=false`),
nenhuma alteração é aplicada a partir do painel, portanto toda alteração segue este fluxo: o
botão principal do diálogo exibe **Commit** e envia `"sourceOnly": true`, e o
processo encarregado de alterar aquele banco de dados aplica o esquema.

Excluir uma tabela segue o mesmo caminho: `/apply` com uma
edição `deleteTable` e `"sourceOnly": true` remove o arquivo da tabela e sua
exportação em `index.ts` e commita ambos; a tabela e seus registros permanecem no
banco de dados. A operação é recusada enquanto houver relação de outra tabela apontando para ela, indicando
essa tabela — excluí-la impediria o esquema de compilar.

## O que é commitado

Não apenas o arquivo da tabela. O esquema Drizzle é gerado a partir dele, e um
esquema desatualizado quebra o próximo deploy, portanto ambos são incluídos no mesmo commit:

- `backend/schema/<name>.ts` — a própria tabela, e `backend/schema/index.ts` quando uma tabela é criada ou excluída
- `backend/src/schema.generated.ts` — o esquema Drizzle

Esses caminhos são relativos ao seu **projeto**, não ao seu repositório. Quando os
dois coincidem — um projeto criado com `rebase init`, que é o caso comum — não há
nada com que se preocupar. Quando seu projeto reside em um subdiretório de um
repositório maior, os caminhos recebem o prefixo dele, identificado ao subir a árvore
de diretórios do esquema até o `rebase.json` mais próximo. Um projeto sem
`rebase.json` mantém os caminhos simples.

Nenhum SQL entra no commit. `rebase db push` e `rebase db generate` geram seus arquivos
a partir das tabelas a cada execução, dentro de `.rebase/sql/`, que está no gitignore.

A mensagem do commit descreve a alteração em vez de simplesmente anunciá-la, e é
atribuída à pessoa que a realizou, utilizando o nome de exibição e e-mail da conta
(um usuário sem esses dados é commitado como `<uid>@users.noreply.rebase.pro`).

Uma alteração de esquema com autor e histórico de diff no seu projeto é algo
que nem Firebase nem Supabase oferecem — as edições de tabelas neles são invisíveis para
o seu repositório.

## Quem pode aplicar

Possuir `schema:read` é suficiente para **planejar** (`plan`). O planejamento não tem efeitos colaterais, e um
job de CI verificando se uma proposta de alteração de esquema é aplicável é um bom exemplo de
uso.

Aplicar é um segundo privilégio, pois a aplicação gera um commit e um commit
possui um autor:

| Chamador | Plan | Apply |
|---|---|---|
| Uma pessoa autenticada com `schema:write` | sim | sim |
| Uma API key com `schema:read` / `schema:write` | sim | não |
| A chave de serviço do servidor | sim | não |

Uma credencial não é um autor. `api-key:7c3f…` no seu ambiente de CI não é
uma pessoa, e permitir que ela grave no seu repositório geraria exatamente o
histórico sem autoria que este recurso foi criado para substituir.

Se o que você precisa é uma alteração de esquema automatizada — uma esteira de migrations, por exemplo —,
habilite isso explicitamente:

```typescript no-verify
initializeRebaseBackend({
    // …o restante da sua configuração
    liveSchema: { allowMachineApply: true }
})
```

ou `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. O commit passa então a ser atribuído
à credencial pelo nome — `Rebase API key (7c3f)` — de modo que a leitura do `git log`
meses depois ainda identifique quais alterações foram feitas por uma pessoa.

`GET /api/admin/schema/status` informa o que *você* pode fazer, não apenas o que o
servidor suporta, permitindo que um painel desabilite o controle e informe o motivo, em vez de
recusar a ação somente depois que você a acionar:

```json
{
  "enabled": true,
  "canPlan": true,
  "canApply": false,
  "applyRefusedCode": "SCHEMA_EDIT_REQUIRES_A_PERSON",
  "applyRefusedBecause": "This request is authenticated with an API key …"
}
```

## Se o seu projeto utiliza migrations versionadas

A aplicação feita aqui **não** gera uma migration, e não teria como: uma migration segue
o formato do Atlas com um arquivo de integridade, gerado por um binário externo contra um
banco de dados temporário, e um servidor em execução não possui nenhum dos dois.

O que ele commita é o arquivo da tabela, e é a partir dele que o `rebase db generate`
cria a migration. Assim, a migration fica a apenas um comando de distância:

```bash
rebase db generate
```

Tanto o plano quanto o resultado avisam quando seu projeto utiliza migrations, pois
caso contrário a falha ocorreria silenciosamente: seu banco de dados teria a alteração e seu repositório
a descreveria, mas o próximo ambiente construído pela execução das migrations não a conteria,
sem que nenhum aviso fosse emitido.

Um projeto provisionado pelo boot-ensure — o runtime gerenciado e qualquer auto-hospedagem (self-host)
que mantenha `REBASE_MIGRATE_ON_BOOT` no padrão — não precisa de migrations. Suas
tabelas representam o próprio esquema, e a próxima inicialização faz a reconciliação.

## Commitar primeiro, aplicar depois

A ordem importa e não é arbitrária.

Se o DDL rodasse primeiro e o commit falhasse, seu banco de dados teria uma coluna
que seu repositório não descreve. O fluxo de ensure nunca exclui nada, então o
próximo deploy nem a removeria nem a mencionaria — uma coluna invisível, ausente
das suas tabelas, até que alguém fosse procurá-la.

Commitar primeiro falha de maneira inversa: o repositório descreve algo que o
banco de dados ainda não possui. Esse é o estado normal de qualquer projeto entre
uma edição e um deploy, e a inicialização faz a reconciliação no próximo boot.

Portanto, uma falha na aplicação **não é um erro**. A resposta informa isso:

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## As regras entram em vigor na mesma aplicação

Uma alteração no `rls` de uma tabela (ou uma nova tabela) passa a vigorar na mesma aplicação: as
políticas das tabelas alteradas são gravadas no banco de dados logo após o DDL,
e a resposta descreve o ocorrido em `policies`:

```json
{ "policies": { "status": "applied", "tables": ["posts"], "statements": 3 } }
```

Onde as políticas não podem ser gravadas — um backend sem permissão de provisionamento
(`provision.tables` desativado) ou um driver sem essa funcionalidade — o status fica como
`"deferred"`; quando a gravação falha, o status é `"failed"`, acompanhado do erro. Ambos
trazem a mensagem "Rules saved to source; they take effect on the next
deploy.", e o painel continua exibindo as regras que o Postgres realmente impõe até lá,
nunca exibindo regras que não estejam em vigor.

Hooks editados no código-fonte também entram em vigor junto com a aplicação: o servidor executa as
tabelas compiladas do esquema editado sem necessidade de reinicialização.

## Servido sem necessidade de reinicialização

Uma alteração aplicada pelo Studio passa a ser servida imediatamente. O driver Postgres recarrega
as tabelas alteradas a partir do banco de dados e as substitui: a API de dados,
includes, hooks e realtime passam a enxergar a nova tabela, coluna, relação ou junção
sem reiniciar, e uma nova tabela recebe seus grants e captura de alterações. A
resposta informa isso em `serving`:

```json
{ "serving": { "status": "now" } }
```

Em um deploy cujas tabelas derivam do banco de dados (sem `backend/schema`),
ou com um driver incapaz de recarregar suas tabelas, o banco de dados e o
código-fonte contêm a alteração, mas o processo continua servindo as tabelas
com as quais foi iniciado. O status fica como `"after-restart"`, com uma propriedade `message`
que o recibo do Studio exibe como aviso; reinicie o processo para disponibilizar a
alteração.

## Quando o arquivo foi alterado durante a edição

Uma edição é elaborada com base nos arquivos como eles estão no momento. Se um deles for alterado no
disco antes de a edição ser aplicada — um salvamento na IDE, outro processo —, a aplicação
não grava nada e responde com o código 409 `SCHEMA_EDIT_STALE_FILE`. Realize a edição novamente
com base no estado atual do arquivo.

## Onde isso funciona

A edição de esquema em tempo real reescreve `backend/schema` utilizando o mesmo editor dos salvamentos
exclusivos em código-fonte do painel (requer `ts-morph` instalado). A origem desse código-fonte
determina onde ela funciona:

- **No disco** (`schemaDir`, o padrão): opera onde o editor exclusivo de código-fonte
  funciona. Esse editor fica desativado sob `NODE_ENV=production`, a menos que o servidor
  defina `schemaEditor: true`.
- **Em um repositório especificado** (`liveSchema.repository`, ou
  `REBASE_LIVE_SCHEMA_REPOSITORY` para bundles): o código-fonte é lido do
  GitHub e a alteração é commitada diretamente lá; assim, funciona em qualquer ambiente,
  inclusive produção. Esta é a opção de habilitação para bundles compilados.

| Ambiente | Funciona |
|---|---|
| `rebase dev` na sua máquina | sim |
| Self-host com o projeto e sua árvore de trabalho git montados | sim, quando `NODE_ENV` não for `production`, ou com `schemaEditor: true` |
| Um bundle compilado: um self-host servindo uma build ou a imagem oficial | apenas ao habilitar com `REBASE_LIVE_SCHEMA_REPOSITORY` — veja [A partir de um bundle compilado](#a-partir-de-um-bundle-compilado) |
| Qualquer servidor com `liveSchema.repository` configurado | sim, inclusive com `NODE_ENV=production` |

Um bundle é um artefato compilado, portanto não contém o código-fonte em `backend/schema`, e
o runtime que o executa desativa o editor focado em código-fonte. A menos que indique um
repositório, `/api/admin/schema/status` responderá `enabled: false` com o código
`SCHEMA_EDITOR_DISABLED`: edite `backend/schema` em desenvolvimento, commite e
faça o deploy.

### A partir de um bundle compilado

Um bundle não possui código próprio a ser configurado, portanto é habilitado por meio de variáveis de
ambiente. Nada muda para bundles que não as definam.

```bash
REBASE_LIVE_SCHEMA_REPOSITORY=acme/storefront     # ativa o recurso
REBASE_LIVE_SCHEMA_GITHUB_TOKEN=github_pat_…       # ou as três variáveis _GITHUB_APP_*
# REBASE_LIVE_SCHEMA_BRANCH=main                   # padrão
# REBASE_LIVE_SCHEMA_PATH=backend/schema           # padrão
```

A lista completa está em [Configuration](/docs/getting-started/configuration#live-schema-editing-from-a-bundle).
Um repositório configurado sem uma credencial válida (nenhuma, ambos os tipos, GitHub App
incompleto) ou com valor diferente de `owner/name` recusa a inicialização, em vez de disponibilizar
um editor que falhará quando alguém clicar em Apply. O mesmo vale para a variável obsoleta
`REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`, exibindo mensagem que indica
`REBASE_LIVE_SCHEMA_PATH`, bem como caminhos que apontem para fora do repositório.

O que se mantém inalterado quando ativado:

- É uma superfície de `/api/admin`: nenhuma resposta sem `schema:read`, e
  `/apply` exige `schema:write` e um usuário real (veja [Quem pode aplicar](#quem-pode-aplicar)).
- O único destino de gravação é o repositório configurado. O editor exclusivo de código-fonte,
  que grava arquivos ao lado do processo, permanece desligado.
- Cada alteração é planejada, exibida, commitada e então aplicada, exatamente como na sua
  máquina local.

O processo que aplicou a alteração passa a servi-la imediatamente: suas rotas REST, os
descritores de `GET /api/schema/tables` e o painel de administração refletem a edição
sem necessidade de reiniciar. Outras réplicas, e este processo após um reinício, servem as
tabelas com as quais o bundle foi compilado até que sua esteira construa e faça o deploy do
commit.

Portanto, uma alteração aguarda até que a anterior seja servida. Uma alteração planejada contra
tabelas das quais o repositório já está à frente commitaria arquivos de esquema gerados
que omitiriam a alteração anterior. Assim, cada apply renderiza
`schema.generated.ts` a partir das tabelas que este processo atende e compara com a cópia
do repositório. Caso divirjam, a aplicação é recusada com
`SCHEMA_CHANGE_FAILED`, informando o arquivo, até que um processo executando aquele commit
substitua o atual. Essa checagem lê o repositório, não a memória deste processo,
portanto é mantida mesmo após reinicializações, entre réplicas e no caso de alterações enviadas
por desenvolvedores que ainda não foram para deploy. O planejamento continua disponível nesse meio tempo.

As cópias também divergem quando o arquivo tiver sido gerado por outra versão do Rebase,
reformatado ou editado manualmente. Se não houver nada pendente de deploy, execute
`rebase schema generate` utilizando a versão em execução no ambiente, commite o
resultado e faça o deploy. Diferenças de quebra de linha e espaços em branco finais não são consideradas
divergências.

### Commitando para um repositório remoto

`liveSchema.repository` faz com que o servidor commite cada alteração em um repositório do GitHub
por meio da Git Data API, em vez de executar `git commit` na árvore de trabalho local.
Isso independe de o editor de código-fonte estar ativo: com um repositório configurado, a
edição em tempo real funciona sob `NODE_ENV=production` e com `schemaEditor: false`,
pois nada é gravado localmente nesta máquina. Um bundle define isso através das variáveis citadas acima.

```typescript no-verify
initializeRebaseBackend({
    // …o restante da sua configuração
    liveSchema: {
        repository: {
            kind: "github",
            owner: "acme",
            repo: "storefront",
            branch: "main",
            // Onde backend/schema reside no repositório.
            // O padrão é "backend/schema".
            schemaPath: "backend/schema",
            auth: { kind: "token", token: process.env.GITHUB_TOKEN! }
        }
    }
})
```

O diretório do esquema é então lido do repositório, reescrito com o mesmo editor
utilizado localmente, e as alterações são commitadas de volta via Git Data API:
um blob por arquivo, uma tree, um commit e a atualização da ref. Nada é
clonado e nada é deixado no disco. O diretório inteiro é lido, não apenas o
arquivo editado, de forma que uma relação possa apontar para outra tabela e a exclusão funcione
como localmente: recusada se houver relação de outra tabela apontando para ela, e
removida de `index.ts` no mesmo commit. Apenas `backend/schema` é baixado; portanto,
um arquivo de tabela que importe algo fora dele não poderá ser editado dessa forma.

`auth` aceita um token ou a instalação de um GitHub App:

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Use o token para um projeto único commitando em um repositório do qual você já seja proprietário —
configurar um App apenas para seu próprio servidor commitar é complexidade demais para
uma credencial de uma única linha. Use o App para um painel de controle que gerencie uma chave entre
vários projetos, que é como o Rebase Cloud opera: um App, uma instalação por
projeto e nenhum segredo individual por cliente para rotacionar.

O token requer permissão de `contents: read and write` no repositório, e nada mais.

Sem `liveSchema.repository`, o commit é um `git commit` comum na
árvore de trabalho que contém `schemaDir`: sem necessidade de autenticação, tokens ou
rede.

Dois fatores garantem a segurança de rodar contra um repositório onde outras pessoas estejam trabalhando:

- Ele adiciona à stage **apenas** os arquivos que ele próprio gerou. Um commit de esquema que
  incluísse trabalhos incompletos seria impossível de revisar, e a operação é recusada
  imediatamente se a árvore de trabalho já contiver modificações em um de seus próprios arquivos.
- O caminho remoto nunca força atualizações de referências (force-update). Se algo foi integrado
  enquanto o commit estava sendo preparado, a atualização é rejeitada — perder commits alheios
  silenciosamente é pior do que falhar a operação.

## Limitações

- Apenas alterações incrementais (aditivas). Qualquer outra alteração é recusada com justificativa, pois o
  fluxo de ensure é o único mecanismo que modifica o esquema, sendo capaz apenas de adições.
- Nenhum arquivo de migration é gerado. Um projeto provisionado pelo boot-ensure não precisa deles;
  um projeto provisionado por migrations deve rodar `rebase db generate`, que
  cria o arquivo via Atlas com o hash de integridade exigido pelo Atlas.
- Suporte exclusivo para Postgres. A capacidade é detectada diretamente no driver; um driver
  sem esse recurso responderá com `SCHEMA_EDITING_UNSUPPORTED`.
- Um deploy cujas tabelas derivem do banco de dados passa a servir as alterações
  aplicadas somente após o próximo início (`serving.status: "after-restart"`, veja
  [Servido sem necessidade de reinicialização](#servido-sem-necessidade-de-reinicialização)).

## Conteúdo relacionado

- [Schema Generation](/docs/cli/schema/) — as mesmas edições via linha de comando
- [Tables](/docs/schema/) — o que o editor está reescrevendo
- [Studio](/docs/studio/) — o painel através do qual essas rotas são acessadas
