---
sourceHash: 1268d4bf9843a74b
title: Dividindo em vários processos
sidebar_label: Dividir Processos
description: Execute um bundle como vários processos cooperativos — uma API, uma camada de funções, um worker — a partir da mesma imagem de runtime publicada, para que uma função personalizada pesada deixe de competir com a API de dados.
---

## Visão Geral

Uma implantação do Rebase é normalmente um processo servindo tudo: a API de dados,
autenticação, armazenamento, suas funções personalizadas, cron e a fila de jobs. Esse é o
formato ideal para quase todas as implantações e continua sendo o padrão.

Quando deixa de ser o formato ideal — uma função personalizada que sobrecarrega o event loop,
uma camada de funções que deve escalar ou reiniciar independentemente da API — você pode
inicializar **a mesma imagem e o mesmo bundle** várias vezes e fazer com que cada
processo atenda a uma parte diferente do projeto. Não há nada de novo para construir e
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
| `/api/admin`, `/api/logs`, the schema editor | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | encaminha (veja abaixo) | ✅ | — |
| `/api/cron` (a interface administrativa) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Serve websockets, consome eventos de alteração | ✅ | ✅ | — | — |
| Cria o schema na inicialização | ✅ | ✅ | — | — |
| Executa o agendador de cron | ✅ | ✅ | — | ✅ |
| Executa workers da fila de jobs | ✅ | ✅ | — | ✅ |

Verificações de integridade (health) e métricas estão presentes em todas as roles, sem exceção. Um
processo que um orquestrador não consegue sondar é um processo que ele não pode atualizar.

O Realtime está na lista porque tem um custo, quer alguém o use ou não: um processo
que consome eventos de alteração mantém uma conexão `LISTEN` fora do pool enquanto estiver em
execução e instala os gatilhos (triggers) de captura na inicialização. Apenas um processo que serve
websockets tem destinatários para entregar eventos, portanto, as duas roles que não servem
nenhum não fazem nenhum dos dois. **As gravações feitas por esses processos ainda são detectadas** —
a captura é feita por triggers de banco de dados, portanto, uma alteração é publicada pelo banco de
dados em vez do processo específico que a realizou. Uma função que grava uma linha ainda acorda
todos os assinantes na `api`.

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

Ambos os processos precisam do mesmo `DATABASE_URL`, do mesmo `JWT_SECRET` e da mesma
`REBASE_SERVICE_KEY` — eles são uma única implantação, e um token gerado por um deve
ser aceito pelo outro.

## Mantendo as URLs iguais

`REBASE_FUNCTIONS_UPSTREAM` instrui o processo `api` a encaminhar `/api/functions/*`
para o processo de funções em vez de atendê-lo diretamente. Clientes, SDKs gerados e
chaves de API enxergam exatamente a mesma superfície de antes da divisão, portanto nenhum
código de aplicação muda e você não precisa configurar um proxy reverso para testar.

Uma implantação de produção pode preferir rotear o caminho diretamente em seu ingress;
nesse caso, deixe `REBASE_FUNCTIONS_UPSTREAM` não definido — o processo `api` então
responderá 404 para esses caminhos e o proxy à frente decidirá para onde eles vão.

### Saltos de proxy

Quando a API encaminha, ela anexa o endereço do chamador ao `X-Forwarded-For`. Isso
faz com que o processo de funções fique atrás de **mais um salto de proxy** do que a
API, e ele precisa ser informado disso:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` é o número de proxies reversos que você realmente executa na
frente de um processo. Cada um anexa o endereço que viu ao `X-Forwarded-For`, de modo
que o cliente real é a N-ésima entrada a partir da direita; tudo o que estiver mais à
esquerda é fornecido pelo cliente e ignorado, o que impede que um chamador falsifique o
cabeçalho para burlar as chaves de rate limit. O padrão é `0` — nenhum proxy confiável.

Se você errar nisso, nada quebrará visivelmente: os rate limiters no processo de funções
associarão cada requisição ao endereço do contêiner da API, fazendo com que todos os seus
chamadores compartilhem o mesmo limite (bucket), e o IP registrado em cada evento de
autenticação será sempre o mesmo.

## Um processo é o proprietário do schema

Exatamente um processo em uma implantação dividida cria tabelas e aplica políticas RLS
na inicialização, e esse é o processo `api` (ou `all`). Todos os outros processos devem
definir:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Isso é **obrigatório**, não consultivo: um processo `functions` ou `worker` deixado com
o valor padrão se recusa a iniciar e informa o motivo. O `CREATE … IF NOT EXISTS` lê o
catálogo e depois escreve nele em duas etapas separadas, de modo que processos
inicializando juntos colidem — e uma implantação em que vários deles competem para
provisionar o mesmo schema não é algo que alguém tenha planejado.

## Servindo uma função por processo

Um processo pode atender a um subconjunto específico por nome, que é como uma função
onerosa ganha sua própria contagem de réplicas sem que seu código precise ser movido
para outro lugar:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Os nomes são os nomes dos arquivos sem a extensão — o mesmo nome sob o qual a função
é montada. Um nome que o bundle não contenha **falha a inicialização**, e o erro lista
os nomes que ele realmente contém. Um processo configurado para uma função existe para
essa função, portanto, um erro de digitação que silenciosamente não atendesse a nada
seria o pior resultado possível.

## Cron e jobs em segundo plano

Ambos já são seguros para executar em mais de um processo: o agendador de cron reivindica
cada par `(job, slot)` no banco de dados, e a fila de jobs reivindica linhas com
`FOR UPDATE SKIP LOCKED`. Portanto, o `api` continua executando ambos por padrão e uma
divisão em dois serviços fica completa sem a necessidade de um terceiro contêiner.

Adicione um processo `worker` quando quiser tirar o trabalho agendado do fluxo de requisições
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
```

Um processo `functions` nunca executa nenhum dos dois. Ele é escalado pela carga de
requisições e substituído à vontade, e atribuir trabalho agendado a ele faria com que
sua contagem de réplicas significasse algo indesejado.

Observe que `rebase.jobs.enqueue` continua funcionando em todos os lugares, inclusive
em um processo que não executa workers — enfileirar é uma gravação, executar é um loop
de sondagem (polling), e apenas o segundo é o que uma role desativa.

## O que a divisão não oferece

**Rate limits compartilhados, a menos que você solicite.** O armazenamento padrão é por
processo, portanto, N processos multiplicam o limite de cada chamador por N, sem nada nos
logs alertando sobre isso. Defina `REBASE_RATE_LIMIT_STORE=sql` em todos os processos que
atendem HTTP — a contagem é feita no Postgres, garantindo que o limite seja o mesmo
independentemente de quantas réplicas existirem. (O Helm chart define isso para você e se
recusa a renderizar uma topologia multiprocesso que mantenha essa opção em `memory`.)

**Canais entre instâncias.** Broadcast e presence usam um barramento em memória por
padrão, que não atravessa processos. Esta é uma questão de *contagem de réplicas* em vez
de uma questão de divisão — é igualmente válido para uma implantação de role única
escalada para três — portanto, defina `REALTIME_CHANNEL_BUS=postgres` (ou `realtime.bus` na
configuração) sempre que mais de um processo atender websockets.

**Escalonamento a zero (Scale to zero).** Nada aqui reduz um processo a zero ou inicializa
um sob demanda. Isso é uma capacidade da plataforma, não do runtime.

## Fazendo o release de uma unidade de forma independente

Tudo acima divide *onde o trabalho é executado*. Tudo ainda é entregue como uma única
compilação: uma imagem, um bundle, atualizados juntos. Esse é o padrão correto e a maioria
das implantações deve permanecer assim.

Uma unidade também pode ser mantida em uma compilação própria — uma correção de função que
não reinicia a API:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.20.0"     # this unit only; the rest stay on the release-wide tag
```

Geralmente, vale a pena fixar apenas a tag: o repositório é herdado, então este é um
projeto e uma imagem com apenas uma unidade alterada. `bundleUrl` faz o mesmo trabalho
quando `bundle.mode: url`.

### A regra

Duas unidades em compilações diferentes são dois conjuntos de collections em **um**
único banco de dados, e apenas uma unidade o provisiona. Portanto:

> **A unidade proprietária do schema é atualizada primeiro. Uma unidade pode ficar para
> trás; ela nunca deve estar à frente.**

Essa unidade é o Job de migração ou a `api` quando o Job está desativado. Uma unidade
executando *à frente* do schema consulta colunas que ainda não existem e depende de
políticas RLS que ninguém aplicou — o primeiro caso resulta em um erro de SQL em uma rota,
o segundo em um resultado vazio com status 200. Uma unidade executando *atrás* é o estado
comum de qualquer rollout em andamento.

### O que faz essa verificação

O processo que provisiona registra no banco de dados a versão do schema que ele aplicou.
Todos os outros processos calculam sua própria versão a partir das collections carregadas
e as comparam. Em caso de divergência, ele avisa, especificando ambas:

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v1:6f2a…, this process v1:91cd…).
```

Ele emite um aviso e atende às requisições, porque durante um rollout essa divergência é
*esperada* — as unidades que ainda não foram atualizadas devem ficar para trás. Defina
`REBASE_REQUIRE_SCHEMA_MATCH=true` (ou `sharedState.requireSchemaMatch` no chart) para
recusar a inicialização, em uma implantação que prefere não atender a responder de forma
incorreta.

Ambos os lados dessa comparação são **calculados**, nunca lidos a partir de um manifesto.
Uma versão que uma compilação declara sobre si mesma não é evidência de que o banco de
dados concorda com ela.

Nada verifica a *direção* — uma versão de schema é um hash, portanto pode indicar que os
dois divergem, mas nunca qual está à frente. É isso que torna a ordem de rollout uma
regra que você deve seguir, e não algo que o runtime possa impor.

## Atualização

Sem alterações: cada processo executa a mesma imagem publicada, portanto, uma
atualização consiste na mesma alteração de tag em cada um deles. Atualize o `api` por
último se quiser que o provisionamento do schema ocorra em relação à nova versão
primeiro — embora, na prática, a ordem não importe, pois a etapa do schema é aditiva e
idempotente.

## Relacionado

- [Deployment Guide](/docs/getting-started/deployment/) — a implantação de processo único que este documento divide
- [Environment & Configuration](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` e `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — uma implantação por role

---
