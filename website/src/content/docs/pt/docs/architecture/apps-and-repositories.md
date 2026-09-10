---
sourceHash: f90b94eda083f704
title: Apps e Repositórios
sidebar_label: Apps & Repositórios
description: Um projeto é um backend mais os apps que se comunicam com ele, os quais podem viver cada um em seu próprio repositório.
---

## Projetos e apps

Um **projeto** é o backend: o banco de dados, auth, storage, realtime e
funções. Um **app** é algo que se comunica com ele.

| Tipo | O que é |
| --- | --- |
| `backend` | As collections, hooks e funções que definem a API. Exatamente um por projeto. |
| `static` | Um bundle de cliente compilado — uma SPA ou site estático, servido em seu próprio caminho. |

Essa é a lista completa. O painel de administração é um app `static` como qualquer outro: ele é
compilado no seu repositório, com base nas suas collections, e é por isso que campos personalizados
e visualizações personalizadas funcionam nele desde o primeiro dia.

Quem detém o processo do servidor é uma propriedade do backend, não um tipo de app
separado:

| `runtime` | O que significa |
| --- | --- |
| `managed` | A imagem de runtime da plataforma executa o seu bundle. Você fornece collections, funções, crons e schema. |
| `custom` | Você fornece o servidor: seu próprio Dockerfile e entrypoint. O `rebase eject` configura isso. |

Isso independe de *onde* ele é executado. Ambos rodam no Rebase Cloud e ambos permitem
auto-hospedagem (self-host) — o destino fica em `.rebase/cloud.json`, não no manifesto.

A parte importante é o que *gerencia* a lista. Um repositório declara apenas os apps
que contém; o projeto é o dono do conjunto de apps existentes. Dois repositórios nunca
precisam saber um do outro — eles só precisam conhecer o projeto. É isso que
torna um repositório de frontend separado, ou um app mobile sem nenhuma relação
de repositório, algo comum em vez de um caso especial.

## `rebase.json`

O manifesto declara a topologia, e nada mais. Schema, regras de segurança, hooks
e funções permanecem no TypeScript, onde um sistema de tipos pode verificá-los.

```jsonc
{
  "rebase": "^1",
  "apps": {
    "backend": { "type": "backend", "runtime": "managed" },
    "site": {
      "type": "static",
      "root": "frontend",
      "build": "npm run build --workspace frontend",
      "output": "frontend/dist",
      "path": "/"
    },
    "admin": {
      "type": "static",
      "root": "admin",
      "build": "npm run build --workspace admin",
      "output": "admin/dist",
      "path": "/admin",
      "cms": "/admin"
    }
  }
}
```

Um único processo serve tudo: a API em `/api`, o site em `/`, a administração em
`/admin`. Esse é o modelo de auto-hospedagem (self-hosting), e uma excelente camada inicial
no Rebase Cloud.

## Informando onde está o CMS

`cms` é o caminho da URL onde um app monta o `<RebaseCMS>`. Ele é opcional, é o
único campo aqui que descreve o que está *dentro* de um app em vez de onde o
app se localiza, e existe porque nada mais conseguiria descobrir isso.

O CMS é um componente React no seu próprio frontend, portanto seu endereço é uma
rota do lado do cliente (client-side route). Não é uma rota de servidor, não é um arquivo no build e não é
distinguível de qualquer outro caminho não correspondido em uma SPA — uma requisição para
`/admin` recebe o mesmo `index.html` que uma requisição para `/anything-else`. Portanto, nenhum
deploy, nenhum servidor em execução e nenhuma quantidade de varredura pode dizer onde seu painel
de administração está. Se você não registrar isso, nada saberá.

O que sabe disso, faz algo a respeito:

- O **Rebase Cloud** adiciona um link *Open CMS* no cabeçalho do projeto e lista o
  endereço na visão geral do projeto. Sem o `cms`, o console só consegue oferecer
  o host do projeto — que só alcança o CMS se ele estiver na
  raiz dele.
- O **`rebase dev`** exibe a URL do CMS no seu banner de inicialização quando ela não for
  simplesmente a página inicial do frontend.
- O **`rebase apps list`** o exibe ao lado do app que o serve.

Dois formatos, e ambos são comuns:

```jsonc
// The whole app is the CMS — what `rebase init` scaffolds.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// The CMS is one route of a bigger app, sharing its session and its client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }
```

O valor é o endereço que você digitaria, não um caminho relativo a `path`, e
deve estar dentro do app que o declara — o fallback de SPA desse app é o que
responde ali. Um projeto tem um CMS; declarar um segundo é um erro, em vez de
um cara ou coroa sobre para qual deles o console apontará o link.

`path` é uma entrada tanto de **tempo de compilação (build-time)** quanto de serviço. Um app montado em
`/admin` precisa ser *compilado* para `/admin`, caso contrário o `index.html` carrega e todos os assets
retornam 404 — uma página em branco sem nenhum erro em lugar nenhum. O `rebase build` passa o valor como
`REBASE_APP_BASE`, que o seu bundler lê como seu caminho base:

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

e se recusa a enviar uma compilação que o tenha ignorado.

Um projeto existente não precisa disso. A CLI deduz a mesma estrutura a partir da
estrutura de diretórios, e o `rebase apps init` o registra quando você desejar
torná-lo explícito:

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

## Compilando e fazendo deploy de apps

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

O backend é compilado primeiro, pois a compilação de um app cliente pode consumir um SDK
gerado a partir de suas collections.

## Múltiplos repositórios

O monorepo continua sendo o padrão: um repositório com um backend e um painel de administração
é a opção mais simples que funciona, e o `rebase init` cria essa estrutura inicial. A separação é
um passo de evolução, não um requisito.

Em um repositório de frontend separado, você precisa de duas coisas — um manifesto declarando
com o que este repositório contribui e um link para o projeto:

```jsonc
// rebase.json
{
  "rebase": "^1",
  "apps": {
    "marketing": {
      "type": "static",
      "root": ".",
      "build": "npm run build",
      "output": "dist"
    }
  }
}
```

```bash
rebase cloud link https://api.example.com   # a self-hosted project
rebase cloud link                           # or pick a Rebase Cloud project
```

O link é gravado em `.rebase/cloud.json` e **não é commitado** — ele é
por checkout, como um git remote. O manifesto é commitado; o link não.

## Clientes tipados sem as collections

Este é o mecanismo que faz o multi-repo funcionar. Um repositório que não
contém collections gera seu SDK tipado a partir do próprio projeto:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

A CLI busca `/api/meta/contract`, reconstrói as definições de collections —
incluindo alvos de relacionamentos, que o gerador de tipos precisa para decidir se uma
chave estrangeira é uma string ou um número — e emite exatamente a mesma saída que
produziria a partir do código-fonte local.

O endpoint de contrato é exclusivo para administradores. As definições de collections descrevem cada tabela,
coluna e relação no projeto, incluindo aquelas que nenhuma regra de segurança jamais
exporia; trata-se de um mapa do banco de dados, não de uma documentação pública da API.

## Detectando drift

Dividir repositórios custa uma coisa que vale a pena mencionar: uma alteração de schema e o
frontend que a utiliza não entram mais no mesmo commit. O backend pode implantar uma
alteração que deixe desamparado um cliente compilado com o formato antigo.

Cada SDK gerado registra o schema do qual se originou:

```ts
// src/rebase/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

E cada projeto publica a sua versão atual, sem autenticação, porque um
identificador de versão não revela nada sobre o schema que ele representa:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a"}
```

Comparar os dois no CI transforma uma incompatibilidade silenciosa em uma verificação com falha. O
identificador muda quando os tipos gerados podem mudar — uma nova propriedade, uma relação
alterada — e deliberadamente *não* quando um hook, uma regra de segurança ou um ícone
muda, evitando alarmes falsos.

## Configuração do cliente

```bash
rebase apps config web
```

Exibe o que um cliente precisa para alcançar o projeto. Ele nunca exibe um segredo: a
URL da API e a identidade publicável de um app foram feitas para serem distribuídas dentro de um
bundle de cliente, e qualquer coisa que não seja segura ali não deve constar em uma saída
que terminará em um `.env` commitado.

## Relacionado

- [Runtime e Bundles](/docs/architecture/runtime-and-bundles/) — o que o `rebase build` produz e o que o inicializa
- [Processos Divididos](/docs/deployment/split-processes/) — executando um único bundle como vários processos
- [Comandos da CLI](/docs/cli/) — `rebase apps` e o restante

---
