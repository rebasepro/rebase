---
title: Múltiplos Bancos de Dados e Buckets
sidebar_label: Múltiplas Fontes
description: Especifique rotas de coleções para diferentes bancos de dados e propriedades para diferentes buckets de armazenamento, e configure cada um a partir do ambiente.
---

## Visão geral

Um projeto não está limitado a apenas um banco de dados e um bucket. As coleções já realizam o roteamento por `dataSource`, e as propriedades de arquivos realizam o roteamento por `storageSource`; esta página é sobre como cada fonte nomeada obtém sua configuração.

Dois passos: **declare** as fontes no seu pacote de configuração e, em seguida, **configure** cada uma delas com variáveis de ambiente derivadas de sua chave.

## Declarar os recursos

Tudo o que um projeto precisa e tem um nome — uma base de dados, um bucket, um
tópico — é **declarado com um construtor** em `config/resources.ts`. Uma única
regra, seja qual for o tipo: não há um segundo sítio onde procurar.

```ts
// config/resources.ts
import { bucket, database, topic } from "@rebasepro/types";

/** A base de dados do projeto. Lê DATABASE_URL, como sempre leu. */
export const main = database();

/** Uma segunda. Lê DATABASE_URL__ANALYTICS. */
export const analytics = database("analytics", { label: "Analytics warehouse" });

/** Um bucket. Lê S3_BUCKET__MEDIA. */
export const media = bucket("media", { engine: "s3", label: "Public media" });

/** Um tópico, entregue através da fila de trabalhos durável. */
export const signups = topic<{ userId: string }>("signups");
```

`rebase resources` lista o que um projeto declara, `--write` regenera
`rebase.resources.json` e `--check` falha se esse ficheiro estiver
desatualizado. Esse ficheiro é **gerado** e deve ser versionado: é o que um host
lê para decidir o que aprovisionar *antes* de executar seja o que for.

Um motor desconhecido é recusado no local da chamada, e não mais tarde. Para um
que esta build não conhece, usa-se `custom:` — por exemplo
`bucket("objects", { engine: "custom:minio" })`.

Em seguida, aponte uma coleção para uma delas:

```ts
import { defineCollection } from "@rebasepro/cms-types";
const pageViewsCollection = defineCollection({
    name: "Page Views",
    slug: "page_views",
    table: "page_views",
    dataSource: "analytics",
    properties: { /* … */ }
});
```

...ou uma propriedade de arquivo:

```ts
coverImage: {
    name: "Cover image",
    type: "string",
    storage: { storageSource: "media", acceptedFiles: ["image/*"] }
}
```

## Configurando cada fonte

Os nomes das variáveis de ambiente são derivados da chave da fonte, portanto não há nada para manter sincronizado manualmente:

```
<VARIABLE>              the default source     DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named source         DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
```

A chave é convertida para maiúsculas e caracteres não alfanuméricos tornam-se sublinhados, portanto `media-cdn` lê `S3_BUCKET__MEDIA_CDN`.

O separador é intencionalmente um sublinhado **duplo**. Um sublinhado único colidiria com nomes reais de variáveis — `S3_BUCKET_NAME` seria interpretado como o bucket para uma fonte chamada `name`.

### Bancos de dados

```bash
DATABASE_URL=postgres://localhost/app
DATABASE_URL__ANALYTICS=postgres://warehouse.internal/analytics

# Optional, per source:
DB_POOL_MAX__ANALYTICS=5
ADMIN_CONNECTION_STRING__ANALYTICS=postgres://…
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

O driver é escolhido a partir do `engine` declarado (`postgres` e `mongodb` são conhecidos), e `REBASE_DRIVER__<KEY>` o sobrescreve para qualquer outra coisa.

### Armazenamento

```bash
STORAGE_TYPE__MEDIA=s3
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

`STORAGE_TYPE__<KEY>` pode ser omitido quando a declaração já nomeia o engine.

### Vários buckets em uma só conta

Cada variável é lida por chave: isso é correto para o *nome* do bucket e errado
para as credenciais — quinze buckets na mesma instalação MinIO significariam
quinze cópias da mesma access key. Nomeie uma `account` e as variáveis de nível
de provedor são lidas uma única vez:

```ts
export const media   = bucket("media",   { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```
S3_BUCKET__MEDIA=project-media       # por bucket, nunca compartilhado
S3_BUCKET__AVATARS=project-avatars
S3_ACCESS_KEY_ID__MINIO=…            # lida uma vez, pelos dois
S3_SECRET_ACCESS_KEY__MINIO=…
S3_ENDPOINT__MINIO=https://minio.internal
```

A forma com conta cobre as variáveis que descrevem o *provedor*:
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`,
`S3_FORCE_PATH_STYLE`, `GCS_PROJECT_ID` e `GCS_KEY_FILENAME`. O nome do bucket
não é uma delas e nunca recorre à conta — se recorresse, dois buckets na mesma
conta se tornariam silenciosamente um só.

Um valor por bucket ainda prevalece, então uma fonte pode ser movida para outro
provedor sem desligar as demais da conta compartilhada. Deliberadamente não há
recurso à variável sem sufixo: ela pertence à fonte padrão, e deixar um bucket
nomeado herdá-la significaria que uma chave digitada errado assina com as
credenciais de outra fonte.

## Comportamento em caso de falha

Uma fonte de dados com transporte de servidor declarada sem uma string de conexão **falha a inicialização**, nomeando a variável que precisa ser definida. Isso é deliberado e importante de entender: a alternativa seria que as coleções roteadas para a fonte ausente silenciosamente usassem o banco de dados padrão como fallback. Isso significaria dados indo para o lugar errado por trás de um servidor que se reporta como saudável — muito pior do que um contêiner que se recusa a iniciar.

Duas chaves que gerariam o mesmo nome de variável também são rejeitadas, pois uma delas leria silenciosamente a configuração da outra.

Fontes declaradas com `transport: "direct"` são totalmente ignoradas: o próprio cliente se comunica com elas, portanto o backend não mantém conexão e não exige nenhuma configuração para elas.

## Controle de acesso ao armazenamento

As chaves de armazenamento compartilham um único namespace simples e não estão sob segurança a nível de linha (row-level security), portanto, sem um modelo explícito de controle de acesso, o padrão seria "qualquer usuário autenticado pode ler, sobrescrever, excluir ou listar qualquer objeto". O ambiente de produção se recusa a inicializar em vez de presumir isso.

A maneira de definir o que o acesso significa para o seu projeto é exportar `storageAuthorize` a partir do pacote de configuração — uma função, pois nenhuma variável de ambiente consegue expressar "este usuário pode ler esta chave":

```ts
// config/index.ts
import type { StorageAuthorize } from "@rebasepro/types";

export const storageAuthorize: StorageAuthorize = async ({ key, user, operation }) => {
    if (!user) return false;
    const [ownerId] = key.split("/");
    return ownerId === user.uid || operation === "read";
};
```

Existem duas alternativas via ambiente para os casos em que esse é realmente o modelo desejado:

- `STORAGE_PUBLIC_READ=true` — o bucket é uma CDN pública e somente de leitura. Escritas, exclusões e listagem ainda exigem autenticação.
- `STORAGE_ALLOW_ANY_AUTHENTICATED=true` — qualquer usuário autenticado tem acesso a qualquer arquivo. Defensável para um aplicativo single-tenant, nunca para um multi-tenant.

## Armazenamento em produção

Sem nenhum bucket configurado, o armazenamento fica **desativado** em produção e os uploads retornam `501`. O disco local é o sistema de arquivos do contêiner, portanto, arquivos gravados lá desaparecem na próxima reinicialização — um upload que falha explicitamente pode ser tentado novamente, mas um que teve sucesso em um disco prestes a ser apagado, não. Defina `FORCE_LOCAL_STORAGE=true` apenas quando um volume durável estiver realmente montado.

Uma consequência importante de saber se você declarar fontes de armazenamento explicitamente: nenhum bucket padrão é criado automaticamente para você. Declarar apenas uma fonte `media` significa que não existe uma fonte `(default)`, e uma propriedade que não nomeia uma fonte não tem para onde ir — deliberadamente, e identicamente em desenvolvimento e produção. Declare `(default)` também se quiser uma.

---
