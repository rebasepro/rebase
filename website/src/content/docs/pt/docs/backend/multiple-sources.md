---
sourceHash: cc03d759eb4057c2
title: Múltiplos Bancos de Dados e Buckets
sidebar_label: Múltiplas Fontes
description: Direcione coleções para diferentes bancos de dados e propriedades para diferentes buckets de armazenamento, e configure cada um a partir do ambiente.
---

## Visão Geral

Um projeto não está limitado a um banco de dados e um bucket. Cada item nomeado de que um
projeto precisa — um banco de dados, um bucket, um tópico, uma fila — é **declarado com um
construtor na sua configuração**, e configurado a partir do ambiente por uma variável
derivada de sua chave. Crons e funções são arquivos, e eles entram no mesmo
grafo sob o nome do arquivo.

Uma regra, independentemente do tipo: não há um segundo lugar para procurar, e nada que
precise ser mantido em sincronia manualmente.

## Declarando recursos

Coloque-os em `config/resources.ts`. Exportá-los é uma boa prática — fornece
algo para você importar — mas a declaração é o que os registra.

```ts
// config/resources.ts
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

`queue()` é novo. `database()`, `bucket()` e `topic()`
podem ser declarados desde a versão 0.17, portanto, um projeto na versão lançada declara
esses três e acessa trabalhos em segundo plano por meio de `jobs.tasks`.

Em seguida, aponte uma coleção para um deles, por meio do handle — o mesmo nome, digitado uma única vez:

```ts
import { defineCollection } from "@rebasepro/cms-types";
import { analytics } from "../resources";

const pageViewsCollection = defineCollection({
    name: "Page Views",
    slug: "page_views",
    table: "page_views",
    dataSource: analytics,
    properties: { /* … */ }
});
```

...ou uma propriedade de arquivo:

```ts
import { media } from "../resources";

coverImage: {
    name: "Cover image",
    type: "string",
    storage: { storageSource: media, acceptedFiles: ["image/*"] }
}
```

`defineCollection` registra a chave do handle, de modo que, a partir desse ponto, uma coleção é
apenas dado puro — ela serializa, compara e chega à interface de administração (UI). A forma
em string (`dataSource: "analytics"`) ainda funciona; o handle é o elemento que uma renomeação
acompanha e onde o "jump-to-definition" vai parar.

Em uma função, os mesmos handles acessam o recurso:

```ts
import { defineFunction } from "@rebasepro/server/functions";
import { analytics, media } from "../../config/resources";

export default defineFunction((app, { rebase }) => {
    app.post("/report", async (c) => {
        const rows = await rebase.sql("select count(*) from page_views", { database: analytics });
        const file = new File([JSON.stringify(rows)], "report.json", { type: "application/json" });
        await rebase.bucket(media).putObject({ key: "report.json", file });
        return c.json({ ok: true });
    });
});
```

### Visualizando o que você declarou

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if that file is stale
```

`rebase.resources.json` é **gerado** e comitado no repositório. É o que o host lê
para decidir o que provisionar *antes* de executar qualquer coisa — é assim que um console
pode dizer "este projeto precisa de um bucket `media` e não possui nenhum" no primeiro deploy.
Edite as declarações, nunca o arquivo; `--check` falha o build caso os dois
estejam em desacordo.

Cada entrada também registra **quem a utiliza** — `collection:page_views` em um
banco de dados, `property:posts.cover` em um bucket, `function:report` em tudo o que
a função importa de `resources.ts`. Esse é o mapeamento de que o console precisa para
responder a "o que quebra se eu remover isto".

O comando `rebase status` vai um passo além: para cada declaração, ele informa se
o ambiente a vincula, usando os mesmos resolvedores usados na inicialização (boot), evitando
passar uma falsa segurança sobre uma implantação que está prestes a falhar ao iniciar.

### Um engine desconhecido pelo build

Cada tipo possui sua própria lista de engines, e um engine desconhecido é recusado no local da
chamada em vez de ser aceito para falhar mais tarde. Algo genuinamente fora da lista é
declarado usando `custom:`:

```ts
export const objects = bucket("objects", { engine: "custom:minio" });
```

### Corrigindo um tipo que já foi lançado

Para autores de drivers. A definição registrada de um tipo de recurso é **congelada** uma vez que
um pacote que a contenha tenha sido publicado: cada driver publicado embute sua própria
cópia de `@rebasepro/types`, e essa cópia compara a entrada do registro compartilhado
com seu próprio literal e lança um erro diante de qualquer diferença. Portanto, editar o literal
inutiliza todo bundle construído com um driver mais antigo durante o carregamento do driver.

`amendResourceKind` corrige o que um tipo *vincula* — suas bases de variáveis de ambiente, suas
chaves de opção — sem modificar o literal com o qual qualquer cópia mais antiga se compara:

```ts
import { amendResourceKind } from "@rebasepro/types";

amendResourceKind("database", {
    envBases: ["DATABASE_URL", "DATABASE_READ_URL", "ADMIN_CONNECTION_STRING"]
});
```

A alteração aplica-se apenas a leituras feitas por meio desta cópia, permitindo que um driver mais antigo continue
vinculando da forma como fazia quando foi publicado. Use-a para qualquer correção em um
tipo já lançado; use `registerResourceKind` apenas para um tipo que ninguém tenha publicado ainda.

### Disponibilizando-os para o frontend

O provedor `<Rebase>` precisa saber quais fontes existem e como cada uma é
acessada — uma fonte `direct` é aquela com a qual o navegador se comunica diretamente. Ele importa o
mesmo pacote de configuração que o backend importa, podendo reutilizar as declarações em vez
de repeti-las:

```tsx
import "../config/resources";                 // registers them
import { declaredDataSources, declaredStorageSources } from "@rebasepro/types";

<Rebase
    dataSources={declaredDataSources()}
    storageSources={declaredStorageSources()}
>
    {children}
</Rebase>
```

A importação por efeito colateral (side-effect import) é intencional: declarar é o que registra, portanto, um bundler
que descartasse um módulo não utilizado deixaria ambas as listas vazias.

## Configurando cada fonte

Os nomes das variáveis de ambiente são derivados da chave do recurso, logo não há
nada para manter em sincronia manualmente:

```
<VARIABLE>              the default resource   DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named resource       DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
```

A chave é convertida para maiúsculas e caracteres não alfanuméricos tornam-se underscores, de modo que
`media-cdn` lê `S3_BUCKET__MEDIA_CDN`.

O separador é intencionalmente um underscore **duplo**. Um underscore simples colidiria
com nomes de variáveis reais — `S3_BUCKET_NAME` seria interpretado como o bucket de uma
fonte chamada `name`.

### Bancos de dados

```bash
DATABASE_URL=postgres://localhost/app
DATABASE_URL__ANALYTICS=postgres://warehouse.internal/analytics

# Optional, per source:
DB_POOL_MAX__ANALYTICS=5
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

O driver é escolhido a partir do `engine` declarado (`postgres` e `mongodb` são
reconhecidos), e `REBASE_DRIVER__<KEY>` o sobrescreve para qualquer outro caso.
`REBASE_DB_POOL_MAX` é um limite para todo o processo, não uma vinculação por fonte; por isso,
ele não aceita sufixo.

Em desenvolvimento você não precisa configurar nada disso: `rebase dev` provê cada banco de dados
declarado a partir de seu Postgres gerenciado — uma segunda instância para `analytics`, iniciada
sob demanda — e exporta `DATABASE_URL__ANALYTICS` automaticamente. Uma variável definida
manualmente nunca é sobrescrita.

Tabelas e políticas de row-level-security são provisionadas **por fonte**: uma
coleção direcionada para `analytics` recebe sua tabela e suas políticas no
banco de dados de analytics.

### Armazenamento

```bash
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

O engine provém da declaração, portanto não há `STORAGE_TYPE` a ser configurado.

#### Qual bucket recebe um upload não qualificado

<span class="since-badge" data-since="0.25">Desde 0.25</span>

Uma propriedade de armazenamento que não especifica nenhum `storageSource` grava no bucket **padrão**.
Declarar buckets nomeados nunca o move. O padrão mantém a sua própria
configuração, seja qual for o conteúdo de `config/resources.ts`: `STORAGE_TYPE`,
`STORAGE_PATH` (`./uploads` quando não definido) e as variáveis `S3_*` / `GCS_*` sem
sufixo. Adicionar `bucket("media", { engine: "s3" })` a um projeto que já tem
arquivos em `./uploads` os deixa onde estão e ainda servidos. O `media` lê as suas
próprias variáveis `__MEDIA` e, em desenvolvimento, vira um diretório próprio,
`uploads__media`.

Para enviar os uploads não qualificados a um bucket nomeado, marque-o:

```ts
export const media = bucket("media", { engine: "s3", default: true });
```

O padrão então *é* `media`. Os arquivos que o padrão guardava antes ficam onde
estão e deixam de ser servidos por ele, então copie-os primeiro:
`rebase storage move --from "(default)" --to media`.

Duas fontes não podem compartilhar uma localização. Se um bucket nomeado resolvesse
para o diretório do padrão (ou para um dentro dele), ou para o mesmo bucket de
armazenamento de objetos no mesmo endpoint, o boot recusa e indica a variável a alterar.

Na 0.24, um projeto que declara apenas buckets nomeados tem o primeiro declarado
promovido a padrão no boot, com um aviso, de modo que adicionar `bucket("media")`
move o padrão para `uploads__media`.

### Múltiplos buckets em uma única conta

Cada variável é lida por chave, o que é correto para o nome do bucket e incorreto para
as credenciais — quinze buckets em uma mesma instalação do MinIO exigiriam quinze cópias
da mesma chave de acesso. Defina um `account` e as variáveis em nível de provedor serão
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

A especificação de conta abrange as variáveis que descrevem o *provedor*:
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`,
`S3_FORCE_PATH_STYLE`, `GCS_PROJECT_ID` e `GCS_KEY_FILENAME`. O nome do bucket
não faz parte dessa lista e nunca possui fallback — se possuísse, dois buckets em uma mesma conta
se fundiriam silenciosamente em um só.

Um valor definido por bucket ainda tem precedência onde estiver configurado, permitindo que uma única fonte seja migrada
para outro provedor sem desvincular as demais de sua conta compartilhada.
Não há, propositalmente, fallback para a variável sem sufixo: essa variável pertence à
fonte padrão, e permitir que um bucket nomeado a herdasse faria com que uma chave digitada incorretamente
assinasse operações com as credenciais de outra fonte.

## Tópicos e filas

Um tópico tem suas mensagens entregues por meio da fila de jobs durável: publicar escreve **uma linha
por inscrição**, de modo que cada inscrito tenta novamente no seu próprio cronograma e uma inscrição com falha
não bloqueia as outras nem força sua reexecução.

```ts
await signups.publish({ userId });
```

Uma fila é a outra forma de trabalho em segundo plano: uma lista de trabalho com **um
único handler**, onde o chamador retém o id do job. Filas são novas
 — tópicos foram lançados na versão 0.17.

```ts
export const thumbnails = queue<{ key: string }>("thumbnails");
thumbnails.handler(async ({ key }, { attempt }) => { /* … */ });

const { id } = await thumbnails.enqueue({ key }, { runAt: new Date(Date.now() + 60_000) });
```

Ambos operam no modelo **pelo menos uma vez** (at-least-once). Um worker que falhe enquanto processa um job o libera,
e o próximo inicia o handler desde o início; portanto, um handler deve tolerar o recebimento
de um evento em duplicidade. Publicações ou enfileiramentos dentro de uma transação revertida (rollback)
nunca existiram — trata-se de uma inserção de linha no banco.

Declarar qualquer um deles ativa a fila de jobs automaticamente em qualquer fluxo de inicialização — um
projeto no runtime gerenciado, que não tem ponto de entrada para passar `jobs.tasks`,
obtém seus handlers desta forma. Publicar em um tópico que nada declara, ou
enfileirar em uma fila sem handler, lança uma exceção em vez de gravar linhas que nenhum
worker irá processar.

## Crons e funções

Ambos são arquivos — `backend/crons/<name>.ts`, `backend/functions/<name>.ts` —
e ambos entram no grafo com o nome do arquivo, que também é o id com o qual o
agendador executa o cron e o caminho onde a função é montada. Nenhum dos dois obtém configurações
do ambiente; eles estão no grafo para que o host conheça os agendamentos do projeto
antes de executar qualquer coisa.

```ts
export default defineCron({
    name: "Nightly cleanup",
    schedule: "0 3 * * *",
    timezone: "Europe/Madrid",
    async handler({ rebase }) { /* … */ }
});
```

Sem `timezone`, o agendamento é interpretado no fuso horário do próprio host — UTC em praticamente
todos os containers, ou o seu fuso horário local no seu computador — portanto, `0 3 * * *` significará um horário diferente
dependendo do ambiente de deploy. Um fuso horário desconhecido é recusado no carregamento do job.

## Comportamento em caso de falha

Uma fonte de dados com transporte de servidor declarada sem string de conexão **causa falha na
inicialização (boot)**, informando o nome da variável que deve ser definida. Isso é intencional e importante de compreender:
a alternativa seria fazer com que as coleções roteadas para a fonte inexistente usassem silenciosamente
o banco de dados padrão. Isso significaria dados gravados no local errado por trás de um
servidor que relata estar saudável — algo muito pior do que um container que se recusa a
iniciar.

Duas chaves que gerariam o mesmo nome de variável também são rejeitadas, pois uma
delas leria silenciosamente a configuração da outra.

Fontes declaradas com `transport: "direct"` são completamente ignoradas: o cliente
comunica-se diretamente com elas, de modo que o backend não mantém conexão e não requer
nenhuma configuração para elas.

## Controle de acesso ao armazenamento

As chaves de armazenamento compartilham um único namespace simples e não estão sob row-level security, portanto,
sem um modelo explícito de controle de acesso, o padrão seria "qualquer usuário autenticado
pode ler, sobrescrever, excluir ou listar qualquer objeto". O ambiente de produção se recusa a iniciar
em vez de assumir essa premissa.

A forma de definir o que o acesso significa para o seu projeto é exportar `storageAuthorize`
a partir do pacote de configuração — uma função, já que nenhuma variável de ambiente consegue expressar
"este usuário pode ler esta chave":

```ts
// config/index.ts
import type { StorageAuthorize } from "@rebasepro/types";

export const storageAuthorize: StorageAuthorize = async ({ key, user, operation }) => {
    if (!user) return false;
    const [ownerId] = key.split("/");
    return ownerId === user.uid || operation === "read";
};
```

Existem duas opções de escape via variáveis de ambiente para os casos em que esse é realmente o modelo desejado:

- `STORAGE_PUBLIC_READ=true` — o bucket funciona como uma CDN pública, somente leitura. Operações de escrita,
  exclusão e listagem continuam exigindo autenticação.
- `STORAGE_ALLOW_ANY_AUTHENTICATED=true` — todo usuário autenticado tem permissão sobre
  qualquer arquivo. Aceitável para uma aplicação single-tenant, nunca para uma aplicação multi-tenant.

## Armazenamento em produção

Sem nenhum bucket configurado, o armazenamento fica **desativado** em produção e os uploads retornam
`501`. O disco local é o sistema de arquivos do container, portanto os arquivos gravados nele desaparecem
na próxima reinicialização — um upload que falha explicitamente pode ser tentado novamente; um upload que obteve sucesso
em um disco prestes a ser apagado, não. Defina `FORCE_LOCAL_STORAGE=true` apenas quando um
volume durável estiver realmente montado.

Esse volume precisa conter todos os buckets locais, e não apenas o padrão. O diretório de um bucket
local nomeado fica posicionado ao lado do diretório padrão: `<STORAGE_PATH>__<key>`.
Com `STORAGE_PATH=/storage/uploads`, `bucket("media", { engine: "local" })`
grava em `/storage/uploads__media`. Monte o volume no diretório pai,
`/storage`, como faz o arquivo compose gerado por `rebase init`, e não diretamente no
`STORAGE_PATH`. `STORAGE_PATH__MEDIA` define o diretório de um bucket
específico explicitamente. Consulte [Auto-hospedagem](/docs/deployment/self-hosting/#file-storage).

<span class="since-badge" data-since="0.25">Desde 0.25</span> Declarar buckets
não altera o bucket padrão. Com apenas `bucket("media")` declarado, o padrão
ainda lê as suas próprias variáveis. Em desenvolvimento é `./uploads`. Em produção,
sem vinculação, ele fica desativado como qualquer bucket sem vinculação: os uploads
que não especificam nenhum `storageSource` respondem `501 STORAGE_NOT_CONFIGURED`. O boot
avisa uma vez, com as duas soluções: vincule-o (`STORAGE_TYPE=s3` e `S3_BUCKET`, ou
`STORAGE_TYPE=gcs` e `GCS_BUCKET`), ou marque um bucket nomeado com `default: true`.

Em desenvolvimento, um bucket declarado que não possua vinculação passa a ser um diretório local —
`uploads__media` ao lado do `uploads` padrão — independentemente do engine declarado, de forma que
`bucket("media", { engine: "s3" })` juntamente com `rebase dev` é suficiente para enviar um
arquivo. O boot informa qual engine o diretório está emulando, e o comando `rebase
status` exibe isso em amarelo ao lado do ícone de confirmação. Isso nunca acontece em produção
ou no runtime gerenciado: um bucket criado dessa forma gravaria uploads no sistema
de arquivos do container que desaparece no rollout seguinte, logo um bucket sem vinculação
permanece desvinculado e responde 501.

## Relacionados

- [Visão Geral do Backend](/docs/backend/) — `dataSources` e onde fica a declaração
- [Configuração de Armazenamento](/docs/backend/storage/) — a mesma estrutura para buckets
- [Ambiente e Configuração](/docs/getting-started/configuration/) — a convenção `__SUFFIX` que vincula uma fonte às suas variáveis
