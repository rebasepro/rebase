---
sourceHash: ce7486bb141920aa
title: Divisão em vários processos
sidebar_label: Processos Divididos
description: Execute um bundle como vários processos cooperantes — uma API, uma camada de funções, um worker — a partir da mesma imagem de runtime publicada, para que uma função customizada pesada não dispute recursos com a API de dados.
---

## Visão Geral

Uma implantação do Rebase é normalmente um único processo servindo tudo: a API de dados,
autenticação, armazenamento, suas funções customizadas, cron e a fila de jobs. Esse é o formato
ideal para quase todas as implantações e continua sendo o padrão.

Quando deixa de ser o formato ideal — uma função customizada que trava o event loop,
uma camada de funções que deve escalar ou reiniciar independentemente da API —, você pode
inicializar **a mesma imagem e o mesmo bundle** várias vezes e fazer com que cada
processo sirva uma parte diferente do projeto. Não há nada de novo para compilar e
nada que o cliente precise saber: as URLs não mudam.

Uma variável de ambiente decide o que um processo é:

```bash
REBASE_ROLE=api        # data, auth, admin, storage, meta — everything but functions
REBASE_ROLE=functions  # custom functions only
REBASE_ROLE=worker     # no HTTP surface: cron and the job queue
REBASE_ROLE=all        # the default: everything, one process
```

## O que cada role serve

| | `all` | `api` | `functions` | `worker` |
| --- | :---: | :---: | :---: | :---: |
| `/api/auth`, `/api/data`, `/api/storage`, `/api/meta` | ✅ | ✅ | — | — |
| `/api/admin`, `/api/logs`, o editor de schema | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | encaminha (veja abaixo) | ✅ | — |
| `/api/cron` (a superfície de admin) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Serve websockets, consome eventos de alteração | ✅ | ✅ | — | — |
| Cria o schema na inicialização | ✅ | ✅ | — | — |
| Executa o agendador do cron | ✅ | ✅ | — | ✅ |
| Executa workers da fila de jobs | ✅ | ✅ | — | ✅ |

Health e métricas estão em todas as roles sem exceção. Um processo que um
orquestrador não consegue sondar é um processo que ele não consegue atualizar.

O Realtime está na lista porque tem um custo, quer alguém o utilize ou
não: um processo que consome eventos de alteração mantém uma conexão `LISTEN` fora
do pool durante todo o tempo em que estiver em execução, e instala os triggers de captura na inicialização. Apenas
um processo que serve websockets tem destinatários para entregar eventos, portanto as duas roles que
não servem nenhum não fazem nenhuma das duas coisas. **Gravações feitas por esses processos ainda são ouvidas** —
a captura é feita por triggers no banco de dados, logo a alteração é publicada pelo banco de dados em vez de ser
pelo processo que a realizou. Uma função que grava uma linha ainda acorda
todos os inscritos na `api`.

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
`REBASE_SERVICE_KEY` — eles formam uma única implantação, e um token gerado por um precisa
ser aceito pelo outro.

## Mantendo as mesmas URLs

`REBASE_FUNCTIONS_UPSTREAM` instrui o processo `api` a encaminhar `/api/functions/*`
para o processo de funções em vez de servi-lo. Clientes, SDKs gerados e
chaves de API veem exatamente a mesma interface que viam antes da divisão, portanto nenhum código
de aplicação muda e você não precisa configurar um proxy reverso para testar.

Uma implantação em produção pode preferir rotear o caminho diretamente no seu ingress; nesse
caso, deixe `REBASE_FUNCTIONS_UPSTREAM` desconfigurado — o processo `api` então
responderá 404 para esses caminhos e o proxy à frente decidirá para onde eles vão.

### Saltos de proxy

Quando a API encaminha a requisição, ela anexa o endereço do chamador ao `X-Forwarded-For`. Isso
faz com que o processo de funções fique atrás de **mais um salto de proxy** do que a API,
e ele precisa ser informado disso:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` é o número de proxies reversos que você realmente executa à frente
de um processo. Cada um anexa o endereço que visualizou ao `X-Forwarded-For`, de modo que o
cliente real é a enésima entrada a partir da direita; tudo o que estiver mais à esquerda foi
fornecido pelo cliente e é ignorado, o que impede que um chamador falsifique o cabeçalho para
burlar os limites de taxa. O valor padrão é `0` — nenhum proxy confiável.

Se configurar isso incorretamente, nada quebrará de forma visível: os limitadores de taxa no processo de funções
associarão cada requisição ao endereço do container da API, fazendo com que todos os chamadores compartilhem
o mesmo bucket, e o IP registrado em cada evento de autenticação será o mesmo.

## Um único processo é dono do schema

Exatamente um processo em uma implantação dividida cria tabelas e aplica
políticas RLS na inicialização, e esse é o processo `api` (ou `all`). Todos os outros processos devem
definir:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Isso é **obrigatório**, não apenas uma recomendação: um processo `functions` ou `worker` mantido no
padrão se recusará a iniciar e emitirá um aviso. O comando `CREATE … IF NOT EXISTS` lê o catálogo
e depois grava nele em duas etapas separadas, portanto processos inicializando juntos
colidem — e uma implantação onde vários deles disputam para provisionar o mesmo
schema não é algo planejado para acontecer.

## Servindo uma função por processo

Um processo pode servir um subconjunto nomeado, que é como uma função com alto consumo de recursos
ganha sua própria contagem de réplicas sem que seu código precise ser movido para lugar nenhum:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Os nomes correspondem aos nomes dos arquivos sem a extensão — o mesmo nome sob o qual a função é montada.
Um nome que o bundle não contenha **falha a inicialização**, e o erro lista
os nomes que ele de fato contém. Um processo configurado para uma única função existe para essa
função, portanto um erro de digitação que silenciosamente não servisse nada seria o pior cenário
possível.

## Cron e tarefas em segundo plano

Ambos já são seguros para executar em mais de um processo: o agendador do cron reivindica
cada par `(job, slot)` no banco de dados, e a fila de jobs reivindica linhas com
`FOR UPDATE SKIP LOCKED`. Assim, a `api` continua executando ambos por padrão e uma divisão
em dois serviços fica completa sem a necessidade de um terceiro container.

Adicione um processo `worker` quando quiser tirar o trabalho agendado do caminho da requisição HTTP, e
desative-o na API:

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

Um processo `functions` nunca executa nenhum dos dois. Ele é escalado pela carga de requisições e
substituído quando necessário, e atribuir a ele tarefas agendadas faria com que sua contagem de réplicas
significasse algo que não deveria.

Observe que `rebase.jobs.enqueue` continua funcionando em qualquer lugar, inclusive em um processo
que não executa workers — enfileirar é uma gravação, executar é um loop de polling, e
apenas a segunda operação é o que uma role desativa.

## O que a divisão não oferece

**Limites de taxa compartilhados, a menos que configurados.** O armazenamento padrão é por processo, portanto
N processos multiplicam a cota de cada chamador por N sem nenhum aviso em log
informando isso. Defina `REBASE_RATE_LIMIT_STORE=sql` em todos os processos que servem HTTP — ele
faz a contagem no Postgres, garantindo que o limite seja o mesmo, independentemente do número de réplicas.
(O Helm chart define isso automaticamente e se recusa a renderizar uma topologia multiprocesso
que permaneça em `memory`.)

**Canais entre instâncias.** O broadcast e a presença usam um barramento em memória por
padrão, o qual não atravessa processos. Esta é uma questão de *número de réplicas*
e não necessariamente de divisão de processos — é igualmente verdade para uma implantação de papel único
escalada para três —, portanto defina `REALTIME_CHANNEL_BUS=postgres` (ou `realtime.bus` na
configuração) sempre que mais de um processo servir websockets.

**Escala até zero (Scale to zero).** Nada aqui reduz um processo a zero ou inicializa um
sob demanda. Essa é uma capacidade da plataforma, não do runtime.

## Fazendo deploy de uma unidade individualmente

Tudo o que foi descrito acima divide *onde o trabalho é executado*. Tudo ainda é distribuído como uma
única build: uma imagem, um bundle, atualizados juntos. Esse é o padrão ideal, e
a maioria das implantações deve permanecer assim.

Uma unidade também pode ser mantida em uma build própria — uma correção em uma função que não
reinicia a API:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.20.0"     # this unit only; the rest stay on the release-wide tag
```

Geralmente, apenas a tag vale a pena fixar: o repositório é herdado, portanto trata-se de
um projeto e uma imagem com apenas uma unidade alterada. `bundleUrl` faz o mesmo trabalho
quando `bundle.mode: url`.

### A regra

Duas unidades em builds diferentes representam dois conjuntos de coleções contra **um**
único banco de dados, e apenas uma unidade o provisiona. Portanto:

> **A unidade dona do schema é atualizada primeiro. Uma unidade pode ficar para trás;
> ela nunca deve estar à frente.**

Essa unidade é o Job de migração ou a `api` quando o Job estiver desativado. Uma unidade rodando
*à frente* do schema faz consultas a colunas que ainda não existem e depende de políticas RLS
que ninguém aplicou — o primeiro caso é um erro SQL em uma rota, o segundo é um
resultado vazio com status 200. Uma unidade rodando *atrás* é o estado comum de qualquer
rollout em andamento.

### O que faz essa verificação

O processo responsável pelo provisionamento registra no banco de dados a versão do schema que aplicou.
Todos os outros processos calculam sua própria versão a partir das coleções carregadas e
as comparam. Em caso de divergência, um aviso é emitido, identificando ambas as versões:

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v1:6f2a…, this process v1:91cd…).
```

Ele emite um aviso e continua servindo, porque durante um rollout essa divergência é *esperada* —
as unidades que ainda não foram atualizadas devem mesmo estar atrás. Defina
`REBASE_REQUIRE_SCHEMA_MATCH=true` (ou `sharedState.requireSchemaMatch` no
chart) para recusar a inicialização caso prefira uma implantação que deixe de responder
a responder de forma incorreta.

Ambos os lados dessa comparação são **calculados**, nunca lidos a partir de um manifesto. Uma
versão que uma build declara sobre si mesma não é evidência de que o banco de dados concorde
com ela.

Nada verifica a *direção* — a versão do schema é um hash, portanto é possível identificar que os
dois divergem, mas nunca qual está à frente. É por isso que a ordem do rollout é uma
regra a ser seguida, e não algo que o runtime possa impor.

## Atualização

Sem mudanças: cada processo executa a mesma imagem publicada, portanto uma atualização é a mesma
alteração de tag em cada um deles. Atualize a `api` por último caso queira que o
provisionamento do schema ocorra em relação à nova versão primeiro — embora, na prática, a
ordem não importe, pois a etapa do schema é aditiva e idempotente.

## Relacionado

- [Guia de Implantação](/docs/getting-started/deployment/) — a implantação em processo único que este documento divide
- [Ambiente e Configuração](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` e `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — uma implantação por role

---
