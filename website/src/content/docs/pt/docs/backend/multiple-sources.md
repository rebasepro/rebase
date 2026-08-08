---
title: Múltiplos Bancos de Dados e Buckets
sidebar_label: Múltiplas Fontes
description: Especifique rotas de coleções para diferentes bancos de dados e propriedades para diferentes buckets de armazenamento, e configure cada um a partir do ambiente.
---

## Visão geral

Um projeto não está limitado a apenas um banco de dados e um bucket. As coleções já realizam o roteamento por `dataSource`, e as propriedades de arquivos realizam o roteamento por `storageSource`; esta página é sobre como cada fonte nomeada obtém sua configuração.

Dois passos: **declare** as fontes no seu pacote de configuração e, em seguida, **configure** cada uma delas com variáveis de ambiente derivadas de sua chave.

## Declarando fontes

Exporte `dataSources` e `storageSources` a partir do `index.ts` do seu pacote de configuração. Eles são compartilhados com o frontend, que usa as mesmas declarações para decidir se se comunica com uma fonte por meio da API do Rebase ou diretamente.

```ts
// config/index.ts
import type { DataSourceDefinition, StorageSourceDefinition } from "@rebasepro/types";

export const dataSources: DataSourceDefinition[] = [
    { key: "(default)", engine: "postgres" },
    { key: "analytics", engine: "postgres", label: "Analytics warehouse" }
];

export const storageSources: StorageSourceDefinition[] = [
    { key: "(default)", engine: "local", transport: "server" },
    { key: "media", engine: "s3", transport: "server", label: "Public media" }
];
```

Em seguida, aponte uma coleção para uma delas:

```ts
import { defineCollection } from "@rebasepro/admin-types";
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
