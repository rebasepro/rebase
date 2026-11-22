---
sourceHash: e3293eb3c0e15be1
title: Apps e Repositórios
sidebar_label: Apps e Repositórios
description: Um projeto é um backend mais os apps que se comunicam com ele, os quais podem viver cada um em seu próprio repositório.
---

## Projetos e apps

Um **projeto** é o backend: o banco de dados, auth, storage, realtime e
funções. Um **app** é algo que se comunica com ele.

| Tipo | O que é |
| --- | --- |
| `backend` | As tabelas, hooks e funções que definem a API. Exatamente um por projeto. |
| `static` | Um bundle de cliente compilado — uma SPA ou site estático, servido em seu próprio caminho (path), ou em um hostname próprio. |

Essa é a lista completa. O painel de administração é um app `static` como qualquer
outro: ele é construído em seu repositório, com suas customizações em `frontend/src/cms`,
e é por isso que campos personalizados e visualizações personalizadas funcionam nele desde o primeiro dia.

Quem gerencia o processo do servidor é uma propriedade do backend, não um tipo de
app separado:

| `runtime` | O que significa |
| --- | --- |
| `managed` | A imagem de runtime da plataforma executa seu bundle. Você fornece tabelas, funções, crons e schema. |
| `custom` | Você fornece o servidor: seu próprio Dockerfile e entrypoint. O comando `rebase eject` configura isso. |

Isso independe de *onde* ele é executado. Ambos rodam no Rebase Cloud e ambos podem ser
auto-hospedados (self-host) — o destino fica em `.rebase/cloud.json`, não no manifesto.

A parte importante é quem *possui* a lista. Um repositório declara apenas os apps
que contém; o projeto é o dono do conjunto de apps existentes. Dois repositórios nunca
precisam saber um do outro — eles só precisam conhecer o projeto. É isso que
torna um repositório de frontend separado, ou um app mobile sem nenhuma relação
de repositório, algo comum em vez de um caso especial.

## `rebase.json`

O manifesto declara a topologia, e nada mais. Schema, regras de segurança, hooks
e funções permanecem em TypeScript, onde um sistema de tipos pode verificá-los.

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

Um único processo serve tudo isso: a API em `/api`, o site em `/`, o admin em
`/admin`. Esse é o modelo de auto-hospedagem (self-hosting), e um ótimo plano inicial no
Rebase Cloud.

O `path` de um app estático assume uma de duas formas:

| `path` | Onde o app responde |
| --- | --- |
| `"/"`, `"/admin"` | Naquele caminho, em todos os hostnames em que o projeto é servido. |
| `"https://www.example.com"`, `"https://admin.example.com/cms"` | Apenas naquele hostname, no caminho após ele. Veja [Um app em seu próprio hostname](#um-app-em-seu-próprio-hostname). |

O formato de URL é como um projeto com um site por domínio, como um projeto da
Vercel ou Netlify por domínio, se torna um projeto Rebase: um app estático por
hostname, todos servidos pelo mesmo deploy.

## Indicando onde o CMS está

`cms` é o caminho de URL onde um app monta o `<RebaseCMS>`. Ele é opcional, é o
único campo aqui que descreve o que está *dentro* de um app em vez de onde o
app reside, e existe porque nada mais consegue descobrir isso.

O CMS é um componente React no seu próprio frontend, portanto seu endereço é uma
rota client-side. Não é uma rota de servidor, não é um arquivo no build e não
se diferencia de nenhum outro caminho não correspondido em uma SPA — uma requisição para
`/admin` obtém o mesmo `index.html` que uma requisição para `/anything-else`. Assim, nenhum
deploy, nenhum servidor em execução e nenhuma varredura consegue dizer onde o seu
painel de administração está. Se você não declarar isso, nada saberá.

Quem sabe disso, faz algo a respeito:

- O **Rebase Cloud** coloca um link *Open CMS* no cabeçalho do projeto e lista o
  endereço na visão geral do projeto — no hostname do próprio app, quando ele tem
  um. Sem o `cms`, o console pode oferecer apenas o host do projeto — que só
  alcança o CMS se ele estiver localizado na raiz.
- O **`rebase dev`** imprime a URL do CMS em seu banner de inicialização quando ela não é
  simplesmente a página inicial do frontend.
- O **`rebase apps list`** mostra isso ao lado do app que o serve.

Três formatos, e todos eles são normais.

```jsonc
// The whole app is the CMS — what `rebase init` scaffolds.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// The CMS is one route of a bigger app, sharing its session and its client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }

// The CMS is an app of its own, on a hostname of its own — see the next section.
"admin": { "type": "static", "root": "admin", "output": "admin/dist", "path": "https://admin.example.com", "cms": "/" }
```

O valor é o caminho que você digitaria após o hostname, não um caminho relativo
ao `path`, e ele precisa estar dentro do app que o declara — o fallback de SPA
desse app é o que responde ali. É sempre um caminho, mesmo quando o `path` do app
for uma URL: o CMS estará então naquele caminho no hostname do app, portanto `"cms": "/"`
acima significa `https://admin.example.com/`. Um projeto tem um CMS; declarar um
segundo é um erro, em vez de um sorteio sobre para qual deles o console criará o link.

`path` é uma entrada de **tempo de build** (build-time), bem como de execução. Um app montado em
`/admin` precisa ser *compilado* para `/admin`, caso contrário o `index.html` carrega e todos os assets
retornam 404 — uma página em branco sem nenhum erro em lugar algum. O `rebase build` passa esse valor como
`REBASE_APP_BASE`, que o seu empacotador (bundler) lê como seu caminho base (base path):

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

e se recusa a entregar um build que o ignorou.

Um projeto existente não precisa de um. A CLI infere o mesmo layout a partir da
estrutura de diretórios, e `rebase apps init` o escreve quando você quiser torná-lo
explícito:

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

A inferência não tem como saber duas coisas que o `rebase.json` do scaffold declara. Ela nomeia
o app estático como `web`, enquanto o scaffold o nomeia como `admin`, e ela não consegue descobrir a rota
`cms` do app. O nome não muda: o Rebase Cloud registrou `web` para
cada projeto que fez deploy sem um `rebase.json`.
O `rebase apps init --force` mantém os nomes, `path`, `cms`, `routes`,
`frameAncestors`, <span class="since-badge" data-since="0.35">Desde 0.35</span> `redirects` e `cleanUrls` dos apps declarados no arquivo que ele substitui,
e marca como removido qualquer app que não encontre mais.

## Um app em seu próprio hostname

O `path` também pode ser uma URL `https://` completa, o que dá ao app um hostname
próprio:

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

`https://admin.example.com` serve `admin`. Todos os outros hostnames nos quais o projeto
responde — `example.com`, ou o próprio endereço do projeto no Rebase Cloud —
servem `web`, e `admin` não é acessível por lá de forma alguma. Ainda é um único
processo e um único deploy; o hostname apenas decide qual app responde a uma requisição.

Duas regras determinam isso:

- Um app com um hostname responde apenas naquele hostname. Um app sem hostname
  responde em todos os hostnames.
- Dos apps restantes, vence aquele com o caminho mais longo, como sempre foi. Em caso de
  caminhos iguais, o app que especifica o hostname vence o que não especifica.

No exemplo, ambos os apps estão em `/`, então em `admin.example.com` a segunda regra
escolhe `admin`. Declare o admin em `"https://admin.example.com/cms"` e
ele responderá apenas sob `/cms` naquele hostname: `admin.example.com/pricing`
vai para `web`. Um hostname restringe onde um app responde; ele não entrega tudo
naquele hostname para o app. Dois apps não podem compartilhar o mesmo hostname e caminho simultaneamente.

O backend não é um app, e um hostname não o move de lugar. `/api`, `/health`
e os outros caminhos que o backend reserva são respondidos antes de qualquer app ser
consultado, em todos os hostnames, portanto `https://admin.example.com/api` é a mesma
API que `https://example.com/api`. Um app que chama sua própria origem — o
`VITE_API_URL` vazio do scaffold — não precisa de uma URL de API própria nem de
configuração de CORS. Pelo mesmo motivo, esses caminhos são recusados após um hostname assim como
são sozinhos: `https://admin.example.com/api` não é mais válido do que
`/api`.

Tudo o mais sobre `path` se aplica à parte após o hostname. O app
ainda é compilado para ele: `https://admin.example.com` é compilado com
`REBASE_APP_BASE` definido como `/`, `https://admin.example.com/cms` com `/cms/`, e
um empacotador que ignorar isso ainda resultará em uma página em branco. `cms` é um caminho no
hostname do app, dentro dessa parte do caminho. A URL deve ser `https://` e conter um
hostname e um caminho, e nada mais — sem porta, query ou fragmento. Um simples
`admin.example.com` é recusado, informando a URL que deveria ter sido usada.

No `rebase dev`, nada é roteado por hostname. Ele executa o app em
`frontend/` na raiz de uma porta localhost, como sempre fez, e para um app
com hostname, seu banner também imprime o endereço `https://` que ele terá
quando for publicado.

O `rebase start` é diferente, porque executa o bundle compilado no mesmo
runtime de um deploy — incluindo o roteamento por hostname. Um app com hostname
responde apenas a requisições cujo cabeçalho `Host` seja esse hostname, portanto
`http://localhost:3001/` exibe o app sem hostname, e um bundle cujo único app
especifica um hostname responderá com 404 ali. Para acessá-lo localmente, envie o cabeçalho
manualmente:

```bash
curl -H "Host: admin.example.com" http://localhost:3001/
```

ou aponte o hostname para `127.0.0.1` no `/etc/hosts` e abra
`http://admin.example.com:3001/`. Não há deliberadamente nenhum parâmetro de query ou
cabeçalho para sobrescrever o roteamento: um que funcionasse localmente também funcionaria
em produção, e escolher o app por qualquer coisa diferente do `Host` real é
exatamente o que o roteamento foi feito para impedir.

Em auto-hospedagem (self-hosted), o processo faz a mesma escolha a partir do cabeçalho `Host`
de cada requisição. Apontar o hostname para o servidor e atribuir a ele um certificado são
de sua responsabilidade, assim como são para o hostname principal do projeto, e um proxy reverso
à frente precisa encaminhar o `Host` original — o Caddy faz isso por padrão,
o nginx precisa de `proxy_set_header Host $host;`. O cabeçalho `X-Forwarded-Host` não é lido,
porque qualquer cliente pode enviar um.

### No Rebase Cloud

O `rebase cloud deploy` registra o hostname no projeto — o que o
`rebase cloud domains add` faz —, portanto não há etapas separadas para esquecer. O que
acontece em seguida depende do DNS:

- **Os registros já existem.** O deploy verifica o hostname, e ele fica
  online assim que o deploy termina.
- **Eles não existem.** O deploy prossegue e imprime os dois registros a serem criados:
  um registro TXT que comprova que o nome é seu, e um CNAME que o aponta para o
  projeto (um registro A, se o hostname for o ápice/raiz do domínio).

Depois que os registros forem publicados:

```bash
rebase cloud domains verify admin.example.com
```

`rebase cloud domains list` imprime os registros novamente caso você os perca. Um
hostname que não for verificado em até 7 dias após o registro é liberado,
e o próximo deploy o registrará novamente. Quando
a verificação for aprovada, a plataforma emite o certificado HTTPS para o
hostname; não há nada para enviar. Até lá, o `admin` não responde em lugar algum, já que
o único hostname no qual ele responde ainda não alcança o projeto — o restante
do projeto fica online de qualquer forma.

O console acompanha o app em seu hostname: o link *Open CMS* e o endereço
do CMS na visão geral do projeto passam a ser `https://admin.example.com/`, e não o
host do projeto.

Um hostname que outro projeto já verificou faz o deploy falhar antes que qualquer
coisa seja lançada, assim como um hostname sob o próprio domínio da plataforma. Um que outro
projeto registrou e nunca verificou não impede o seu progresso: a recusa
fornece a você um registro TXT para o seu projeto e, assim que ele existir, o próximo deploy (ou
`rebase cloud domains add`) assume o hostname. Adicionar um hostname
que o projeto ainda não possui altera os domínios do projeto, algo que um token de acesso
criado com `--can deploy` não pode fazer: no CI, adicione o hostname uma vez com
`rebase cloud domains add` enquanto estiver autenticado, e o token poderá então fazer o deploy dele como
qualquer hostname já presente no projeto. Remover o app
do `rebase.json` mantém o hostname registrado no projeto; remova-o com
`rebase cloud domains remove admin.example.com`.

### Um hostname pertence a um app, não a uma rota

Um hostname é concedido a um app inteiro. Ele não pode apontar para uma rota interna. Quando
o CMS é uma rota de uma única SPA — `web` em `/` com `"cms": "/admin"` — ele
fica em `/admin`, em todos os hostnames em que o projeto responde. Dar a esse app
`https://admin.example.com` moveria toda a SPA para lá, com o CMS ainda
em `/admin` sob ela. Para dar ao CMS um hostname próprio, transforme-o em um app
próprio, com seu próprio build, como no exemplo acima.

## Servindo uma função em um caminho dentro de um app

Uma função customizada responde em `/api/functions/<name>`, e um app estático não pode
reivindicar `/api`. Um site de publicação precisa de alguns caminhos que nenhum build pode conter — um
sitemap e um feed que listam as postagens mais recentes, uma página renderizada a partir do
banco de dados. O campo `routes` serve a resposta de uma função em um caminho no próprio
endereço do app:

```jsonc
"site": {
  "type": "static",
  "root": "site",
  "output": "site/dist",
  "path": "https://www.example.com",
  "routes": [
    { "path": "/sitemap.xml", "function": "sitemap" },
    { "path": "/feed.xml", "function": "feed" },
    { "path": "/blog/*", "function": "blog" }
  ]
}
```

`https://www.example.com/sitemap.xml` será então o que `functions/sitemap.ts`
retornar, com seu próprio `Content-Type`, status e cabeçalhos. Todo o restante
no hostname é o build do site, como antes.

- **Exato ou curinga (wildcard).** `/sitemap.xml` corresponde apenas àquele caminho. `/blog/*`
  corresponde a `/blog` e a todos os caminhos abaixo dele, e repassa o restante para a função:
  `/blog/hello` atinge a rota `/:slug` da função com `slug` definido como
  `hello`, e `/blog` atinge sua rota `/`.
- **A função vê uma chamada comum.** A requisição chega até ela como se tivesse
  sido feita para `/api/functions/<name>`, passando pela mesma autenticação, verificações de escopo,
  rate limit e timeout. Seu método, cabeçalhos, corpo e query string são
  repassados, assim como o `Host`, de forma que `new URL(c.req.url).origin` é a origem
  do site — a partir da qual as URLs absolutas de um sitemap são construídas. A função ainda
  responde em `/api/functions/<name>` também.
- **A rota mais específica vence**: um caminho exato antes de qualquer curinga, e um
  curinga mais longo antes de um mais curto. Uma rota também tem precedência sobre um arquivo de
  mesmo caminho no build, de modo que um `public/sitemap.xml` desatualizado não poderá ocultá-la.
- **Apenas onde o app responde.** Uma rota se aplica a requisições que o próprio app
  responderia — em seu hostname, se houver, e não sob o caminho de outro app.
  O `rebase.json` é recusado se uma rota for colocada onde outro app responde.
- **Dentro do app, e nunca do backend.** O caminho de uma rota é absoluto,
  dentro do `path` do app, e não pode estar sob `/api`, `/health`, `/healthz`,
  `/livez`, `/readyz` ou `/metrics`, nem ter um segmento iniciado com `.`. Um
  curinga não pode cobrir o app inteiro, o que deixaria seu build sem ser servido.

As rotas são servidas pelo processo de backend no qual o app está integrado, pois
é onde as funções são executadas: `rebase build` e `rebase cloud deploy` integram cada
app estático ao bundle do backend, e o build falha se uma rota indicar uma
função que o backend não possui. Um app estático publicado isoladamente não possui
funções para chamar, portanto o `rebase cloud deploy` recusa apps com rotas, e o
runtime se recusa a inicializar um bundle exclusivamente estático que as declare.

Uma resposta roteada que não envie `Content-Security-Policy` recebe a do próprio app,
portanto as origens em seu [`frameAncestors`](/docs/deployment/self-hosting/#letting-another-origin-frame-an-app)
podem enquadrar uma página renderizada no servidor assim como podem enquadrar o restante do site.

No `rebase dev`, o app é servido pelo seu próprio servidor de desenvolvimento, que não tem conhecimento
das rotas; chame a função em `/api/functions/<name>` localmente, ou teste as
rotas contra um build usando `rebase start`.

## Redirecionamentos e URLs limpas

<span class="since-badge" data-since="0.35">Desde 0.35</span>

Um app estático aceita `redirects` (`{ "from": "/blog/:slug", "to": "/posts/:slug" }`,
inclusive para outro domínio) e `cleanUrls: true` (`/x` serve `x.html`). Veja
[Redirecionamentos e URLs limpas](/docs/architecture/redirects-and-clean-urls/), que
também mapeia um `vercel.json` para o `rebase.json`.

## Compilando e fazendo deploy de apps

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

O backend é compilado primeiro, pois o build de um app cliente pode consumir um SDK
gerado a partir de suas tabelas.

## Múltiplos repositórios

O monorepo continua sendo o padrão: um repositório com um backend e um painel de administração
é o caminho mais simples que funciona, e o `rebase init` cria essa estrutura inicial. Dividir em vários repositórios é
um passo de evolução, não um requisito.

Em um repositório de frontend separado, você precisa de duas coisas: um manifesto declarando
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
definido por checkout, assim como um remote do git. O manifesto é commitado; o link não.

## Clientes tipados sem as tabelas

Esse é o mecanismo que faz o modelo multi-repo funcionar. Um repositório que não contém
tabelas gera seu SDK tipado a partir do próprio projeto:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

A CLI busca `/api/meta/contract` e lê suas `tables` — os descritores compilados,
incluindo destinos de relacionamentos, dos quais o gerador de tipos precisa para
decidir se uma chave estrangeira é uma string ou um número — e emite exatamente o
mesmo resultado que teria produzido a partir do código-fonte local.

O endpoint do contrato precisa do escopo `schema:read`, que um administrador possui. Ele
descreve cada tabela, coluna e relacionamento no projeto, incluindo aqueles que nenhuma regra de segurança jamais
exporia; trata-se de um mapa do banco de dados, não de uma documentação pública da API.

## Detectando drift

Dividir os repositórios tem um custo que vale a pena mencionar: uma alteração no schema e o
frontend que a utiliza deixam de entrar no mesmo commit. O backend pode publicar uma
alteração que deixa desamparado um cliente compilado com base no formato antigo.

Cada SDK gerado registra o schema do qual se originou:

```ts
// generated/sdk/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

E todo projeto publica a sua versão atual, sem autenticação, porque uma
estampa de versão não revela nada sobre o schema que ela representa:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a","runtime":{"version":"0.34.2","contract":1}}
```

Comparar os dois no CI transforma uma incompatibilidade silenciosa em uma verificação com falha. A estampa
muda quando os tipos gerados podem mudar — uma nova propriedade, uma
relação alterada — e deliberadamente *não* muda quando um hook, uma regra de segurança ou um ícone
é alterado, evitando falsos alarmes.

## Configuração do cliente

```bash
rebase apps config web
```

Imprime o que um cliente precisa para alcançar o projeto. Nunca imprime um segredo: a
URL da API e a identidade publicável de um app são feitas para serem enviadas dentro de um bundle
de cliente, e qualquer coisa que não seja segura ali não deve constar em uma saída que
terminará em um `.env` commitado.

## Relacionado

- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — o que o `rebase build` produz e o que o inicializa
- [Processos Divididos](/docs/deployment/split-processes/) — executando um bundle como múltiplos processos
- [Comandos da CLI](/docs/cli/) — `rebase apps` e o restante
