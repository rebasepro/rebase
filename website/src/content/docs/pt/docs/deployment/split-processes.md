---
sourceHash: f09c52453f45b58d
title: Divisão em vários processos
sidebar_label: Dividir Processos
description: Execute um bundle como vários processos cooperantes — uma API, uma camada de funções, um worker — a partir da mesma imagem de runtime publicada, para que uma função customizada pesada deixe de competir com a API de dados.
---

## Visão geral

Uma implantação do Rebase normalmente consiste em um único processo atendendo a tudo: a API de dados,
autenticação, armazenamento, suas funções customizadas, cron e a fila de jobs. Esse é o formato
ideal para quase todas as implantações e continua sendo o padrão.

Quando isso deixa de ser o formato ideal — uma função customizada que sobrecarrega o event loop,
uma camada de funções que deve escalar ou reiniciar independentemente da API — você pode
inicializar **a mesma imagem e o mesmo bundle** várias vezes e fazer com que cada
processo atenda a uma parte diferente do projeto. Não há nada novo para compilar e
nada que o cliente precise saber: as URLs não mudam.

Uma variável de ambiente decide o que um processo é:

```bash
REBASE_ROLE=api        # data, auth, admin, storage, meta — everything but functions
REBASE_ROLE=functions  # custom functions only
REBASE_ROLE=worker     # no HTTP surface: cron and the job queue
REBASE_ROLE=all        # the default: everything, one process
```

## O que cada role atende

| | `all` | `api` | `functions` | `worker` |
| --- | :---: | :---: | :---: | :---: |
| `/api/auth`, `/api/data`, `/api/storage`, `/api/meta` | ✅ | ✅ | — | — |
| `/api/admin` (logs e o editor de schema inclusos) | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | encaminha (veja abaixo) | ✅ | — |
| `/api/admin/cron` (a interface de administração) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Atende websockets, consome eventos de alteração | ✅ | ✅ | — | — |
| Cria o schema na inicialização | ✅ | ✅ | — | — |
| Executa o agendador do cron | ✅ | ✅ | — | ✅ |
| Executa workers da fila de jobs | ✅ | ✅ | — | ✅ |

Health checks e métricas estão presentes em todas as roles, sem exceção; `/metrics` responde apenas com `REBASE_METRICS=true`. Um processo que um
orquestrador não consegue sondar é um processo que ele não pode atualizar.

`GET /api/auth/config`,
que a tela de login lê, segue o restante de `/api/auth`: apenas `api` e
`all` o atendem.

O Realtime está na lista porque tem um custo quer alguém o use ou
não: um processo que consome eventos de alteração mantém uma conexão `LISTEN` fora
do pool durante todo o tempo em que estiver em execução e instala os triggers de captura na inicialização. Apenas
um processo que atende websockets tem destinatários para entregar eventos, portanto, as duas roles que
não atendem nenhum não fazem nenhuma dessas ações. **Gravações feitas por esses processos ainda são ouvidas.** Com
a captura de alterações ativada, a captura é feita por triggers no banco de dados, de modo que uma alteração é publicada pelo
banco de dados em vez de pelo processo que a realizou. Com a captura desativada
(`REALTIME_CDC=off` ou `auto` em fallback porque a role do banco de dados não pode
criar triggers), um processo `worker` ou `functions` anuncia cada uma de suas próprias
gravações no canal entre instâncias (cross-instance), sem manter uma conexão `LISTEN`.
De qualquer forma, uma função que grava uma linha ainda acorda todos os
assinantes na `api`.

Configure todos os processos com o mesmo `REALTIME_CDC`. Um processo proprietário
do schema com `REALTIME_CDC=off` remove os triggers de captura na inicialização, e uma `api`
ainda definida como `auto` passaria a escutar alterações que ninguém anuncia.

## Docker Compose

Dois serviços a partir de uma imagem, um bundle e um banco de dados:

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

Ambos os processos precisam da mesma `DATABASE_URL`, do mesmo `JWT_SECRET` e da mesma
`REBASE_SERVICE_KEY` — eles são uma única implantação, e um token gerado por um deve
ser aceito pelo outro. Um processo com `REBASE_FUNCTIONS_UPSTREAM` e sem
`REBASE_SERVICE_KEY` se recusará a inicializar: suas próprias chamadas
`rebase.functions.invoke(...)`, vindas de um hook ou de um job cron, chegam ao processo de funções com essa chave.

## Mantendo as mesmas URLs

O `REBASE_FUNCTIONS_UPSTREAM` instrui o processo `api` a encaminhar `/api/functions/*`
para o processo de funções em vez de atendê-lo diretamente. Deve ser uma URL `http://` ou
`https://`; qualquer outra coisa impede a inicialização. Apenas `api` e `worker` o leem
(veja [Cron e jobs em segundo plano](#cron-e-jobs-em-segundo-plano) para o worker). Clientes, SDKs gerados e chaves
de API veem exatamente a mesma interface que viam antes da divisão, portanto, nenhum código de aplicação
é alterado e você não precisa configurar um proxy reverso para testar isso.

Uma implantação em produção pode preferir rotear o caminho diretamente em seu ingress;
nesse caso, deixe `REBASE_FUNCTIONS_UPSTREAM` indefinido — o processo `api` então
responderá com 404 para esses caminhos e o proxy à frente decidirá para onde encaminhá-los.

### Hops de proxy

Quando a API faz o encaminhamento, ela anexa o endereço do chamador ao `X-Forwarded-For`. Isso
faz com que o processo de funções fique atrás de **mais um salto (hop) de proxy** do que a API,
e ele deve ser informado disso:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` é o número de proxies reversos que você realmente executa na frente
de um processo. Cada um anexa o endereço que viu ao `X-Forwarded-For`, de modo que o
cliente real é a enésima entrada a partir da direita; tudo o que estiver mais à esquerda foi
fornecido pelo cliente e é ignorado, o que impede que um chamador falsifique o cabeçalho para
burlar as chaves de rate limit. O padrão é `0` — nenhum proxy confiável.

Se errar nisso, nada quebrará de forma visível: os limitadores de taxa (rate limiters) no processo de funções
associarão todas as requisições ao endereço do contêiner da API, fazendo com que todos os seus chamadores compartilhem
o mesmo bucket, e o IP registrado em cada evento de autenticação será sempre o mesmo.

## Um processo é o proprietário do schema

Exatamente um processo em uma implantação dividida cria tabelas e aplica
políticas de RLS na inicialização, e esse processo é o `api` (ou `all`). Todos os outros processos devem
definir:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Isso é **obrigatório**, não apenas recomendação: um processo `functions` ou `worker` mantido no
padrão se recusará a iniciar e emitirá um erro informando isso. O `CREATE … IF NOT EXISTS` lê o catálogo
e depois grava nele em duas etapas separadas, portanto processos que inicializam juntos
entram em colisão — e uma implantação onde vários deles disputam para provisionar o mesmo
schema não foi projetada para funcionar assim.

Em um
[servidor customizado](/docs/backend/custom-server/), a mesma decisão é a
opção `provision` de `createRebaseBackend`: `true` no processo proprietário do
schema e `{ tables: false, realtime: false }` em todos os outros, o que
ainda mantém as tabelas do próprio framework. `REBASE_MIGRATE_ON_BOOT=none` desativa o
schema de tabelas lá também. O trabalho em segundo plano é decidido da mesma forma:
um processo que nunca chama `start()` não executa nenhum agendador cron e nenhum worker de job,
e um que o faz executa aqueles atribuídos pela sua opção `ownership`.

## Atendendo a uma função por processo

Um processo pode atender a um subconjunto nomeado, que é como uma função pesada
obtém sua própria contagem de réplicas sem que seu código precise ser movido para nenhum outro lugar:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Os nomes são os nomes de arquivos sem a extensão — o mesmo nome sob o qual a função é montada.
Um nome que o bundle não contém **faz a inicialização falhar**, e o erro lista
os nomes existentes. Um processo configurado para uma única função existe para essa
função, portanto um erro de digitação que silenciosamente não atendesse a nada seria o pior resultado
possível.

## Cron e jobs em segundo plano

Ambos já são seguros para execução em mais de um processo: o agendador do cron
reivindica cada par `(job, slot)` no banco de dados, e a fila de jobs reivindica linhas com
`FOR UPDATE SKIP LOCKED`. Portanto, a `api` continua executando ambos por padrão e uma divisão
em dois serviços fica completa sem a necessidade de um terceiro contêiner.

Adicione um processo `worker` quando quiser tirar o trabalho agendado do caminho da requisição
e desative-o na API:

```yaml
  api:
    environment:
      REBASE_CRON_SCHEDULER: "false"
      REBASE_JOB_WORKERS: "false"

  worker:
    environment:
      REBASE_ROLE: worker
      REBASE_MIGRATE_ON_BOOT: none
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      # Only if a job calls rebase.functions:
      REBASE_FUNCTIONS_UPSTREAM: http://functions:8080
```

Um job movido para um worker mantém `rebase.dataAsAdmin`, `rebase.sql`,
`rebase.storage` e `rebase.email`, que se comunicam diretamente com o banco de dados, os buckets e
o servidor de e-mail. Ele também mantém:

- **`rebase.admin`** (usuários, roles, redefinições de senha) **e `rebase.cron`.** Um
  worker não expõe nenhuma interface de administração em sua porta, mas carrega ambos no próprio processo,
  apenas para seus próprios jobs.
- **`rebase.functions`, com `REBASE_FUNCTIONS_UPSTREAM`.** Um worker não atende
  funções. Com o upstream definido, suas próprias chamadas `rebase.functions.invoke(...)`
  são encaminhadas para o processo de funções, onde a função enxerga a
  chamada como o próprio serviço. O worker continua sem responder a nada em `/api/functions`
  em sua porta. O worker precisa da `REBASE_SERVICE_KEY` da implantação para isso,
  assim como a `api`.

Ele perde o `rebase.auth`: esses são fluxos de login de usuários, e um worker
não atende a nenhum deles. Para operações de conta a partir de um job, use `rebase.admin`. Ele também perde
o restante da API de administração (backups, logs, o editor de schema e assim por diante), e
`rebase.functions` quando nenhum upstream está configurado. Uma chamada para qualquer um desses responderá
`404 NOT_FOUND`, indicando a interface que está desativada e o que fazer em vez disso.

Um processo `functions` nunca executa nenhum dos dois. Ele é escalado de acordo com a carga de requisições e
substituído conforme necessário; atribuir-lhe trabalho agendado faria com que sua contagem de réplicas
significasse algo que não deveria.

Observe que o enfileiramento — `jobQueue.enqueue`, o `enqueue` de uma fila declarada, o
`publish` de um tópico — continua funcionando em qualquer lugar, inclusive em um processo que não
executa workers — enfileirar é uma gravação, executar é um loop de sondagem (poll loop), e apenas
o segundo é o que uma role desativa.

## O que a divisão não oferece

**Limites de taxa (rate limits) compartilhados, a menos que você configure.** O armazenamento padrão é por processo, portanto, N
processos multiplicam o limite de cada chamador por N sem que nada nos logs indique
isso. Defina `REBASE_RATE_LIMIT_STORE=sql` em todos os processos que atendem HTTP — a contagem
é feita no Postgres, garantindo que o limite seja mantido independentemente do número de réplicas.
(O Helm chart faz essa configuração para você e se recusa a renderizar uma topologia de múltiplos processos
que mantenha o valor em `memory`.)

**Canais entre instâncias (cross-instance).** Broadcast e presence usam um barramento em memória por
padrão, que não ultrapassa as fronteiras dos processos. Essa é uma questão de *contagem de réplicas*
e não da divisão de processos em si — aplica-se igualmente a uma implantação de papel único
escalada para três réplicas —, portanto, defina `REALTIME_CHANNEL_BUS=postgres` (ou `realtime.bus` na
configuração) sempre que mais de um processo atender websockets.

**Escalar para zero.** Nada aqui reduz um processo a zero nem inicializa um sob demanda.
Essa é uma capacidade da plataforma de hospedagem, não do runtime.

Tudo o mais que um processo mantém isolado para si está em uma lista:
[Executando mais de uma instância](/docs/deployment/multiple-instances/).

## Publicando uma unidade de forma independente

Tudo o que foi descrito acima divide *onde o trabalho é executado*. Tudo ainda é entregue como uma
única compilação: uma imagem, um bundle, atualizados juntos. Esse é o padrão correto, e
a maioria das implantações deve permanecer assim.

Uma unidade também pode ser mantida em uma compilação própria — uma correção em uma função que não
reinicia a API:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.30.1"     # this unit only; the rest stay on the release-wide tag
```

Geralmente, vale a pena fixar apenas a tag: o repositório é herdado, portanto trata-se de
um único projeto e uma única imagem com uma unidade modificada. O `bundleUrl` faz o mesmo trabalho
quando `bundle.mode: url`.

### A regra

Duas unidades em compilações diferentes representam dois conjuntos de tabelas contra **um**
único banco de dados, e apenas uma unidade o provisiona. Portanto:

> **A unidade proprietária do schema é atualizada primeiro. Uma unidade pode ficar para trás;
> ela nunca deve estar à frente.**

Essa unidade é o Job de migração, ou a `api` quando o Job está desativado. Uma unidade executando
*à frente* do schema consulta colunas que ainda não existem e depende de políticas de RLS
que ninguém aplicou — o primeiro caso resulta em um erro de SQL em uma rota; o segundo, em um
resultado vazio com status 200. Uma unidade executando *atrás* é o estado normal de qualquer
rollout em andamento.

### O que verifica isso

O processo que provisiona registra a versão do schema que aplicou no
banco de dados. Todos os outros processos calculam a sua própria versão a partir das tabelas que carregaram e
comparam. Em caso de divergência, um aviso é emitido, indicando ambas:

```
⚠️ [schema] The database was last provisioned from a different set of tables
   than this process was built from (database v2:6f2a…, this process v2:91cd…).
```

Ele avisa e continua atendendo, porque durante um rollout essa divergência é *esperada* —
as unidades que ainda não foram atualizadas devem mesmo estar defasadas. Defina
`REBASE_REQUIRE_SCHEMA_MATCH=true` (ou `sharedState.requireSchemaMatch` no
chart) para recusar a inicialização, caso prefira não atender a requisições
do que atender de forma incorreta.

Ambos os lados dessa comparação são **calculados**, nunca lidos de um manifesto. A
versão que uma compilação declara sobre si mesma não é garantia de que o banco de dados concorda
com ela.

Nada verifica a *direção* — uma versão do schema é um hash, portanto só é possível dizer que
os dois discordam, nunca qual está à frente. É isso que torna a ordem de rollout uma
regra que você deve seguir, e não algo que o runtime possa impor.

## Atualização

Sem mudanças: cada processo executa a mesma imagem publicada, portanto uma atualização consiste na mesma
alteração de tag em cada um deles. Atualize o processo proprietário do schema — a `api`
ou o Job de migração — primeiro, para que o schema da nova versão já esteja pronto antes
que os outros processos sejam executados contra ele: uma unidade pode ficar para trás, nunca à frente (consulte
[A regra](#a-regra)).

## Relacionado

- [Guia de implantação](/docs/getting-started/deployment/) — a implantação em processo único que este documento divide
- [Ambiente e Configuração](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` e `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — um deployment por role
