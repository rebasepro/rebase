---
title: Apps e Repositórios
sidebar_label: Apps e Repositórios
description: Um projeto é um backend mais os apps que se comunicam com ele, os quais podem viver em seu próprio repositório.
---

## Projetos e apps

Um **projeto** é o backend: o banco de dados, auth, storage, realtime e
functions. Um **app** é algo que se comunica com ele.

| Tipo | O que é |
| --- | --- |
| `backend` | As coleções, hooks e funções que definem a API. Exatamente um por projeto. |
| `static` | Um bundle de cliente construído — uma SPA ou site estático, servido em seu próprio caminho. |

Essa é a lista completa. O painel de administração é um app `static` como qualquer outro: ele
é construído no seu repositório, contra as suas coleções, e é por isso que campos
personalizados e visualizações personalizadas funcionam nele desde o primeiro dia.

Quem possui o processo do servidor é uma propriedade do backend, não um tipo de app
separado:

| `runtime` | O que significa |
| --- | --- |
| `managed` | A imagem de runtime da plataforma executa o seu bundle. Você fornece coleções, funções, crons e schema. |
| `custom` | Você fornece o servidor: seu próprio Dockerfile e entrypoint. O `rebase eject` configura isso. |

Isso é independente de *onde* ele roda. Ambos rodam no Rebase Cloud e ambos
são auto-hospedados (self-host) — o destino fica em `.rebase/cloud.json`, não no manifesto.

A parte importante é quem *possui* a lista. Um repositório declara apenas os apps
que contém; o projeto possui o conjunto de apps existentes. Dois repositórios nunca
precisam saber um do outro — eles só precisam conhecer o projeto. É isso que
torna um repositório de frontend separado, ou um aplicativo móvel sem nenhuma relação
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
      "path": "/admin"
    }
  }
}
```

Um único processo serve tudo: a API em `/api`, o site em `/`, o admin em
`/admin`. Essa é a história da auto-hospedagem, e um plano pequeno perfeitamente
adequado no Rebase Cloud.

`path` é uma entrada de **tempo de compilação** (build-time), bem como de serviço. Um app montado
em `/admin` precisa ser *construído* para `/admin`, caso contrário o `index.html` carrega e
todos os assets retornam 404 — uma página em branco sem nenhum erro em lugar nenhum. O `rebase build` passa o valor como
`REBASE_APP_BASE`, que seu bundler lê como seu caminho base:

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

e se recusa a entregar uma build que o ignorou.

Um projeto existente não precisa de um. A CLI infere a mesma estrutura a partir da
estrutura de diretórios, e o `rebase apps init` a registra quando você deseja
torná-la explícita:

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

## Construindo e fazendo deploy de apps

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

O backend é construído primeiro, porque a build de um app cliente pode consumir um SDK
gerado a partir de suas coleções.

## Múltiplos repositórios

O monorepo continua sendo o padrão: um repositório com um backend e um painel de administração
é a coisa mais simples que funciona, e o `rebase init` cria sua estrutura base. Dividir
é um passo de evolução, não um requisito.

Em um repositório de frontend separado, você precisa de duas coisas — um manifesto declarando
o que este repositório contribui e um link para o projeto:

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

O link é gravado em `.rebase/cloud.json` e **não é commitado** — ele é por
checkout, como um remote do git. O manifesto é commitado; o link não.

## Clientes tipados sem as coleções

Este é o mecanismo que faz o multi-repo funcionar. Um repositório que não contém
coleções gera seu SDK tipado a partir do próprio projeto:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

A CLI busca `/api/meta/contract`, reconstrói as definições de coleção —
incluindo alvos de relação, dos quais o gerador de tipos precisa para decidir se
uma chave estrangeira é uma string ou um número — e emite exatamente a mesma saída
que teria produzido a partir da fonte local.

O endpoint do contrato é restrito para administradores (admin-only). As definições de coleção descrevem cada tabela,
coluna e relação no projeto, incluindo aquelas que nenhuma regra de segurança jamais
exporia; isso é um mapa do banco de dados, não uma documentação pública de API.

## Detectando divergências

Dividir repositórios custa uma coisa que vale a pena mencionar: uma alteração de schema e o
frontend que a utiliza deixam de ser enviados no mesmo commit. O backend pode implantar uma
alteração que deixe desamparado um cliente construído com base na estrutura antiga.

Cada SDK gerado registra o schema de onde veio:

```ts
// src/rebase/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

E cada projeto publica a sua versão atual, sem autenticação, porque um registro
de versão não revela nada sobre o schema que ele representa:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a"}
```

Comparar os dois na CI transforma uma incompatibilidade silenciosa em uma verificação com falha. O registro
muda quando os tipos gerados podem mudar — uma nova propriedade, uma relação alterada —
e deliberadamente *não* quando um hook, uma regra de segurança ou um ícone
muda, para não dar alarme falso.

## Configuração do cliente

```bash
rebase apps config web
```

Exibe o que um cliente precisa para alcançar o projeto. Ele nunca exibe um segredo: a
URL da API e a identidade publicável de um app devem ser enviadas dentro de um
bundle de cliente, e qualquer coisa que não seja segura ali não pertence a uma saída
que terminará em um `.env` commitado.

---
