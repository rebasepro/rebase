---
title: Dividir em vários processos
sidebar_label: Processos separados
description: "Execute um bundle como vários processos que cooperam entre si — uma API, uma camada de funções, um worker — a partir da mesma imagem de runtime publicada, para que uma função personalizada pesada deixe de competir com a API de dados."
---

## Visão geral

Um deployment do Rebase é normalmente um único processo que serve tudo: a API de
dados, a autenticação, o armazenamento, as tuas funções personalizadas, o cron e
a fila de tarefas. É a forma certa para quase todos os deployments e continua a
ser a predefinição.

Quando deixa de ser — uma função personalizada que bloqueia o event loop, ou uma
camada de funções que deve escalar ou reiniciar independentemente da API — podes
arrancar **a mesma imagem e o mesmo bundle** várias vezes e fazer com que cada
processo sirva uma parte diferente do projeto. Não há nada de novo para construir
nem nada que o cliente precise de saber: os URLs não mudam.

Uma variável de ambiente decide o que é cada processo:

```bash
REBASE_ROLE=api        # data, auth, admin, storage, meta — everything but functions
REBASE_ROLE=functions  # custom functions only
REBASE_ROLE=worker     # no HTTP surface: cron and the job queue
REBASE_ROLE=all        # the default: everything, one process
```

## O que cada papel serve

| | `all` | `api` | `functions` | `worker` |
| --- | :---: | :---: | :---: | :---: |
| `/api/auth`, `/api/data`, `/api/storage`, `/api/meta` | ✅ | ✅ | — | — |
| `/api/admin`, `/api/logs`, o editor de esquema | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | reencaminha (ver abaixo) | ✅ | — |
| `/api/cron` (a superfície de administração) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Serve websockets, consome eventos de alteração | ✅ | ✅ | — | — |
| Cria o esquema no arranque | ✅ | ✅ | — | — |
| Executa o agendador de cron | ✅ | ✅ | — | ✅ |
| Executa os workers da fila de tarefas | ✅ | ✅ | — | ✅ |

Health e métricas existem em todos os papéis, sem exceção. Um processo que um
orquestrador não consegue sondar é um processo que ele não consegue atualizar.

O realtime está na lista porque custa alguma coisa quer alguém o use quer não: um
processo que consome eventos de alteração mantém uma ligação `LISTEN` fora da
pool enquanto viver, e instala os triggers de captura no arranque. Só um processo
que serve websockets tem a quem entregar, por isso os dois papéis que não servem
nenhum não fazem nem uma coisa nem outra. **As escritas feitas por esses
processos continuam a ser ouvidas**: a captura são triggers de base de dados, ou
seja, uma alteração é publicada pela base de dados e não pelo processo que a fez.
Uma função que escreve uma linha continua a acordar todos os subscritores da
`api`.

## Docker Compose

Dois serviços a partir de uma imagem, um bundle e uma base de dados:

```yaml
services:
  api:
    image: rebasepro/server:latest
    environment:
      REBASE_ROLE: api
      REBASE_FUNCTIONS_UPSTREAM: http://functions:8080
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      - ./dist-bundle:/bundle
    ports:
      - "8080:8080"

  functions:
    image: rebasepro/server:latest
    environment:
      REBASE_ROLE: functions
      REBASE_MIGRATE_ON_BOOT: none
      TRUSTED_PROXY_HOPS: 1
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      - ./dist-bundle:/bundle
```

```bash
docker compose up --scale functions=3
```

Ambos os processos precisam do mesmo `DATABASE_URL`, do mesmo `JWT_SECRET` e da
mesma `REBASE_SERVICE_KEY`: são um só deployment, e um token emitido por um tem
de ser aceite pelo outro.

## Manter os mesmos URLs

`REBASE_FUNCTIONS_UPSTREAM` diz ao processo `api` para reencaminhar
`/api/functions/*` para o processo de funções em vez de o servir. Clientes, SDKs
gerados e chaves de API veem exatamente a mesma superfície que viam antes da
divisão, portanto nenhum código de aplicação muda e não é preciso montar um
proxy inverso para experimentar.

Um deployment de produção pode preferir encaminhar esse caminho no seu ingress;
nesse caso deixa `REBASE_FUNCTIONS_UPSTREAM` por definir — o processo `api`
responderá 404 nesses caminhos e o proxy à frente decidirá para onde vão.

### Saltos de proxy

Quando a API reencaminha, acrescenta o endereço de quem chamou a
`X-Forwarded-For`. Isso coloca o processo de funções atrás de **mais um salto de
proxy** do que a API, e é preciso dizer-lho:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` é o número de proxies inversos que realmente tens à frente
de um processo. Cada um acrescenta a `X-Forwarded-For` o endereço que viu, pelo
que o cliente real é a N-ésima entrada a contar da direita; tudo o que está mais
à esquerda é fornecido pelo cliente e ignorado — é isso que impede falsificar o
cabeçalho para rodar as chaves do limitador. O valor predefinido é `0`: nenhum
proxy é de confiança.

Se isto ficar errado, nada parte de forma visível: os limitadores do processo de
funções associam todos os pedidos ao endereço do contentor da API, portanto todos
os teus chamadores partilham um único balde, e o IP registado em cada evento de
autenticação é sempre o mesmo.

## Um processo é dono do esquema

Exatamente um processo de um deployment dividido cria as tabelas e aplica as
políticas RLS no arranque, e é o `api` (ou o `all`). Todos os outros processos
têm de definir:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Isto é **obrigatório**, não um conselho: um processo `functions` ou `worker`
deixado no valor predefinido recusa arrancar, e diz porquê. `CREATE … IF NOT
EXISTS` lê o catálogo e depois escreve nele em dois passos separados, portanto
processos que arrancam ao mesmo tempo colidem mesmo — e um deployment em que
vários competem para criar o mesmo esquema não é um deployment que alguém tenha
desenhado.

## Servir uma função por processo

Um processo pode servir um subconjunto nomeado, que é como uma função cara
consegue o seu próprio número de réplicas sem que o código se mova para lado
nenhum:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Os nomes são nomes de ficheiro sem a extensão — o mesmo nome sob o qual a função
é montada. Um nome que o bundle não contém **faz falhar o arranque**, e o erro
enumera os nomes que contém. Um processo configurado para uma função existe para
essa função, portanto uma gralha que servisse silenciosamente nada seria o pior
resultado possível.

## Cron e tarefas em segundo plano

Ambos já são seguros em mais do que um processo: o agendador de cron reivindica
cada par `(job, slot)` na base de dados, e a fila de tarefas reivindica linhas com
`FOR UPDATE SKIP LOCKED`. Por isso o `api` continua a executar ambos por
predefinição e uma divisão em dois serviços fica completa sem um terceiro
contentor.

Acrescenta um processo `worker` quando quiseres tirar o trabalho agendado do
caminho dos pedidos, e desliga-o na API:

```yaml
  api:
    environment:
      REBASE_CRON_SCHEDULER: "false"
      REBASE_JOB_WORKERS: "false"

  worker:
    environment:
      REBASE_ROLE: worker
      REBASE_MIGRATE_ON_BOOT: none
```

Um processo `functions` nunca executa nenhum dos dois. Escala com a carga de
pedidos e é substituído a qualquer momento; dar-lhe trabalho agendado faria com
que o seu número de réplicas significasse algo que não deve significar.

Nota que `rebase.jobs.enqueue` continua a funcionar em todo o lado, incluindo num
processo que não executa workers: enfileirar é uma escrita, executar é um ciclo
de sondagem, e só o segundo é o que um papel desliga.

## O que dividir não te dá

**Limites de taxa partilhados.** O armazenamento do limitador é por processo por
predefinição, portanto N processos multiplicam por N a dotação de cada chamador.
Define `REBASE_RATE_LIMIT_STORE=sql` em cada processo que sirva HTTP: conta no
Postgres, por isso o limite é o limite haja as réplicas que houver. (O chart Helm
define-o por ti e recusa-se a renderizar uma topologia com vários processos que o
deixe em `memory`.)

**Canais entre instâncias.** O broadcast e a presença usam um bus em memória por
predefinição, que não atravessa processos. Isto é uma questão de *número de
réplicas* mais do que de divisão — é igualmente verdade num deployment de papel
único escalado para três — portanto define `REALTIME_CHANNEL_BUS=postgres` (ou
`realtime.bus` na configuração) sempre que mais do que um processo servir
websockets.

**Escalar até zero.** Nada disto reduz um processo a nada nem levanta um a
pedido. Isso é uma capacidade da plataforma, não do runtime.

## Lançar uma unidade por si só

Tudo o que está acima reparte *onde* o trabalho corre. Tudo isso continua a ser
lançado como uma só build: uma imagem, um bundle, implantados em conjunto. É a
predefinição certa, e a maioria dos deployments deve ficar por aí.

Uma unidade também pode ficar numa build própria — uma correção de função que não
reinicia a API:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.16.0"     # só esta unidade; as restantes ficam na tag do release
```

Normalmente só vale a pena fixar a tag: o repositório é herdado, portanto é um
projeto e uma imagem com uma unidade movida. `bundleUrl` faz o mesmo quando
`bundle.mode: url`.

### A regra

Duas unidades em builds diferentes são dois conjuntos de coleções contra **uma**
base de dados, e só uma unidade a aprovisiona. Portanto:

> **A unidade dona do esquema é implantada primeiro. Uma unidade pode ficar para
> trás; nunca deve ir à frente.**

É o Job de migração, ou a `api` quando o Job está desligado. Uma unidade à
*frente* do esquema consulta colunas que ainda não existem e depende de políticas
RLS que ninguém aplicou — a primeira é um erro SQL numa rota, a segunda um
resultado vazio com um 200. Uma unidade *atrás* é o estado normal de qualquer
rollout a decorrer.

### O que o verifica

O processo que aprovisiona regista na base de dados a versão de esquema que
aplicou. Todos os outros processos calculam a sua a partir das coleções que
carregaram e comparam. Havendo desacordo, dizem-no, nomeando ambas:

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v1:6f2a…, this process v1:91cd…).
```

Avisa e serve, porque durante um rollout esse desacordo é *correto*: as unidades
que ainda não rolaram devem estar atrás. Define
`REBASE_REQUIRE_SCHEMA_MATCH=true` (ou `sharedState.requireSchemaMatch` no chart)
para recusar o arranque, num deployment que prefere não servir a servir errado.

Ambos os lados dessa comparação são **calculados**, nunca lidos de um manifesto.
Uma versão que uma build afirma sobre si mesma não prova que a base de dados
concorda.

Nada verifica a *direção* — uma versão de esquema é um hash: pode dizer que as
duas divergem, nunca qual está à frente. É por isso que a ordem do rollout é uma
regra que segues, não uma que o runtime possa impor.

## Atualizar

Sem alterações: todos os processos executam a mesma imagem publicada, portanto
atualizar é a mesma mudança de tag em cada um. Atualiza o `api` por último se
quiseres que o provisionamento do esquema aconteça primeiro contra a nova versão
— embora na prática a ordem não importe, porque o passo do esquema é aditivo e
idempotente.
