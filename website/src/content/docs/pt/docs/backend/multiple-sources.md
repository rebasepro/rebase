---
sourceHash: bdf9409c94709498
title: Múltiplos Bancos de Dados e Buckets
sidebar_label: Múltiplas Fontes
description: Direcione tabelas para diferentes bancos de dados e colunas de armazenamento para diferentes buckets, e configure cada um a partir do ambiente.
---

## Visão Geral

Um projeto não está limitado a um banco de dados e um bucket. Cada item nomeado
de que um projeto precisa — um banco de dados, um bucket, um tópico, uma fila — é **declarado com um
construtor em `backend/resources.ts`**, e configurado a partir do ambiente por uma variável
derivada de sua chave. Crons e funções são arquivos, e eles entram no mesmo
grafo sob o nome do arquivo.

Uma regra, independentemente do tipo: não há um segundo lugar para olhar, e nada que
tenha de ser mantido em sincronia manualmente.

## Declarando recursos

Coloque-os em `backend/resources.ts`. Exportá-los é uma boa prática — fornece
algo para você importar —, mas a declaração é o que realmente os registra.

```ts
// backend/resources.ts
import { bucket, database, queue, topic } from "@rebasepro/types";

/** The project's database. Reads DATABASE_URL, as it always did. */
export const main = database();

/** A second one. Reads DATABASE_URL__ANALYTICS. */
export const analytics = database("analytics", { label: "Analytics warehouse" });

/** A bucket. Reads S3_BUCKET__MEDIA. */
export const media = bucket("media", { engine: "s3", label: "Public media" });

/** A topic, delivered through the durable job queue. */
export const signups = topic<{ userId: string }>("signups");

signups.subscription("send-welcome", async (event) => {
    // …
});
```

`database()`, `bucket()` e `topic()` podem ser declarados desde a versão 0.17, e
`queue()` desde a 0.18.

Em seguida, aponte uma tabela para um deles, por handle — o mesmo nome, escrito uma única vez:

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```ts
// backend/schema/page_views.ts
import { defineTable, col } from "@rebasepro/server/schema";
import { analytics, media } from "../resources";

export const pageViews = defineTable("page_views", {
    database: analytics,
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        path: col.text().notNull(),
        // A file column, stored in the `media` bucket.
        screenshot: col.storage({ path: "screenshots/", source: media, accept: ["image/*"] })
    },
    rls: "admin-only"
});
```

A tabela compilada registra a chave do handle, portanto, a partir desse ponto, são apenas
dados puros — são serializados, comparados e chegam ao painel administrativo através de
`GET /api/schema/tables`. O formato em string (`database: "analytics"`) também funciona;
o handle é aquele que uma renomeação acompanha e onde o "ir para a definição" vai parar.

Em uma função, os mesmos handles acessam o recurso:

```ts
import { defineFunction } from "@rebasepro/server/functions";
import { analytics, media } from "../resources";

export default defineFunction((app, { rebase }) => {
    app.post("/report", async (c) => {
        const rows = await rebase.sql("select count(*) from page_views", { database: analytics });
        const file = new File([JSON.stringify(rows)], "report.json", { type: "application/json" });
        await rebase.bucket(media).putObject({ key: "report.json", file });
        return c.json({ ok: true });
    });
});
```

`{ database: analytics }` executa a consulta na própria conexão daquela fonte —
para onde quer que `DATABASE_URL__ANALYTICS` aponte, em qualquer servidor — e nenhuma
opção a executa na padrão. Uma chave que referencia uma fonte não configurada é
recusada com um erro que lista as opções disponíveis.

### Visualizando o que você declarou

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if that file is stale
```

O `rebase.resources.json` é **gerado** e comitado. É o que um host lê
para decidir o que provisionar *antes* de executar qualquer coisa — é assim que um console
pode informar que "este projeto requer um bucket `media` e não possui nenhum" em um primeiro deploy.
Edite as declarações, nunca o arquivo; `--check` falha uma build se os dois
estiverem em desacordo.

Cada entrada também registra **quem a utiliza** — `table:page_views` em um
banco de dados, `column:posts.cover` em um bucket, `function:report` em qualquer coisa
que a função importe de `resources.ts`. Esse é o mapeamento que um console precisa para
responder à pergunta: "o que quebra se eu remover isto?".

O `rebase status` vai um passo além: para cada declaração, ele informa se
o ambiente a vincula, usando os mesmos resolvedores que o boot utiliza, de modo que ele não pode
tranquilizá-lo sobre uma implantação que está prestes a recusar iniciar.

### Um engine que a build nunca ouviu falar

Cada tipo possui sua lista de engines, e um desconhecido é recusado no ponto de chamada
em vez de aceito e com falha posterior. Algo genuinamente fora da lista é
especificado com `custom:`:

```ts
export const objects = bucket("objects", { engine: "custom:minio" });
```

### Corrigindo um tipo que já foi publicado

Para autores de drivers. A definição registrada de um tipo de recurso é **congelada** assim que um
pacote que a contém for publicado: todo driver publicado inclui inline sua própria
cópia de `@rebasepro/types`, e a cópia compara a entrada do registro compartilhado
com seu próprio literal, disparando um erro em caso de qualquer diferença. Editar o literal,
portanto, inviabiliza todo bundle compilado com um driver mais antigo durante o carregamento do driver.

`amendResourceKind` corrige o que um tipo *vincula* — suas bases de ambiente, suas
chaves de opção — sem alterar o literal que qualquer cópia mais antiga compara:

```ts
import { amendResourceKind } from "@rebasepro/types";

amendResourceKind("database", {
    envBases: ["DATABASE_URL", "DATABASE_READ_URL", "ADMIN_CONNECTION_STRING"]
});
```

A emenda se aplica apenas às leituras feitas através desta cópia, portanto, um driver mais antigo continua
vinculando da forma como fazia quando foi publicado. Use isso para qualquer correção em um
tipo já lançado; use `registerResourceKind` apenas para um tipo que ninguém publicou.

### Disponibilizando-os para o frontend

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O frontend não importa `backend/resources.ts`: uma importação de valor de
qualquer item sob `backend/` a partir de `frontend/` é recusada por
`pnpm check:frontend-backend-imports`, porque isso enviaria módulos do servidor para
o navegador. Não é necessário. O provedor `<Rebase>` lê os buckets que o
backend fornece a partir de `GET /api/storage/sources` e conecta cada um deles, e cada
tabela que o backend fornece, qualquer que seja o banco de dados em que resida, é acessada por meio
da API.

O que o frontend declara por si só é uma fonte `direct` — uma com a qual o navegador conversa
sem o backend, como o Firestore — passada para o `<Rebase>` como uma instância
ativa através de `dataSources` ou `storageSources`. Consulte
[Firebase](/docs/frontend/firebase/).

## Configurando cada fonte

Os nomes das variáveis de ambiente são derivados da chave do recurso, portanto, não há
nada para manter em sincronia manualmente:

```
<VARIABLE>              the default resource   DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named resource       DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
```

A chave é convertida para maiúsculas e caracteres não alfanuméricos tornam-se sublinhados, de modo que
`media-cdn` lê `S3_BUCKET__MEDIA_CDN`.

O separador é um sublinhado **duplo** intencionalmente. Um simples colidiria
com nomes de variáveis reais — `S3_BUCKET_NAME` seria interpretado como o bucket para uma
fonte chamada `name`.

### Bancos de dados

```bash
DATABASE_URL=postgres://localhost/app
DATABASE_URL__ANALYTICS=postgres://warehouse.internal/analytics

# Optional, per source:
DB_POOL_MAX__ANALYTICS=5
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

O driver é escolhido a partir do `engine` declarado — `postgres` é aquele para o qual o Rebase
fornece um driver de servidor, e o único para o qual uma tabela pode ser direcionada — e
`REBASE_DRIVER__<KEY>` o sobrescreve com um driver próprio. Um banco de dados Firestore
não é um recurso de backend: o CMS o lê a partir do navegador, através de
[`defineFirestoreCollection`](/docs/frontend/firebase/).
`REBASE_DB_POOL_MAX` é um teto para todo o processo, não uma vinculação por fonte, portanto,
não recebe sufixo.

Em desenvolvimento você não define nada disso: `rebase dev` serve cada banco de dados
declarado a partir do seu Postgres gerenciado — uma segunda instância para `analytics`, iniciada
sob demanda — e exporta `DATABASE_URL__ANALYTICS` automaticamente. Uma variável definida
manualmente nunca é sobrescrita.

Tabelas e políticas de row-level-security são provisionadas **por fonte**: uma
tabela direcionada para `analytics` obtém sua tabela, e suas políticas, no
banco de dados analytics.

### Armazenamento

```bash
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

O engine vem da declaração, portanto não há `STORAGE_TYPE` a ser definido.

#### Qual bucket recebe um upload não qualificado

Uma coluna de armazenamento que não especifica uma `source` grava no bucket **padrão**.
Declarar buckets nomeados nunca o altera de lugar. O padrão mantém sua própria
configuração independentemente do que `backend/resources.ts` declara: `STORAGE_TYPE`,
`STORAGE_PATH` (`<project>/uploads` quando não definido), e as variáveis `S3_*` / `GCS_*`
sem sufixo. Adicionar `bucket("media", { engine: "s3" })` a um projeto que já
possui arquivos em `./uploads` mantém esses arquivos onde estão e ainda disponíveis. `media`
lê suas próprias variáveis `__MEDIA` e, em desenvolvimento, atua como seu próprio
diretório, `uploads__media`.

Para enviar uploads não qualificados para um bucket nomeado, marque-o:

```ts
export const media = bucket("media", { engine: "s3", default: true });
```

O padrão passa a *ser* `media`. Os arquivos que o padrão continha anteriormente permanecem onde
estão e deixam de ser servidos através dele; portanto, copie-os antes:
`rebase storage move --from "(default)" --to media`.

Duas fontes não podem compartilhar uma localização. Se um bucket nomeado apontar para o
diretório padrão (ou um dentro dele), ou para o mesmo bucket de armazenamento de objetos no
mesmo endpoint, o boot é recusado e indica qual variável deve ser alterada.

### Vários buckets em uma única conta

Cada variável é lida por chave, o que é adequado para o nome do bucket e incorreto para
as credenciais — quinze buckets em uma única instalação MinIO significariam quinze cópias
da mesma chave de acesso. Defina uma `account` e as variáveis em nível de provedor serão
lidas uma única vez:

```ts
export const media   = bucket("media",   { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```bash
S3_BUCKET__MEDIA=project-media       # per bucket, never shared
S3_BUCKET__AVATARS=project-avatars
S3_ACCESS_KEY_ID__MINIO=…            # read once, by both
S3_SECRET_ACCESS_KEY__MINIO=…
S3_ENDPOINT__MINIO=https://minio.internal
```

O formato de conta abrange as variáveis que descrevem o *provedor*:
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`,
`S3_FORCE_PATH_STYLE`, `GCS_PROJECT_ID` e `GCS_KEY_FILENAME`. O nome do bucket
não é uma delas e nunca faz fallback — se fizesse, dois buckets em uma conta
se tornariam silenciosamente um só.

Um valor específico por bucket continua prevalecendo onde você o definir, portanto uma única fonte pode ser movida
para outro provedor sem desvincular as demais da conta compartilhada. Não
há deliberadamente nenhum fallback para a variável sem sufixo: aquela pertence à
fonte padrão, e permitir que um bucket nomeado a herde significaria que uma chave digitada incorretamente
assinaria requisições com as credenciais de outra fonte.

## Tópicos e filas

Um tópico é entregue por meio da fila de trabalhos durável: publicar grava **uma linha
por inscrição**, de modo que cada assinante tenta novamente em seu próprio agendamento e um que apresente
falha não bloqueia os outros nem faz com que sejam executados novamente.

```ts
await signups.publish({ userId });
```

Uma fila é o outro formato de trabalho em segundo plano: uma lista de trabalho com **um único
manipulador**, onde o chamador retém o ID do job. Filas foram introduzidas na versão 0.18,
e tópicos na 0.17.

```ts
export const thumbnails = queue<{ key: string }>("thumbnails");
thumbnails.handler(async ({ key }, { attempt }) => { /* … */ });

const { id } = await thumbnails.enqueue({ key }, { runAt: new Date(Date.now() + 60_000) });
```

Ambos operam em modelo **pelo menos uma vez (at-least-once)**. Um worker que cai segurando um job o libera e
o próximo inicia o manipulador do início, portanto um manipulador deve tolerar a visualização
de um evento duas vezes. Publicar ou enfileirar dentro de uma transação que sofre rollback
nunca ocorreu — é uma inserção de linha.

Declarar qualquer um deles ativa a fila de trabalhos automaticamente, em todos os caminhos de boot — um
projeto no runtime gerenciado, que não tem ponto de entrada para passar `jobs.tasks`,
obtém seus manipuladores dessa maneira. Publicar em um tópico que nada declara, ou
enfileirar em uma fila sem manipulador, gera um erro em vez de gravar linhas que nenhum
worker gerencia.

## Crons e funções

Ambos são arquivos — `backend/crons/<name>.ts`, `backend/functions/<name>.ts` —
e ambos entram no grafo com o nome do arquivo, que também é o identificador sob o qual o
agendador executa uma cron e o caminho em que uma função é montada. Nenhum dos dois faz vinculação a partir
do ambiente; eles estão no grafo para que um host conheça os agendamentos de um projeto
antes de executar qualquer coisa.

```ts
export default defineCron({
    name: "Nightly cleanup",
    schedule: "0 3 * * *",
    timezone: "Europe/Madrid",
    async handler({ rebase }) { /* … */ }
});
```

Sem `timezone`, o agendamento é lido no fuso do próprio host — UTC em quase
todos os containers, o seu em um laptop — portanto, `0 3 * * *` significa uma hora diferente
em cada lado de um deploy. Um fuso horário desconhecido é recusado quando o trabalho carrega.

## Comportamento em caso de falha

Uma fonte de dados de transporte de servidor declarada sem string de conexão **provoca falha no
boot**, indicando a variável a ser definida. Isso é intencional e importante de compreender:
a alternativa seria tabelas direcionadas para a fonte faltante silenciosamente caírem de volta
para o banco de dados padrão. Isso significaria dados indo parar no local errado por trás de um
servidor que reporta a si mesmo como saudável — muito pior do que um container que se recusa a
iniciar.

Duas chaves que gerariam o mesmo nome de variável também são rejeitadas, pois uma
delas leria silenciosamente a configuração da outra.

Fontes declaradas com `transport: "direct"` são ignoradas completamente: o cliente
conversa com elas diretamente, de modo que o backend não mantém conexão e não exige
configuração para elas.

## Controle de acesso ao armazenamento

As chaves de armazenamento compartilham um único namespace simples e não estão sob row-level security, portanto,
sem um modelo de controle de acesso explícito, o padrão seria "qualquer usuário autenticado
pode ler, sobrescrever, excluir ou listar qualquer objeto". O ambiente de produção se recusa a iniciar
em vez de assumir isso.

A maneira de definir o que significa acesso para o seu projeto é através da exportação de um `storageAuthorize`
de `backend/storage.ts` — uma função, pois nenhuma variável de ambiente pode expressar
"este usuário pode ler esta chave":

```ts
// backend/storage.ts
import type { StorageAuthorize } from "@rebasepro/types";

export const storageAuthorize: StorageAuthorize = async ({ key, user, operation }) => {
    if (!user) return false;
    const [ownerId] = key.split("/");
    return ownerId === user.uid || operation === "read";
};
```

Existem dois escapes via variáveis de ambiente para os casos em que esse realmente seja o modelo:

- `STORAGE_PUBLIC_READ=true` — o bucket é uma CDN pública, somente leitura. Sem um
  hook `storageAuthorize`, gravações, exclusões e listagens são exclusivas para administradores.
- `STORAGE_ALLOW_ANY_AUTHENTICATED=true` — qualquer usuário autenticado é confiável para
  qualquer arquivo. Aceitável para um aplicativo single-tenant, nunca para um multi-tenant.

## Armazenamento em produção

Sem nenhum bucket configurado, o armazenamento fica **desativado** em produção e os uploads respondem
`501`. O disco local é o sistema de arquivos do container, portanto, os arquivos gravados lá desaparecem
na próxima reinicialização — um upload que falha explicitamente pode ser tentado novamente; um que teve sucesso
em um disco prestes a ser apagado, não. Defina `FORCE_LOCAL_STORAGE=true` apenas quando um
volume durável estiver realmente montado.

Esse volume precisa comportar todos os buckets locais, não apenas o padrão. O diretório
de um bucket local nomeado fica ao lado do diretório padrão, `<STORAGE_PATH>__<key>`.
Com `STORAGE_PATH=/storage/uploads`, `bucket("media", { engine: "local" })`
grava em `/storage/uploads__media`. Monte o volume no diretório pai,
`/storage`, assim como faz o arquivo compose que o `rebase init` cria, e não no
próprio `STORAGE_PATH`. `STORAGE_PATH__MEDIA` define o diretório de um bucket
explicitamente. Consulte [Auto-hospedagem](/docs/deployment/self-hosting/#file-storage).

Declarar
buckets não altera o bucket padrão. Declarando apenas `bucket("media")`,
o padrão ainda lê suas próprias variáveis. Em desenvolvimento, ele é
`./uploads`. Em produção, sem vinculação, fica desativado como qualquer bucket não vinculado: uploads
que não especificam uma `source` respondem com `501 STORAGE_NOT_CONFIGURED`. O boot informa isso
uma vez, com ambas as correções: vincule-o (`STORAGE_TYPE=s3` e `S3_BUCKET`, ou
`STORAGE_TYPE=gcs` e `GCS_BUCKET`), ou marque um bucket nomeado com `default: true`.

Em desenvolvimento, um bucket declarado que não possui vinculação é um diretório local —
`uploads__media` ao lado do `uploads` padrão — qualquer que seja o engine declarado, portanto
`bucket("media", { engine: "s3" })` mais `rebase dev` é suficiente para enviar um
arquivo. O boot informa qual engine o diretório está substituindo, e o `rebase
status` o exibe em amarelo ao lado da marca de seleção. Isso nunca acontece em produção,
ou no runtime gerenciado: um bucket criado lá gravaria uploads em um
sistema de arquivos do container que desaparece no próximo rollout, portanto um bucket não vinculado
permanece não vinculado e responde com 501.

## Relacionados

- [Visão Geral do Backend](/docs/backend/) — onde fica cada declaração
- [Configuração de Armazenamento](/docs/backend/storage/) — o mesmo formato para buckets
- [Ambiente e Configuração](/docs/getting-started/configuration/) — a convenção `__SUFFIX` que vincula uma fonte às suas variáveis
