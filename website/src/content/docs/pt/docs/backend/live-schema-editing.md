---
sourceHash: 7253b4b5232fa542
title: Edição de schema ao vivo
description: Crie e altere coleções em um backend em execução — comitadas primeiro no seu repositório, depois aplicadas.
---

O editor de schema no painel de administração reescreve o código-fonte da sua
coleção. Isso funciona na sua máquina e em nenhum outro lugar: os arquivos de um
servidor implantado são reconstruídos a partir do seu repositório a cada deploy,
portanto uma edição feita lá seria descartada no próximo.

A edição de schema ao vivo é a resposta para isso. Ela **comita a alteração no
seu repositório e depois aplica o DDL** — assim, a edição sobrevive ao próximo
deploy, porque o deploy é construído a partir dela.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

Todas as três rotas são restritas a administradores, como qualquer outra
superfície de `/api/admin`. A aplicação exige algo além de ser um administrador —
consulte [Quem pode aplicar](#quem-pode-aplicar).

## Planeje antes de aplicar

O `/plan` não tem efeitos colaterais. Envie a coleção como ela deve ficar no
final, e ele informa o que a alteração significa:

`$ADMIN_TOKEN` é um token de acesso de administrador — o `accessToken` que um
login retorna para uma conta com a função de administrador. Nada na máquina o
define para você.

```bash
curl -X POST https://your-app/api/admin/schema/plan \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"collectionId":"posts","collection":{}}'
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
  "files": ["backend/src/schema.generated.ts", "drizzle/schema.sql"]
}
```

Isso não é apenas uma conveniência. Dois dos três vereditos são recusas, e um
deles é uma recusa que você só descobriria ao apertar o botão em um banco de
dados ativo.

## Os três vereditos

| Veredito | Significado |
|---|---|
| `safe` | O caminho ensure no momento do boot o expressa e o resultado corresponde à sua configuração. Aplicado. |
| `diverges` | Ele é aplicado *em parte*, deixando um banco de dados que não corresponde à sua configuração — e nada reporta isso. Recusado. |
| `needs-migration` | O caminho ensure não consegue expressá-lo de forma alguma. Recusado. |

`diverges` é o que vale a pena entender, porque essas alterações parecem ter
funcionado:

- **Uma propriedade obrigatória adicionada a uma tabela que já contém linhas**
  chega como **anulável** (*nullable*). O `NOT NULL` é verificado em cada linha
  já existente, e as linhas gravadas antes de a propriedade existir não possuem
  valor para ela. Em uma tabela **vazia**, não há nada a verificar, portanto a
  restrição é aplicada e isso é `safe`.
- **Tornar obrigatória uma propriedade existente** segue a mesma lógica:
  `SET NOT NULL` varre a tabela, portanto é `safe` em uma tabela vazia e
  `diverges` em uma preenchida até que você faça o backfill.

Duas alterações que costumavam ser `diverges` agora são `safe`, porque o caminho
ensure as executa:

- **Um valor adicionado a um enum existente** é aplicado via
  `ALTER TYPE … ADD VALUE IF NOT EXISTS`. Antes, ele era ignorado junto com todo
  o tipo, e a primeira linha usando o novo valor era rejeitada por um tipo que
  nunca tinha ouvido falar dele.
- **Tornar uma propriedade obrigatória opcional** remove o `NOT NULL`. Antes, ele
  era mantido, de modo que gravações omitindo a propriedade continuavam
  falhando.

### Restrições solicitadas e não aplicadas

Uma alteração pode ser aplicável e ainda deixar algo solicitado pela sua
configuração sem aplicação — uma propriedade obrigatória sobre uma tabela
populada é o caso. Isso não é uma recusa, portanto não aparece em `changes`;
aparece em `withheldConstraints`, com o obstáculo e o que o resolveria:

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

O caminho ensure de boot relata a mesma coisa como um aviso. Até que isso
existisse, uma restrição retida ficava retida em silêncio.

`needs-migration` cobre tudo o que o caminho ensure não pode fazer: remover uma
coleção ou uma propriedade, alterar um tipo, renomear uma coluna, alterar uma
chave primária, remover um valor de enum. Cada recusa nomeia a alteração e o que
fazer em vez disso.

## O que é comitado

Não apenas o arquivo da coleção. Uma alteração de schema mexe em vários
artefatos gerados, e um desatualizado quebra o próximo deploy:

- `config/collections/<name>.ts` — a própria coleção
- `backend/src/schema.generated.ts` — o schema Drizzle
- `drizzle/schema.sql`, `drizzle/policies.sql`, `drizzle/search.sql`

Esses caminhos são relativos ao seu **projeto**, não ao seu repositório. Quando
os dois são a mesma coisa — um projeto `rebase init`, que é o caso comum —, não
há nada com o que se preocupar. Quando o seu projeto fica em um subdiretório de
um repositório maior, os caminhos recebem o prefixo dele, localizado ao subir a
partir do diretório de coleções até o `rebase.json` mais próximo. Um projeto sem
`rebase.json` mantém os caminhos simples.

A mensagem de commit descreve a alteração em vez de simplesmente anunciar uma, e
é atribuída ao administrador que a realizou. Uma alteração de schema com autor e
diff no histórico do seu projeto é algo que nem o Firebase nem o Supabase
oferecem — as edições de tabela deles são invisíveis para o seu repositório.

## Quem pode aplicar

Ser um administrador é suficiente para **planejar** (*plan*). O planejamento
não tem efeitos colaterais, e uma tarefa de CI verificando se uma alteração de
coleção proposta é aplicável é um bom uso para ele.

Aplicar é um segundo privilégio, porque aplicar grava um commit e um commit traz
um autor:

| Chamador | Plan | Apply |
|---|---|---|
| Um administrador autenticado | sim | sim |
| Uma chave de API | sim | não |
| A chave de serviço do servidor | sim | não |

Uma credencial não é um autor. `api-key:7c3f…` no seu ambiente de CI não é
alguém, e permitir que ela escreva no seu repositório produz exatamente o
histórico sem autoria que este recurso existe para substituir.

Se você deseja uma alteração automatizada de schema — um pipeline de migração,
por exemplo —, ative isso deliberadamente:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

ou `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. O commit é então atribuído à
credencial pelo nome — `Rebase API key (7c3f)` — para que ler o `git log` um mês
depois ainda mostre quais alterações foram feitas por uma pessoa.

`GET /api/admin/schema/status` informa o que *você* pode fazer, não apenas o que
o servidor suporta, para que um painel possa desativar o controle e dizer o
motivo em vez de recusar depois que você já tiver decidido:

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

Aplicar aqui **não** cria uma migração, e nem poderia: uma migração usa o
formato do Atlas com um arquivo de integridade, gerado por um binário externo
contra um banco de dados temporário, e um servidor em execução não possui nenhum
dos dois.

O que ele grava é `drizzle/schema.sql` — que é exatamente contra o que o
`rebase db generate` gera diffs. Portanto, a migração está a apenas um comando de
distância:

```bash
rebase db generate
```

O plano e o resultado avisam sobre isso quando o seu projeto possui migrações,
porque, caso contrário, a falha seria silenciosa: seu banco de dados teria a
alteração e seu repositório a descreveria, mas o próximo ambiente construído
reproduzindo as migrações não a teria, sem que nada avisasse.

Um projeto provisionado pelo boot-ensure — o runtime gerenciado e qualquer
self-host deixando `REBASE_MIGRATE_ON_BOOT` no padrão — não precisa de migração
alguma. Suas coleções são o próprio schema, e a próxima inicialização faz a
reconciliação.

## Comitar primeiro, depois aplicar

A ordem importa e não é arbitrária.

Se o DDL rodasse primeiro e o commit falhasse, seu banco de dados teria uma
coluna que o seu repositório não descreve. O caminho ensure nunca remove nada,
portanto o próximo deploy não a removeria nem a mencionaria — uma coluna
invisível, ausente das suas coleções, até que alguém fosse procurá-la.

Comitar primeiro falha no sentido oposto: o repositório descreve algo que o
banco de dados ainda não tem. Esse é o estado normal de qualquer projeto entre
uma edição e um deploy, e o boot o reconcilia na inicialização seguinte.

Portanto, uma aplicação que falha **não é um erro**. A resposta diz isso:

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## Onde isso funciona

A linha divisória é se o servidor em execução tem o seu **código-fonte em
disco** — não se ele é de produção.

### MongoDB

Tudo acima descreve o Postgres, onde uma alteração de schema significa DDL. No
MongoDB não há tabela para alterar: adicionar uma propriedade não adiciona nada,
remover uma não remove nada, e um documento gravado ontem ainda é válido amanhã.

Portanto, toda alteração é aplicável, nada é recusado e o plano não tem
instruções (*statements*) — o commit *é* a alteração. O painel diz "Commit" em
vez de "Commit and apply", e não afirma que algo foi executado contra o banco de
dados.

O único ponto que vale a pena ler com atenção é uma remoção. No Postgres,
remover uma propriedade é recusado porque isso excluiria uma coluna. No MongoDB,
o campo permanece em cada documento que o possui; sua API simplesmente para de
servi-lo. A alteração expressa isso em vez de deixar você assumir a resposta
relacional.

| Implantação | Funciona |
|---|---|
| `rebase dev` na sua máquina | sim |
| Self-host com o projeto montado | sim |
| Self-host a partir de um bundle compilado | sim, com `liveSchema.repository` |
| Rebase Cloud, ou qualquer bundle | sim, com `liveSchema.repository` |

Um bundle é uma saída compilada, portanto não há código-fonte de coleções nele.
Configure `liveSchema.repository` e o código-fonte será buscado no seu
repositório; sem isso, as rotas respondem `SCHEMA_EDITING_NO_REPOSITORY` e
explicam o motivo.

### Uma implantação sem código-fonte em disco

Um bundle é uma saída compilada — todo tenant da Cloud e qualquer self-host
servindo uma build. Não há código-fonte de coleções para o editor reescrever,
então aponte-o para o repositório onde o código-fonte realmente reside:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: {
        repository: {
            kind: "github",
            owner: "acme",
            repo: "storefront",
            branch: "main",
            // Where the collection source lives in that repository.
            // Defaults to "config/collections".
            collectionsPath: "config/collections",
            auth: { kind: "token", token: process.env.GITHUB_TOKEN! }
        }
    }
})
```

A alteração é então lida do repositório, reescrita com o mesmo editor executado
localmente e comitada de volta através da Git Data API — um blob, uma tree, um
commit e uma atualização de ref. Nada é clonado e nada é deixado em disco.

`auth` aceita um token ou uma instalação de GitHub App:

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Use o token para um projeto único comitando em um repositório que você já possui
— configurar um App para que seu próprio servidor possa comitar nele é muita
burocracia para uma credencial de uma linha. Use o App para um plano de controle
mantendo uma única chave para vários projetos, que é o que o Rebase Cloud faz:
um App, uma instalação por projeto e nenhum segredo por cliente para rotacionar.

O token precisa da permissão `contents: read and write` nesse repositório, e
nada mais.

Em uma máquina que possui o repositório, o commit é um simples `git commit` —
nada para autenticar, sem token, sem rede. Uma implantação sem ele comita
através da Git Data API, sem clonagem — consulte
[Uma implantação sem código-fonte em disco](#uma-implantação-sem-código-fonte-em-disco).

Duas coisas que tornam seguro executá-lo contra um repositório em que outra
pessoa está trabalhando:

- Ele adiciona à stage **apenas** os arquivos que gerou. Um commit de schema que
  incluísse trabalho pela metade seria um commit que ninguém conseguiria
  revisar, e ele se recusa expressamente se a árvore já tiver um de seus
  próprios arquivos modificado.
- O caminho remoto nunca atualiza uma ref com force (*force-update*). Se algo
  entrou no repositório enquanto o commit estava sendo construído, a atualização
  é rejeitada — perder o commit de alguém silenciosamente é pior do que falhar.

## Limitações

- Apenas alterações aditivas. Todo o resto é recusado com um motivo, porque o
  caminho ensure é a única coisa que altera um schema e ele só pode adicionar.
- Nenhum arquivo de migração é gerado. Um projeto provisionado pelo boot-ensure
  não precisa de nenhum; um projeto provisionado por migrações deve executar
  `rebase db generate`, que cria um através do Atlas com o hash de integridade
  que o Atlas exige.
- Apenas Postgres. A funcionalidade é detectada no driver, e outros mecanismos
  respondem `SCHEMA_EDITING_UNSUPPORTED`.

## Relacionado

- [Geração de Schema](/docs/cli/schema/) — as mesmas edições a partir da linha de comando
- [Definindo Coleções](/docs/collections/) — o que o editor está reescrevendo
- [Studio](/docs/studio/) — o painel por trás do qual essas rotas estão
