---
sourceHash: a0e8bb4006af2399
title: Divisão em vários processos
sidebar_label: Processos Divididos
description: Execute um bundle como vários processos cooperantes — uma API, uma camada de funções, um worker — a partir da mesma imagem de runtime publicada, para que uma função customizada pesada deixe de concorrer com a API de dados.
---

## Visão geral

Uma implantação do Rebase normalmente consiste em um único processo servindo tudo: a API de dados, autenticação, armazenamento, suas funções customizadas, cron e a fila de jobs. Esse é o formato ideal para quase todas as implantações e continua sendo o padrão.

Quando isso deixa de ser o formato ideal — uma função customizada que trava o event loop, uma camada de funções que deve escalar ou reiniciar independentemente da API —, você pode inicializar **a mesma imagem e o mesmo bundle** várias vezes e fazer com que cada processo sirva uma parte diferente do projeto. Não há nada de novo para construir e nada que o cliente precise saber: as URLs não mudam.

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
| `/api/cron` (a superfície de administração) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Serve websockets, consome eventos de alteração | ✅ | ✅ | — | — |
| Cria o schema na inicialização | ✅ | ✅ | — | — |
| Executa o agendador do cron | ✅ | ✅ | — | ✅ |
| Executa os workers da fila de jobs | ✅ | ✅ | — | ✅ |

Health e métricas estão em todas as roles, sem exceção. Um processo que um orquestrador não consegue sondar é um processo que ele não consegue atualizar.

O Realtime está na lista porque tem um custo, quer alguém o utilize ou não: um processo que consome eventos de alteração mantém uma conexão `LISTEN` fora do pool enquanto estiver em execução e instala os triggers de captura na inicialização. Apenas um processo que serve websockets tem alguém para quem entregar, portanto as duas roles que não servem nenhum não fazem nenhuma das duas coisas. **As gravações feitas por esses processos ainda são detectadas** — a captura é feita por triggers de banco de dados, de modo que uma alteração é publicada pelo banco de dados em vez de qualquer processo que a tenha feito. Uma função que grava uma linha ainda acorda todos os assinantes na `api`.

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

Ambos os processos precisam da mesma `DATABASE_URL`, do mesmo `JWT_SECRET` e da mesma `REBASE_SERVICE_KEY` — eles são uma única implantação, e um token gerado por um deve ser aceito pelo outro.

## Mantendo as mesmas URLs

A variável `REBASE_FUNCTIONS_UPSTREAM` instrui o processo `api` a encaminhar `/api/functions/*` para o processo de funções em vez de servi-lo. Clientes, SDKs gerados e chaves de API enxergam exatamente a mesma superfície que viam antes da divisão, portanto nenhum código de aplicação muda e você não precisa configurar um proxy reverso para testar isso.

Uma implantação de produção pode preferir rotear o caminho no seu ingress; nesse caso, deixe `REBASE_FUNCTIONS_UPSTREAM` não definido — o processo `api` então responderá 404 para esses caminhos e o proxy à frente decidirá para onde eles vão.

### Saltos de proxy

Quando a API faz o encaminhamento, ela anexa o endereço do chamador a `X-Forwarded-For`. Isso faz com que o processo de funções fique **um salto de proxy a mais** atrás do que a API, e ele precisa ser informado disso:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

O `TRUSTED_PROXY_HOPS` é o número de proxies reversos que você realmente executa na frente de um processo. Cada um anexa o endereço que viu a `X-Forwarded-For`, de modo que o cliente real é a N-ésima entrada a partir da direita; tudo o que estiver mais à esquerda é fornecido pelo cliente e ignorado, o que impede que um chamador falsifique o cabeçalho para burlar as chaves de rate limit. O padrão é `0` — nenhum proxy confiável.

Se você errar isso, nada quebra visivelmente: os rate limiters no processo de funções associam cada requisição ao endereço do container da API, fazendo com que todos os seus chamadores compartilhem o mesmo limite (bucket), e o IP registrado em cada evento de autenticação será sempre o mesmo.

## Um processo é o dono do schema

Exatamente um processo em uma implantação dividida cria tabelas e aplica políticas RLS na inicialização, e esse é o processo `api` (ou `all`). Todos os outros processos devem definir:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Isso é **obrigatório**, não recomendação: um processo `functions` ou `worker` deixado no valor padrão se recusa a iniciar, e emite um aviso sobre isso. O comando `CREATE … IF NOT EXISTS` lê o catálogo e depois escreve nele como duas etapas separadas, portanto processos inicializando juntos colidem — e uma implantação em que vários processos disputam para provisionar o mesmo schema não é algo planejado por ninguém.

## Servindo uma função por processo

Um processo pode servir um subconjunto nomeado, que é como uma função com alto consumo obtém sua própria contagem de réplicas sem que seu código precise ser movido para outro lugar:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Os nomes são os nomes dos arquivos sem a extensão — o mesmo nome sob o qual a função é montada. Um nome que o bundle não contenha **falha a inicialização**, e o erro lista os nomes que ele de fato contém. Um processo configurado para uma única função existe para essa função, portanto um erro de digitação que silenciosamente não servisse nada seria o pior resultado possível.

## Cron e jobs em segundo plano

Ambos já são seguros para execução em mais de um processo: o agendador do cron reivindica cada par `(job, slot)` no banco de dados, e a fila de jobs reivindica linhas com `FOR UPDATE SKIP LOCKED`. Portanto, a `api` continua executando ambos por padrão e uma divisão em dois serviços fica completa sem um terceiro container.

Adicione um processo `worker` quando quiser trabalho agendado fora do caminho da requisição e desative-o na API:

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

Um processo `functions` nunca executa nenhum dos dois. Ele é escalado pela carga de requisições e substituído à vontade, e atribuir a ele trabalho agendado faria com que sua contagem de réplicas significasse algo que não deveria.

Observe que o `rebase.jobs.enqueue` continua funcionando em qualquer lugar, inclusive em um processo que não executa workers — enfileirar é uma gravação, executar é um loop de sondagem (polling), e apenas o segundo é o que uma role desativa.

## O que a divisão não oferece

**Rate limits compartilhados, a menos que você solicite.** O armazenamento padrão é por processo, então N processos multiplicam o limite de cada chamador por N, sem nada nos logs para avisar sobre isso. Defina `REBASE_RATE_LIMIT_STORE=sql` em cada processo que serve HTTP — a contagem é feita no Postgres, garantindo que o limite seja o mesmo independentemente de quantas réplicas existam. (O Helm chart define isso para você e se recusa a renderizar uma topologia multiprocesso que permaneça em `memory`.)

**Canais entre instâncias (Cross-instance channels).** Broadcast e presence usam um barramento em memória por padrão, que não atravessa processos. Esta é uma questão de *contagem de réplicas* e não de divisão — é igualmente verdade para uma implantação de role única escalada para três —, portanto defina `REALTIME_CHANNEL_BUS=postgres` (ou `realtime.bus` na configuração) sempre que mais de um processo servir websockets.

**Escalar para zero (Scale to zero).** Nada aqui reduz um processo a zero ou inicializa um sob demanda. Essa é uma capacidade da plataforma, não do runtime.

## Lançando uma unidade de forma independente

Tudo o que foi visto acima divide *onde o trabalho é executado*. Tudo ainda é entregue como uma única build: uma imagem, um bundle, atualizados juntos. Esse é o padrão correto, e a maioria das implantações deve permanecer assim.

Uma unidade também pode ser mantida em uma build própria — uma correção de função que não reinicia a API:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.21.0"     # this unit only; the rest stay on the release-wide tag
```

Geralmente, vale a pena fixar apenas a tag: o repositório é herdado, então trata-se de um projeto e uma imagem com uma unidade modificada. O `bundleUrl` cumpre a mesma função quando `bundle.mode: url`.

### A regra

Duas unidades em builds diferentes são dois conjuntos de collections contra **um único** banco de dados, e apenas uma unidade o provisiona. Portanto:

> **A unidade dona do schema é atualizada primeiro. Uma unidade pode ficar para trás; ela nunca deve ficar à frente.**

Essa unidade é o Job de migração, ou a `api` quando o Job estiver desativado. Uma unidade executando *à frente* do schema consulta colunas que ainda não existem e depende de políticas RLS que ninguém aplicou — o primeiro caso resulta em um erro de SQL em uma rota, o segundo em um resultado vazio com status 200. Uma unidade executando *atrás* é o estado comum de qualquer rollout em andamento.

### O que faz essa verificação

O processo que realiza o provisionamento registra no banco de dados a versão do schema que aplicou. Todos os outros processos calculam sua própria versão a partir das collections carregadas e realizam a comparação. Em caso de divergência, um aviso é emitido, identificando ambas:

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v1:6f2a…, this process v1:91cd…).
```

Ele emite um aviso e continua servindo, porque durante um rollout essa divergência é *esperada* — supõe-se que as unidades que ainda não foram atualizadas estejam defasadas. Defina `REBASE_REQUIRE_SCHEMA_MATCH=true` (ou `sharedState.requireSchemaMatch` no chart) para recusar a inicialização, em uma implantação que prefere não servir nada a servir dados incorretos.

Ambos os lados dessa comparação são **calculados**, nunca lidos de um manifesto. A versão que uma build declara sobre si mesma não é evidência de que o banco de dados concorda com ela.

Nada verifica a *direção* — a versão do schema é um hash, portanto ela pode indicar que os dois discordam, mas nunca qual deles está à frente. É isso que torna a ordem de rollout uma regra que você deve seguir, e não algo que o runtime possa impor.

## Atualização

Inalterado: cada processo executa a mesma imagem publicada, portanto um upgrade consiste na mesma alteração de tag em cada um deles. Atualize a `api` por último se quiser que o provisionamento do schema ocorra em relação à nova versão primeiro — embora, na prática, a ordem não importe, pois a etapa do schema é aditiva e idempotente.

## Relacionado

- [Guia de Implantação](/docs/getting-started/deployment/) — a implantação de processo único que este documento divide
- [Ambiente e Configuração](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` e `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — um deployment por role
