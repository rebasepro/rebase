---
sourceHash: 6005371e69144db0
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
| `static` | Um bundle de cliente compilado — uma SPA ou site estático, servido em seu próprio caminho, ou em um hostname só seu. |

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
  endereço na visão geral do projeto — no hostname do próprio app, quando ele tem
  um. Sem o `cms`, o console só consegue oferecer
  o host do projeto — que só alcança o CMS se ele estiver na
  raiz dele.
- O **`rebase dev`** exibe a URL do CMS no seu banner de inicialização quando ela não for
  simplesmente a página inicial do frontend.
- O **`rebase apps list`** o exibe ao lado do app que o serve.

Três formatos, e todos são comuns. para o terceiro: na 0.23 o
`path` de um app não pode ser uma URL, então o CMS compartilha o hostname do projeto.

```jsonc
// The whole app is the CMS — what `rebase init` scaffolds.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// The CMS is one route of a bigger app, sharing its session and its client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }

// The CMS is an app of its own, on a hostname of its own — see the next section.
"admin": { "type": "static", "root": "admin", "output": "admin/dist", "path": "https://admin.example.com", "cms": "/" }
```

O valor é o caminho que você digitaria depois do hostname, não um caminho
relativo a `path`, e deve estar dentro do app que o declara — o fallback de SPA
desse app é o que responde ali. É sempre um caminho, mesmo quando o `path` do
app é uma URL: o CMS fica então nesse caminho, no hostname do app, então
`"cms": "/"` acima significa `https://admin.example.com/`. Um projeto tem um
CMS; declarar um segundo é um erro, em vez de
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

## Um app em um hostname só seu

`path` também pode ser uma URL `https://` completa, o que dá ao app um hostname
só seu:

```jsonc
{
  "rebase": "^1",
  "apps": {
    "backend": { "type": "backend", "runtime": "managed" },
    "web": {
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
      "path": "https://admin.example.com",
      "cms": "/"
    }
  }
}
```

`https://admin.example.com` serve o `admin`. Todos os outros hostnames em que o
projeto responde — `example.com`, ou o endereço do próprio projeto no Rebase
Cloud — servem o `web`, e ali o `admin` não é alcançável de forma alguma.
Continua sendo um único processo e um único deploy; o hostname só decide qual
app responde a uma requisição.

Duas regras decidem isso:

- Um app com hostname responde apenas nesse hostname. Um app sem hostname
  responde em todos.
- Dos apps que sobram, vence o de caminho mais longo, como sempre. Com caminhos
  iguais, o app que nomeia o hostname vence o que não nomeia.

No exemplo, os dois apps estão em `/`, então em `admin.example.com` a segunda
regra escolhe o `admin`. Declare o admin em `"https://admin.example.com/cms"` e
ele responde apenas sob `/cms` nesse hostname: `admin.example.com/pricing` vai
para o `web`. Um hostname restringe onde um app responde; ele não entrega ao
app tudo o que existe nesse hostname. Dois apps não podem compartilhar ao mesmo
tempo um hostname e um caminho.

O backend não é um app, e um hostname não o move. `/api`, `/health` e os outros
caminhos que o backend reserva são respondidos antes de qualquer app ser
consultado, em todos os hostnames, então `https://admin.example.com/api` é a
mesma API que `https://example.com/api`. Um app que chama a própria origem — o
`VITE_API_URL` vazio do scaffold — não precisa de uma URL de API própria nem de
nenhuma configuração de CORS. Pelo mesmo motivo, esses caminhos são recusados
depois de um hostname assim como são sozinhos: `https://admin.example.com/api`
não é mais válido do que `/api`.

Todo o resto sobre `path` se aplica à parte depois do hostname. O app continua
sendo compilado para ela: `https://admin.example.com` é compilado com
`REBASE_APP_BASE` definido como `/`, `https://admin.example.com/cms` com `/cms`,
e um bundler que o ignora continua gerando uma página em branco. `cms` é um
caminho no hostname do app, dentro dessa parte do caminho. A URL precisa ser
`https://` e conter um hostname e um caminho e nada mais — sem porta, query ou
fragmento. Um `admin.example.com` sozinho é recusado, com a URL que deveria ter
sido escrita.

No `rebase dev`, nada é roteado por hostname. Ele executa o app em
`frontend/` na raiz de uma porta do localhost, como sempre fez, e para um app
com hostname o banner dele também exibe o endereço `https://` que o app terá
depois do deploy.

O `rebase start` é diferente, porque executa o bundle compilado através do mesmo
runtime que um deploy usa — roteamento por hostname incluído. Um app com hostname
responde apenas a requisições cujo `Host` seja aquele hostname, então
`http://localhost:3001/` mostra o app sem um, e um bundle cujo único app
nomeia um hostname responde 404 ali. Para alcançá-lo localmente, envie o header
você mesmo:

```bash
curl -H "Host: admin.example.com" http://localhost:3001/
```

ou aponte o hostname para `127.0.0.1` no `/etc/hosts` e abra
`http://admin.example.com:3001/`. Deliberadamente não há nenhum parâmetro de query ou
header que sobrescreva o roteamento: um que funcionasse localmente também funcionaria
contra um deploy, e escolher o app por qualquer coisa que não seja o `Host` real é
exatamente o que o roteamento existe para impedir.

Em auto-hospedagem, o processo faz a mesma escolha a partir do header `Host` de
cada requisição. Apontar o hostname para o servidor e dar a ele um certificado
fica por sua conta, como acontece com o hostname principal do projeto, e um
reverse proxy na frente precisa repassar o `Host` original — o Caddy faz isso
por padrão, o nginx precisa de `proxy_set_header Host $host;`. O
`X-Forwarded-Host` não é lido, porque qualquer cliente pode enviar um.

### No Rebase Cloud

O `rebase cloud deploy` registra o hostname no projeto — o que o
`rebase cloud domains add` faz — então não há um passo separado para esquecer.
O que acontece em seguida depende do DNS:

- **Os registros já existem.** O deploy verifica o hostname, e ele fica no ar
  quando o deploy termina.
- **Eles não existem.** O deploy segue em frente e exibe os dois registros a
  criar: um registro TXT que prova que o nome é seu e um CNAME que o aponta para
  o projeto (um registro A, se o hostname for o apex do domínio).

Depois de publicar os registros:

```bash
rebase cloud domains verify admin.example.com
```

O `rebase cloud domains list` exibe os registros de novo se você os perder.
Quando a verificação passa, a plataforma emite o certificado HTTPS para o
hostname; não há nada para enviar. Até lá, o `admin` não responde em lugar
nenhum, porque o único hostname em que ele responde ainda não chega ao projeto —
o resto do projeto fica no ar de qualquer forma.

O console acompanha o app até o hostname dele: o link *Open CMS* e o endereço
do CMS na visão geral do projeto são `https://admin.example.com/`, e não o host
do projeto.

Um hostname que outro projeto já detém faz o deploy falhar antes de qualquer
rollout, assim como um hostname sob o domínio da própria plataforma. Tirar o app
do `rebase.json` deixa o hostname registrado no projeto; remova-o com
`rebase cloud domains remove admin.example.com`.

### Um hostname pertence a um app, não a uma rota

Um hostname é dado a um app inteiro. Ele não pode apontar para uma rota dentro
de um. Quando o CMS é uma rota de uma única SPA — `web` em `/` com
`"cms": "/admin"` — ele fica em `/admin`, em todos os hostnames em que o projeto
responde. Dar a esse app `https://admin.example.com` moveria a SPA inteira para
lá, com o CMS ainda em `/admin` dentro dela. Para dar ao CMS um hostname só seu,
transforme-o em um app próprio, com seu próprio build, como no exemplo acima.

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

O endpoint de contrato requer o escopo `schema:read`, que um administrador tem. As definições de collections descrevem cada tabela,
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
