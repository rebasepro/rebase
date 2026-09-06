---
sourceHash: 7dadf2d57e6bfecf
title: Múltiplos Bancos de Dados e Buckets
sidebar_label: Múltiplas Fontes
description: Especifique rotas de coleções para diferentes bancos de dados e propriedades para diferentes buckets de armazenamento, e configure cada um a partir do ambiente.
---

## Visão geral

Um projeto não está limitado a apenas um banco de dados e um bucket. Tudo o que um projeto precisa e tem um nome — um banco de dados, um bucket, um tópico, uma fila — é **declarado com um construtor na sua configuração**, e configurado a partir do ambiente por uma variável derivada da sua chave. Crons e funções são arquivos, e entram no mesmo grafo sob o nome do arquivo.

Uma única regra, seja qual for o tipo: não há um segundo lugar onde procurar, e nada que precise ser mantido sincronizado à mão.

## Declarar os recursos

Coloque-os em `config/resources.ts`. Exportá-los é boa prática — dá a você algo
para importar — mas o que os registra é a declaração.

```ts
// config/resources.ts
import { bucket, database, queue, topic } from "@rebasepro/types";

/** A base de dados do projeto. Lê DATABASE_URL, como sempre leu. */
export const main = database();

/** Uma segunda. Lê DATABASE_URL__ANALYTICS. */
export const analytics = database("analytics", { label: "Analytics warehouse" });

/** Um bucket. Lê S3_BUCKET__MEDIA. */
export const media = bucket("media", { engine: "s3", label: "Public media" });

/** Um tópico, entregue através da fila de trabalhos durável. */
export const signups = topic<{ userId: string }>("signups");

signups.subscription("send-welcome", async (event) => {
    // …
});
```

`queue()` é novo <span class="since-badge" data-since="0.18">Since 0.18</span>. `database()`, `bucket()` e `topic()`
são declaráveis desde a 0.17, então um projeto na versão lançada declara esses
três e alcança o trabalho em segundo plano através de `jobs.tasks`.

Depois aponte uma coleção para um deles, pelo handle — o mesmo nome, escrito uma
única vez:

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

`defineCollection` registra a chave do handle, então daí em diante uma coleção é dado simples: ela serializa, ela se compara, ela chega à interface de administração. A forma em string (`dataSource: "analytics"`) continua funcionando; o handle é o que uma renomeação acompanha e onde "ir para a definição" aterrissa.

Dentro de uma função, os mesmos handles alcançam o recurso:

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

### Ver o que você declarou

<span class="since-badge" data-since="0.18">Since 0.18</span>

```bash
rebase resources            # listá-los
rebase resources --write    # regerar rebase.resources.json
rebase resources --check    # falhar se esse arquivo estiver desatualizado
```

`rebase.resources.json` é **gerado** e versionado. É o que um host lê para decidir o que aprovisionar *antes* de executar qualquer coisa — é assim que um console consegue dizer "este projeto quer um bucket `media` e não tem nenhum" no primeiro deploy. Edite as declarações, nunca o arquivo; `--check` faz uma build falhar se os dois divergirem.

Cada entrada registra também **quem o usa** — `collection:page_views` num banco de dados, `property:posts.cover` num bucket, `function:report` no que a função importar de `resources.ts`. Esse é o mapa de que um console precisa para responder "o que quebra se eu remover isto".

`rebase status` vai um passo além: para cada declaração ele diz se o ambiente a vincula, usando os mesmos resolvedores que a inicialização usa, de modo que não pode tranquilizá-lo sobre uma implantação que está prestes a se recusar a iniciar.

### Um motor de que a build nunca ouviu falar

Cada tipo é dono da sua própria lista de motores, e um desconhecido é recusado no local da chamada em vez de aceito e posto em falha mais tarde. Algo genuinamente fora da lista escreve-se `custom:`:

```ts
export const objects = bucket("objects", { engine: "custom:minio" });
```

### Corrigir um kind que já foi publicado

<span class="since-badge" data-since="0.18">Since 0.18</span>

Para autores de drivers. A definição registada de um kind de recurso fica
**congelada** assim que um pacote que a transporta é publicado: cada driver
publicado inclui a sua própria cópia de `@rebasepro/types`, e essa cópia compara
a entrada do registo partilhado com o seu próprio literal e lança um erro
perante qualquer diferença. Editar o literal mata, por isso, todos os bundles
construídos com um driver mais antigo, no carregamento do driver.

`amendResourceKind` corrige aquilo a que um kind *se liga* — as suas bases de
variáveis de ambiente, as suas chaves de opções — sem tocar no literal que uma
cópia mais antiga compara:

```ts
import { amendResourceKind } from "@rebasepro/types";

amendResourceKind("database", {
    envBases: ["DATABASE_URL", "DATABASE_READ_URL", "ADMIN_CONNECTION_STRING"]
});
```

A correção aplica-se apenas às leituras através desta cópia, por isso um driver
mais antigo continua a ligar-se como o fazia quando foi publicado. Use-a para
qualquer correção a um kind já publicado; use `registerResourceKind` apenas para
um kind que ninguém publicou.

### Entregá-los ao frontend

O provider `<Rebase>` precisa saber quais fontes existem e como cada uma é alcançada — uma fonte `direct` é uma com a qual o próprio navegador conversa. Ele importa o mesmo pacote de configuração que o backend, então pode reutilizar as declarações em vez de repeti-las:

```tsx
import "../config/resources";                 // registra-as
import { declaredDataSources, declaredStorageSources } from "@rebasepro/types";

<Rebase
    dataSources={declaredDataSources()}
    storageSources={declaredStorageSources()}
>
    {children}
</Rebase>
```

O import por efeito colateral é deliberado: declarar é o que registra, então um bundler que descartasse um módulo não usado deixaria as duas listas vazias.

## Configurando cada fonte

Os nomes das variáveis de ambiente são derivados da chave do recurso, portanto não há nada que precise ser mantido sincronizado manualmente:

```
<VARIABLE>              the default resource   DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named resource       DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
```

A chave é convertida para maiúsculas e os caracteres não alfanuméricos se tornam sublinhados, então `media-cdn` lê `S3_BUCKET__MEDIA_CDN`.

O separador é um sublinhado **duplo** de propósito. Um único entraria em conflito com nomes de variáveis reais — `S3_BUCKET_NAME` seria interpretado como o bucket de uma fonte chamada `name`.

### Bancos de dados

```bash
DATABASE_URL=postgres://localhost/app
DATABASE_URL__ANALYTICS=postgres://warehouse.internal/analytics

# Optional, per source:
DB_POOL_MAX__ANALYTICS=5
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

O driver é escolhido a partir do `engine` declarado (`postgres` e `mongodb` são conhecidos), e `REBASE_DRIVER__<KEY>` o substitui para qualquer outro caso. `REBASE_DB_POOL_MAX` é um teto para o processo inteiro, não um vínculo por fonte, portanto não recebe sufixo.

Em desenvolvimento você não configura nada disso: `rebase dev` serve cada banco de dados declarado a partir do seu Postgres gerenciado — uma segunda instância para `analytics`, iniciada sob demanda — e exporta `DATABASE_URL__ANALYTICS` por conta própria. Uma variável que você definir à mão nunca é sobrescrita.

Tabelas e políticas de segurança em nível de linha são aprovisionadas **por fonte**: uma coleção roteada para `analytics` recebe a sua tabela, e as suas políticas, no banco de dados analytics.

### Armazenamento

```bash
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

O motor vem da declaração, portanto não há nenhum `STORAGE_TYPE` a definir.

#### Que bucket recebe um carregamento não qualificado

Uma propriedade de armazenamento que não nomeia nenhuma `storageSource` escreve
no bucket **padrão**, e um projeto com buckets nomeados tem de dizer qual é.
Ou declara o bucket com a chave padrão — `export const uploads = bucket();` — ou
marca um dos nomeados:

```ts
export const media = bucket("media", { engine: "s3", default: true });
```

O arranque recusa um projeto com buckets nomeados e sem nenhum padrão, e nomeia
as duas soluções. Antes escolhia o primeiro declarado, com um aviso: isso
decidia onde os ficheiros de um utilizador vão parar pela ordem de declaração, e
dava respostas diferentes de um lado e do outro de um deploy, porque o bucket
local com que o desenvolvimento faz de substituto é descartado em produção — e a
promoção não.

### Vários buckets em uma só conta

Cada variável é lida por chave: isso está certo para o *nome* do bucket e errado
para as credenciais — quinze buckets na mesma instalação MinIO significariam
quinze cópias da mesma access key. Indique uma `account` e as variáveis ao nível
do fornecedor são lidas uma só vez:

```ts
export const media   = bucket("media",   { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```bash
S3_BUCKET__MEDIA=project-media       # por bucket, nunca partilhado
S3_BUCKET__AVATARS=project-avatars
S3_ACCESS_KEY_ID__MINIO=…            # lida uma vez, por ambos
S3_SECRET_ACCESS_KEY__MINIO=…
S3_ENDPOINT__MINIO=https://minio.internal
```

A forma com conta cobre as variáveis que descrevem o *fornecedor*:
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`,
`S3_FORCE_PATH_STYLE`, `GCS_PROJECT_ID` e `GCS_KEY_FILENAME`. O nome do bucket
não é uma delas e nunca recai sobre a conta — se recaísse, dois buckets numa
mesma conta tornar-se-iam silenciosamente um só.

Um valor por bucket continua a ganhar, por isso uma fonte pode ser movida para
outro fornecedor sem separar as restantes da sua conta partilhada. Não existe
deliberadamente qualquer recurso à variável sem sufixo: essa pertence à fonte
padrão, e deixar um bucket nomeado herdá-la significaria que uma chave mal
escrita assina com as credenciais de outra fonte.

## Tópicos e filas

Um tópico é entregue através da fila de trabalhos durável: publicar escreve **uma linha por assinatura**, de modo que cada assinante repete conforme o seu próprio calendário e um deles quebrado não bloqueia os outros nem os faz executar de novo.

```ts
await signups.publish({ userId });
```

Uma fila é a outra forma de trabalho em segundo plano: uma lista de trabalhos com **um único handler**, em que quem chama fica com o id do job. As filas são novas
<span class="since-badge" data-since="0.18">Since 0.18</span> — os tópicos chegaram na 0.17.

```ts
export const thumbnails = queue<{ key: string }>("thumbnails");
thumbnails.handler(async ({ key }, { attempt }) => { /* … */ });

const { id } = await thumbnails.enqueue({ key }, { runAt: new Date(Date.now() + 60_000) });
```

Ambos são **at-least-once**. Um worker que morre segurando um job o libera e o próximo começa o handler do início, então um handler precisa tolerar ver um evento duas vezes. Publicar ou enfileirar dentro de uma transação que sofre rollback nunca aconteceu: é a inserção de uma linha.

Declarar qualquer um dos dois liga a fila de trabalhos por si só, em todos os caminhos de inicialização — um projeto no runtime gerenciado, que não tem um entrypoint por onde passar `jobs.tasks`, recebe os seus handlers por essa via. Publicar num tópico que ninguém declara, ou enfileirar numa fila sem handler, lança um erro em vez de escrever linhas que nenhum worker atende.

## Crons e funções

Ambos são arquivos — `backend/crons/<name>.ts`, `backend/functions/<name>.ts` — e ambos entram no grafo sob o nome do arquivo, que é também o id com que o agendador executa um cron e o caminho em que uma função é montada. Nenhum dos dois se vincula a partir do ambiente; eles estão no grafo para que um host conheça os agendamentos de um projeto antes de executar qualquer coisa.

```ts
export default defineCron({
    name: "Nightly cleanup",
    schedule: "0 3 * * *",
    timezone: "Europe/Madrid",
    async handler({ rebase }) { /* … */ }
});
```

Sem `timezone` o agendamento é lido no fuso do próprio host — UTC em quase todo container, o seu num laptop — de modo que `0 3 * * *` significa uma hora diferente de um lado e do outro de um deploy. Um fuso desconhecido é recusado quando o job carrega.

## Comportamento em caso de falha

Uma fonte de dados declarada com transporte de servidor sem uma string de conexão **faz a inicialização falhar**, indicando o nome da variável a ser definida. Isso é deliberado e vale a pena entender: a alternativa é que as coleções roteadas para a fonte ausente recorram silenciosamente ao banco de dados padrão. Isso significa dados indo parar no lugar errado por trás de um servidor que se declara saudável — muito pior do que um container que se recusa a iniciar.

Duas chaves que derivariam o mesmo nome de variável também são rejeitadas, porque uma delas leria silenciosamente a configuração da outra.

Fontes declaradas com `transport: "direct"` são ignoradas por completo: o cliente conversa diretamente com elas, então o backend não mantém nenhuma conexão e não exige nenhuma configuração para elas.

## Controle de acesso ao armazenamento

As chaves de armazenamento compartilham um único namespace plano e não estão sob segurança em nível de linha, portanto, sem um modelo explícito de controle de acesso, o padrão seria "qualquer usuário autenticado pode ler, sobrescrever, excluir ou listar qualquer objeto". A produção se recusa a iniciar em vez de assumir isso.

A maneira de dizer o que acesso significa para o seu projeto é um export `storageAuthorize` do pacote de configuração — uma função, porque nenhuma variável de ambiente consegue expressar "este usuário pode ler esta chave":

```ts
// config/index.ts
import type { StorageAuthorize } from "@rebasepro/types";

export const storageAuthorize: StorageAuthorize = async ({ key, user, operation }) => {
    if (!user) return false;
    const [ownerId] = key.split("/");
    return ownerId === user.uid || operation === "read";
};
```

Existem duas saídas por variável de ambiente para os casos em que esse realmente é o modelo:

- `STORAGE_PUBLIC_READ=true` — o bucket é uma CDN pública, somente leitura. Escritas, exclusões e listagens ainda exigem autenticação.
- `STORAGE_ALLOW_ANY_AUTHENTICATED=true` — todo usuário autenticado é confiável com todos os arquivos. Defensável para uma aplicação single-tenant, nunca para uma multi-tenant.

## Armazenamento em produção

Sem nenhum bucket configurado, o armazenamento fica **desligado** em produção e os uploads respondem `501`. O disco local é o sistema de arquivos do container, então os arquivos escritos ali desaparecem no próximo reinício — um upload que falha ruidosamente pode ser repetido, um que teve sucesso num disco prestes a ser apagado não. Defina `FORCE_LOCAL_STORAGE=true` apenas quando um volume durável estiver realmente montado.

Uma consequência importante de saber se você declarar buckets explicitamente: nenhum bucket padrão é inventado para você. Declarar apenas `bucket("media")` significa que não existe bucket padrão, e uma propriedade que não nomeia um não tem para onde ir — deliberadamente, e identicamente em desenvolvimento e produção. Adicione também `bucket()` se quiser um.

Em desenvolvimento, um bucket declarado que nada vincula é um diretório local — `uploads__media` ao lado do `uploads` padrão — qualquer que seja o motor que ele declare, então `bucket("media", { engine: "s3" })` mais `rebase dev` já basta para enviar um arquivo. A inicialização diz por qual motor o diretório está substituindo, e `rebase status` o mostra em amarelo ao lado do visto. Isso nunca acontece em produção, nem no runtime gerenciado: um bucket inventado ali escreveria os uploads num sistema de arquivos de container que desaparece no próximo rollout, então um bucket não vinculado continua não vinculado e responde 501.

## Relacionado

- [Visão geral do backend](/docs/backend/) — `dataSources` e onde vive a declaração
- [Configuração do armazenamento](/docs/backend/storage/) — a mesma forma para os buckets
- [Ambiente e configuração](/docs/getting-started/configuration/) — a convenção `__SUFFIX` que vincula uma fonte às suas variáveis

---
