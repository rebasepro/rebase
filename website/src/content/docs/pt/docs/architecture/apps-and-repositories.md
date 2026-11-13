---
sourceHash: 4ad669042dfd8fc9
title: Apps e Repositórios
sidebar_label: Apps & Repositórios
description: Um projeto é um backend mais os apps que se comunicam com ele, os quais podem viver cada um em seu próprio repositório.
---

## Projetos e apps

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um **projeto** é o backend: o banco de dados, autenticação, armazenamento, realtime e
funções. Um **app** é algo que se comunica com ele.

| Tipo | O que é |
| --- | --- |
| `backend` | As tabelas, hooks e funções que definem a API. Exatamente um por projeto. |
| `static` | Um bundle de cliente compilado — uma SPA ou site estático, servido em seu próprio caminho ou em seu próprio hostname. |

Essa é a lista completa. O painel administrativo é um app `static` como qualquer outro: ele é
construído no seu repositório, com as suas customizações em `frontend/src/cms`, e é por isso
que campos customizados e views customizadas funcionam nele desde o primeiro dia.

Quem é o dono do processo do servidor é uma propriedade do backend, não um tipo separado de
app:

| `runtime` | O que significa |
| --- | --- |
| `managed` | A imagem de runtime da plataforma executa o seu bundle. Você fornece tabelas, funções, crons e schema. |
| `custom` | Você fornece o servidor: seu próprio Dockerfile e entrypoint. O comando `rebase eject` configura isso. |

Isso independe de *onde* ele roda. Ambos rodam no Rebase Cloud e ambos podem ser
auto-hospedados — o destino fica em `.rebase/cloud.json`, não no manifesto.

A parte importante é quem *possui* a lista. Um repositório declara apenas os apps
que ele contém; o projeto é o dono do conjunto de apps existentes. Dois repositórios nunca
precisam saber um sobre o outro — eles só precisam conhecer o projeto. É isso que
torna um repositório frontend separado, ou um app mobile sem nenhuma relação de
repositório, algo comum em vez de um caso especial.

## `rebase.json`

O manifesto declara a topologia, e nada mais. Schema, regras de segurança, hooks
e funções continuam em TypeScript, onde um sistema de tipos pode verificá-los.

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
`/admin`. Essa é a proposta de auto-hospedagem, e uma camada pequena perfeitamente
adequada no Rebase Cloud.

## Indicando onde o CMS está

`cms` é o caminho de URL onde um app monta `<RebaseCMS>`. É opcional, é o
único campo aqui que descreve o que está *dentro* de um app em vez de onde o
app reside, e existe porque nada mais consegue descobrir isso.

O CMS é um componente React no seu próprio frontend, portanto seu endereço é uma
rota client-side. Não é uma rota do servidor, não é um arquivo no build e não é
distinguível de qualquer outro caminho não correspondente sob uma SPA — uma requisição para
`/admin` recebe o mesmo `index.html` que uma requisição para `/anything-else`. Portanto, nenhum
deploy, nenhum servidor em execução e nenhuma quantidade de sondagem pode dizer onde seu painel
administrativo está. Se você não escrever isso, nada saberá.

O que sabe disso, faz algo com isso:

- **Rebase Cloud** coloca um link *Open CMS* no cabeçalho do projeto e lista o
  endereço na visão geral do projeto — no próprio hostname do app quando ele tem
  um. Sem `cms`, o console só pode oferecer o host do projeto — que
  alcança o CMS apenas se ele estiver situado na raiz dele.
- **`rebase dev`** imprime a URL do CMS em seu banner de inicialização quando ela não é
  simplesmente a página inicial do frontend.
- **`rebase apps list`** mostra-o ao lado do app que o serve.

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
a `path`, e deve estar dentro do app que o declara — o fallback de SPA desse app
é o que responde lá. É sempre um caminho, mesmo quando o `path` do app é uma URL:
o CMS fica então nesse caminho no hostname do app, portanto `"cms": "/"`
acima significa `https://admin.example.com/`. Um projeto tem um único CMS; declarar um
segundo é um erro em vez de um sorteio sobre a qual deles o console vincula.

`path` é uma entrada de **tempo de build** bem como de serviço. Um app montado em
`/admin` precisa ser *compilado* para `/admin`, caso contrário o `index.html` carrega e todos os assets
dão erro 404 — uma página em branco sem nenhum erro em lugar nenhum. O comando `rebase build` passa o valor como
`REBASE_APP_BASE`, que seu empacotador lê como seu caminho base:

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

e se recusa a enviar um build que o ignorou.

Um projeto existente não precisa de um. A CLI infere o mesmo layout a partir da
estrutura de diretórios, e `rebase apps init` o registra quando você quiser torná-lo
explícito:

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

A inferência não consegue saber duas coisas que o `rebase.json` de um scaffold declara. Ela
nomeia o app estático como `web`, onde um scaffold o nomeia como `admin`, e ela não consegue saber
a rota `cms` do app. O nome não muda: o Rebase Cloud registrou `web` para
cada projeto que fez deploy sem um `rebase.json`.
`rebase apps init --force` mantém os nomes, `path` e `cms` dos apps declarados pelo arquivo
que ele substitui, e marca como removido qualquer app que não encontrar mais.

## Um app em seu próprio hostname

`path` também pode ser uma URL `https://` completa, o que dá ao app um hostname
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

`https://admin.example.com` serve `admin`. Qualquer outro hostname no qual o projeto
responda — `example.com`, ou o próprio endereço do projeto no Rebase Cloud —
serve `web`, e `admin` não é acessível lá de forma alguma. Ainda é um único
processo e um único deploy; o hostname apenas decide qual app responde a uma requisição.

Duas regras decidem isso:

- Um app com um hostname responde apenas nesse hostname. Um app sem ele
  responde em todos os hostnames.
- Dos apps restantes, aquele com o caminho mais longo vence, como sempre foi. Em caso de
  caminhos iguais, o app que especifica o hostname vence o que não especifica.

No exemplo, ambos os apps estão em `/`, então em `admin.example.com` a segunda regra
escolhe `admin`. Declare o admin em `"https://admin.example.com/cms"` em vez disso
e ele responderá apenas sob `/cms` nesse hostname: `admin.example.com/pricing`
vai para `web`. Um hostname restringe onde um app responde; ele não entrega tudo
nesse hostname para o app. Dois apps não podem compartilhar o mesmo hostname e o mesmo caminho.

O backend não é um app, e um hostname não o move. `/api`, `/health`
e os outros caminhos que o backend reserva são respondidos antes de qualquer app ser
consultado, em todos os hostnames, portanto `https://admin.example.com/api` é a mesma
API que `https://example.com/api`. Um app que chama sua própria origem — o
`VITE_API_URL` vazio do scaffold — não precisa de uma URL de API própria e nem de
configuração de CORS. Pelo mesmo motivo, esses caminhos são recusados após um hostname assim como
são sozinhos: `https://admin.example.com/api` não é mais válido do que
`/api`.

Tudo o mais sobre `path` se aplica à parte após o hostname. O app
ainda é compilado para ele: `https://admin.example.com` é compilado com
`REBASE_APP_BASE` definido como `/`, `https://admin.example.com/cms` com `/cms/`, e
um empacotador que ignorar isso ainda deixará você com uma página em branco. `cms` é um caminho no
hostname do app, dentro dessa parte do caminho. A URL deve ser `https://` e conter um
hostname e um caminho e nada mais — sem porta, query ou fragmento. Um simples
`admin.example.com` é recusado, informando a URL que deveria ter sido.

Sob `rebase dev`, nada é roteado por hostname. Ele roda o app em
`frontend/` na raiz de uma porta localhost, como sempre fez, e para um app
com um hostname seu banner também imprime o endereço `https://` que ele terá
quando for implantado.

O `rebase start` é diferente, porque executa o bundle compilado através do mesmo
runtime que uma implantação usa — incluindo o roteamento por hostname. Um app com um hostname
responde apenas a requisições cujo `Host` seja esse hostname, portanto
`http://localhost:3001/` mostra o app sem hostname, e um bundle cujo único app
especifica um hostname responderá com 404 lá. Para alcançá-lo localmente, envie o cabeçalho
você mesmo:

```bash
curl -H "Host: admin.example.com" http://localhost:3001/
```

ou aponte o hostname para `127.0.0.1` em `/etc/hosts` e abra
`http://admin.example.com:3001/`. Deliberadamente não há nenhum parâmetro de query ou
cabeçalho que sobrescreva o roteamento: um que funcionasse localmente também funcionaria
em uma implantação, e escolher o app por qualquer coisa além do `Host` real é
o que o roteamento existe para evitar.

Em auto-hospedagem, o processo faz a mesma escolha a partir do cabeçalho `Host`
de cada requisição. Apontar o hostname para o servidor e fornecer a ele um certificado são
tarefas suas, assim como são para o hostname principal do projeto, e um proxy reverso
na frente deve repassar o `Host` original — o Caddy faz isso por padrão,
o nginx precisa de `proxy_set_header Host $host;`. `X-Forwarded-Host` não é lido,
porque qualquer cliente pode enviar um.

### No Rebase Cloud

`rebase cloud deploy` registra o hostname no projeto — o que
`rebase cloud domains add` faz —, portanto não há uma etapa separada para esquecer. O que
acontece a seguir depende do DNS:

- **Os registros já existem.** O deploy verifica o hostname, e ele fica ativo
  quando o deploy termina.
- **Eles não existem.** O deploy prossegue e imprime os dois registros a serem criados:
  um registro TXT que comprova que o domínio é seu e um CNAME que o aponta para o
  projeto (um registro A, se o hostname for o apex do domínio).

Assim que os registros forem publicados:

```bash
rebase cloud domains verify admin.example.com
```

`rebase cloud domains list` imprime os registros novamente caso você os perca. Um
hostname que não seja verificado dentro de 7 dias após o registro é liberado,
e o próximo deploy o registrará novamente. Quando a
verificação passar, a plataforma emitirá o certificado HTTPS para o
hostname; não há nada para fazer upload. Até lá, `admin` não responde em lugar nenhum, já
que o único hostname no qual ele responde ainda não alcança o projeto — o restante
do projeto está ativo de qualquer forma.

O console acompanha o app em seu hostname: o link *Open CMS* e o
endereço do CMS na visão geral do projeto passam a ser `https://admin.example.com/`, e não o
host do projeto.

Um hostname que outro projeto já verificou causa falha no deploy antes que qualquer coisa
seja lançada, assim como um sob o próprio domínio da plataforma. Um que outro
projeto registrou e nunca verificou não fica no seu caminho: a recusa
fornece a você um registro TXT para o seu projeto e, assim que ele existir, o próximo deploy (ou
`rebase cloud domains add`) assume o hostname. Adicionar um hostname
que o projeto ainda não possui altera os domínios do projeto, o que um token de acesso
criado com `--can deploy` não pode fazer: a partir do CI, adicione o hostname uma vez com
`rebase cloud domains add` enquanto estiver autenticado, e o token poderá então fazer o deploy dele como
qualquer hostname já presente no projeto. Remover o app
de `rebase.json` deixa o hostname registrado no projeto; remova-o com
`rebase cloud domains remove admin.example.com`.

### Um hostname pertence a um app, não a uma rota

Um hostname é concedido a um app inteiro. Ele não pode apontar para uma rota dentro de um app. Quando
o CMS é uma rota de uma única SPA — `web` em `/` com `"cms": "/admin"` —, ele
vive em `/admin`, em todos os hostnames em que o projeto responde. Dar a esse app
`https://admin.example.com` moveria toda a SPA para lá, com o CMS ainda
em `/admin` sob ela. Para dar ao CMS um hostname próprio, transforme-o em um app
próprio, com seu próprio build, como no exemplo acima.

## Compilando e fazendo deploy de apps

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

O backend é compilado primeiro, pois o build de um app cliente pode consumir um SDK
gerado a partir de suas tabelas.

## Múltiplos repositórios

O monorepo continua sendo o padrão: um repositório com um backend e um painel administrativo
é a coisa mais simples que funciona, e o `rebase init` cria seu scaffold. Dividir é
o passo de graduação, não um requisito.

Em um repositório frontend separado, você precisa de duas coisas — um manifesto declarando
o que este repositório fornece e um link para o projeto:

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

O link é gravado em `.rebase/cloud.json` e **não é comitado** — ele é
por checkout, como um git remote. O manifesto é comitado; o link não.

## Clientes tipados sem as tabelas

Este é o mecanismo que faz o multi-repo funcionar. Um repositório que não contém
tabelas gera seu SDK tipado a partir do próprio projeto:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

A CLI busca `/api/meta/contract` e lê suas `tables` — os descritores compilados,
incluindo destinos de relacionamentos, que o gerador de tipos precisa para
decidir se uma chave estrangeira é uma string ou um número — e emite exatamente a
mesma saída que teria produzido a partir do código-fonte local.

O endpoint do contrato precisa do escopo `schema:read`, que um admin possui. Ele
descreve todas as tabelas,
colunas e relacionamentos do projeto, incluindo aqueles que nenhuma regra de segurança jamais
exporia; trata-se de um mapa do banco de dados, não de documentação pública de API.

## Detectando divergências (drift)

Dividir repositórios custa uma coisa que vale a pena mencionar: uma alteração de schema e o
frontend que a utiliza não chegam mais no mesmo commit. O backend pode fazer deploy de uma
alteração que deixa desamparado um cliente compilado contra a estrutura antiga.

Cada SDK gerado registra o schema do qual se originou:

```ts
// generated/sdk/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

E cada projeto publica sua versão atual, sem autenticação, porque um
registro de versão não revela nada sobre o schema que ele representa:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a","runtime":{"version":"0.30.1","contract":1}}
```

Comparar os dois no CI transforma uma incompatibilidade silenciosa em uma verificação com falha. A estampa
muda quando os tipos gerados podem mudar — uma nova propriedade, um
relacionamento alterado — e deliberadamente *não* quando um hook, uma regra de segurança ou um ícone
muda, evitando alarmes falsos.

## Configuração do cliente

```bash
rebase apps config web
```

Imprime o que um cliente precisa para se conectar ao projeto. Nunca imprime um segredo: a
URL da API e a identidade publicável de um app destinam-se a ser enviadas dentro de um
bundle de cliente, e qualquer coisa que não seja segura lá não deve constar em uma saída que
terminará em um `.env` comitado.

## Relacionado

- [Runtime e Bundles](/docs/architecture/runtime-and-bundles/) — o que `rebase build` produz e o que o inicializa
- [Processos Divididos](/docs/deployment/split-processes/) — executando um bundle como múltiplos processos
- [Comandos da CLI](/docs/cli/) — `rebase apps` e os demais
