---
sourceHash: f1296ae912e0725e
title: Dividindo em vários processos
sidebar_label: Processos Divididos
description: Execute um único bundle como vários processos cooperativos — uma API, uma camada de functions, um worker — a partir da mesma imagem de runtime publicada, para que uma função customizada pesada deixe de competir com a API de dados.
---

## Visão Geral

Uma implantação do Rebase normalmente consiste em um único processo servindo tudo: a API de dados,
autenticação, armazenamento, suas funções personalizadas, cron e a fila de jobs. Esse é o formato
ideal para quase todas as implantações e continua sendo o padrão.

Quando ele deixa de ser o formato ideal — uma função personalizada que sobrecarrega o event loop,
uma camada de funções que precisa escalar ou reiniciar independentemente da API — você pode
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
| `/api/admin` (incluindo logs e o editor de schema) | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | encaminha (ver abaixo) | ✅ | — |
| `/api/admin/cron` (a interface de administração) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Atende websockets, consome eventos de alteração | ✅ | ✅ | — | — |
| Cria o schema na inicialização | ✅ | ✅ | — | — |
| Executa o agendador de cron | ✅ | ✅ | — | ✅ |
| Executa workers da fila de jobs | ✅ | ✅ | — | ✅ |

Health e métricas estão em todas as roles sem exceção; `/metrics` responde apenas com `REBASE_METRICS=true`. Um processo que um
orquestrador não consegue sondar é um processo que ele não pode atualizar gradualmente.

`GET /api/auth/config`,
o que a tela de login lê, segue o restante de `/api/auth`: apenas `api` e
`all` o atendem.

O Realtime está na lista porque tem um custo quer alguém o utilize ou
não: um processo que consome eventos de alteração mantém uma conexão `LISTEN` fora
do pool durante todo o tempo em que estiver em execução e instala os triggers de captura na inicialização. Apenas
um processo que atende websockets tem destinatários para entregar eventos, portanto as duas roles que
não atendem nenhum não fazem nenhuma dessas ações. **As gravações feitas por esses processos ainda são ouvidas.** Com
a captura de alterações ativada, a captura é feita por triggers do banco de dados, de modo que uma alteração é publicada pelo
banco de dados em vez de pelo processo que a realizou. Com a captura desativada
(`REALTIME_CDC=off`, ou `auto` em fallback porque a role do banco de dados não pode
criar triggers), um processo `worker` ou `functions` anuncia cada uma de suas próprias
gravações no canal entre instâncias, sem manter uma conexão
`LISTEN`. De qualquer forma, uma função que grava uma linha ainda acorda todos os
assinantes na `api`.

Defina o mesmo `REALTIME_CDC` para todos os processos. Um processo proprietário do schema
com `REALTIME_CDC=off` remove os triggers de captura na inicialização, e uma `api`
ainda configurada como `auto` ficaria escutando alterações que ninguém anuncia.

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
ser aceito pelo outro. Um processo com `REBASE_FUNCTIONS_UPSTREAM` e sem
`REBASE_SERVICE_KEY` se recusa a inicializar: suas próprias chamadas `rebase.functions.invoke(...)`,
vindas de um hook ou job de cron, chegam ao processo de functions com essa chave.

## Mantendo as mesmas URLs

`REBASE_FUNCTIONS_UPSTREAM` instrui o processo `api` a encaminhar `/api/functions/*`
para o processo de functions em vez de atendê-lo diretamente. Deve ser uma URL `http://` ou
`https://`; qualquer outra coisa impede a inicialização. Apenas `api` e `worker` o leem
(consulte [Cron e jobs em segundo plano](#cron-e-jobs-em-segundo-plano) para o worker). Clientes, SDKs gerados e chaves
de API enxergam exatamente a mesma superfície que viam antes da divisão, portanto nenhum código da aplicação
muda e você não precisa configurar um proxy reverso para testar isso.

Uma implantação em produção pode preferir rotear o caminho diretamente no ingress, caso
em que você deve deixar `REBASE_FUNCTIONS_UPSTREAM` indefinido — o processo `api` então
responderá 404 para esses caminhos e o proxy à frente decidirá para onde eles vão.

### Saltos de proxy

Quando a API encaminha a requisição, ela anexa o endereço do chamador ao `X-Forwarded-For`. Isso
faz com que o processo de functions fique atrás de **mais um salto de proxy** do que a API,
e ele precisa ser informado disso:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` é o número de proxies reversos que você realmente executa na frente
de um processo. Cada um anexa o endereço que viu ao `X-Forwarded-For`, de modo que o
cliente real seja a enésima entrada a partir da direita; tudo o que estiver mais à esquerda foi
fornecido pelo cliente e é ignorado, o que impede que um chamador falsifique o cabeçalho para
burlar limites de taxa (rate limits). O padrão é `0` — nenhum proxy confiável.

Se configurar isso incorretamente, nada quebrará de forma visível: os limitadores de taxa no processo de functions
associarão todas as requisições ao endereço do contêiner da API, fazendo com que todos os seus clientes compartilhem
o mesmo limite, e o IP registrado em cada evento de autenticação será o mesmo.

## Um único processo é o proprietário do schema

Exatamente um processo em uma implantação dividida cria tabelas e aplica políticas de RLS
na inicialização, e esse é o processo `api` (ou `all`). Todos os outros processos devem
definir:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Isso é **obrigatório**, não opcional: um processo `functions` ou `worker` deixado com o
padrão se recusará a iniciar e exibirá uma mensagem informando o motivo. `CREATE … IF NOT EXISTS` lê o catálogo
e depois grava nele em duas etapas separadas, portanto processos inicializando juntos
colidem — e uma implantação onde vários deles disputam para provisionar o mesmo
schema não é algo que alguém planejou.

Em um
[servidor customizado](/docs/backend/custom-server/), a mesma decisão corresponde à opção
`provision` de `createRebaseBackend`: `true` no processo que é proprietário do
schema e `{ collections: false, realtime: false }` em todos os outros, o que
ainda mantém as tabelas internas do framework. `REBASE_MIGRATE_ON_BOOT=none` desativa o
schema de tabelas lá também. O trabalho em segundo plano é decidido da mesma forma:
um processo que nunca chama `start()` não executa o agendador de cron nem workers de jobs,
e aquele que chama executa aqueles concedidos pela sua opção `ownership`.

## Servindo uma função por processo

Um processo pode servir um subconjunto nomeado, que é como uma função onerosa recebe sua
própria contagem de réplicas sem que seu código precise ser movido para outro lugar:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Os nomes correspondem aos nomes dos arquivos sem a extensão — o mesmo nome sob o qual a função está
montada. Um nome que não esteja contido no bundle **falha a inicialização**, e o erro lista
os nomes que ele de fato contém. Um processo configurado para uma única função existe exclusivamente para essa
função, portanto um erro de digitação que silenciosamente não atendesse a nada seria o pior resultado
possível.

## Cron e jobs em segundo plano

Ambos já são seguros para execução em mais de um processo: o agendador de cron reivindica
cada par `(job, slot)` no banco de dados, e a fila de jobs reivindica linhas com
`FOR UPDATE SKIP LOCKED`. Dessa forma, o `api` continua executando ambos por padrão e uma divisão em dois
serviços fica completa sem a necessidade de um terceiro contêiner.

Adicione um processo `worker` quando quiser tarefas agendadas fora do caminho das requisições e
desative-as na API:

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

Um job que é movido para um worker mantém `rebase.dataAsAdmin`, `rebase.sql`,
`rebase.storage` e `rebase.email`, que se comunicam diretamente com o banco de dados, os buckets e
o servidor de e-mail. Ele também mantém:

- **`rebase.admin`** (usuários, roles, redefinições de senha) **e `rebase.cron`.** Um
  worker não expõe nenhuma interface de administração em sua porta, mas mantém esses dois no próprio processo,
  apenas para seus próprios jobs.
- **`rebase.functions`, com `REBASE_FUNCTIONS_UPSTREAM`.** Um worker não atende a
  functions. Com o upstream configurado, suas próprias chamadas `rebase.functions.invoke(...)`
  são encaminhadas para o processo de functions, onde a função visualiza a
  chamada como o serviço. O worker ainda não responde a nada em `/api/functions`
  em sua porta. O worker precisa da `REBASE_SERVICE_KEY` da implantação para isso,
  assim como a `api`.

Ele perde `rebase.auth`: esses são fluxos de login de usuários, e um worker
não atende a nenhum deles. Para operações de conta a partir de um job, use `rebase.admin`. Ele também perde o
restante da API de administração (backups, logs, o editor de schema e assim por diante) e
`rebase.functions` quando nenhum upstream está configurado. Uma chamada para qualquer um desses responde com
`404 NOT_FOUND`, especificando a interface desativada e o que fazer em alternativa.

Um processo `functions` nunca executa nenhum dos dois. Ele é escalado de acordo com a carga de requisições e
substituído livremente; atribuir a ele trabalho agendado faria com que sua contagem de réplicas significasse
algo indesejado.

Observe que o enfileiramento — `jobQueue.enqueue`, o `enqueue` de uma fila declarada, o
`publish` de um tópico — continua funcionando em todos os lugares, inclusive em um processo que não executa
workers — enfileirar é uma operação de escrita, executar é um loop de sondagem (polling), e apenas
a segunda é desativada por uma role.

## O que a divisão não oferece

**Limites de taxa (rate limits) compartilhados, a menos que você solicite.** O armazenamento padrão é por processo, de modo que N
processos multiplicam o limite de cada chamador por N, sem nada nos logs alertando
sobre isso. Defina `REBASE_RATE_LIMIT_STORE=sql` em todos os processos que atendem HTTP — a contagem
é feita no Postgres, garantindo que o limite seja mantido independentemente do número de réplicas.
(O Helm chart faz essa configuração para você e se recusa a renderizar uma topologia de múltiplos processos
que o mantenha em `memory`.)

**Canais entre instâncias.** O broadcast e a presença usam um barramento em memória por
padrão, que não atravessa processos. Esta é uma questão de *contagem de réplicas* e
não da divisão em si — o mesmo vale para uma implantação de role única
escalada para três réplicas —, portanto defina `REALTIME_CHANNEL_BUS=postgres` (ou `realtime.bus` na
configuração) sempre que mais de um processo atender websockets.

**Escala até zero.** Nada aqui reduz um processo a zero ou inicializa um
sob demanda. Essa é uma funcionalidade da plataforma de hospedagem, não do runtime.

Tudo o mais que um processo mantém isolado para si está em uma lista:
[Executando mais de uma instância](/docs/deployment/multiple-instances/).

## Lançando uma unidade de forma independente

Tudo o que foi descrito acima divide *onde o trabalho é executado*. Tudo ainda é distribuído como uma
única compilação: uma imagem, um bundle, atualizados juntos. Esse é o padrão correto e
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

Normalmente, apenas a tag vale a pena fixar: o repositório é herdado, portanto trata-se de
um único projeto e uma única imagem com uma unidade modificada. `bundleUrl` faz o mesmo trabalho
quando `bundle.mode: url`.

### A regra

Duas unidades em compilações diferentes representam dois conjuntos de tabelas em **um único**
banco de dados, e apenas uma unidade o provisiona. Portanto:

> **A unidade proprietária do schema é atualizada primeiro. Uma unidade pode ficar para trás; ela nunca deve
> estar à frente.**

Esse é o Job de migração, ou a `api` quando o Job está desativado. Uma unidade executando
*à frente* do schema consulta colunas que ainda não existem e depende de políticas de RLS
que ninguém aplicou — o primeiro caso resulta em um erro de SQL em uma rota, o segundo em um
resultado vazio com status 200. Uma unidade executando *atrás* é o estado normal de qualquer
rollout em andamento.

### O que faz a verificação

O processo que provisiona registra no banco de dados a versão do schema que aplicou.
Todos os outros processos calculam sua própria versão a partir das tabelas que carregaram e
comparam. Se houver divergência, ele emite um aviso informando ambas:

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v2:6f2a…, this process v2:91cd…).
```

Ele emite um aviso e continua atendendo, porque durante um rollout essa divergência é *esperada* —
as unidades que ainda não foram atualizadas devem mesmo estar defasadas. Defina
`REBASE_REQUIRE_SCHEMA_MATCH=true` (ou `sharedState.requireSchemaMatch` no
chart) para recusar a inicialização caso prefira não atender a nenhuma requisição
em vez de atender incorretamente.

Ambos os lados dessa comparação são **computados**, nunca lidos de um manifesto. A
versão que uma compilação declara sobre si mesma não é prova de que o banco de dados concorda
com ela.

Nada verifica a *direção* — a versão do schema é um hash, portanto pode informar que os
dois divergem, mas nunca qual está à frente. É isso que torna a ordem de rollout uma
regra que você deve seguir, em vez de algo que o runtime possa impor.

## Atualizando

Inalterado: todo processo executa a mesma imagem publicada, portanto uma atualização consiste na mesma
alteração de tag em cada um deles. Atualize o processo que é proprietário do schema — a `api`
ou o Job de migração — primeiro, para que o schema da nova versão já esteja pronto antes
que os outros processos executem contra ele: uma unidade pode ficar para trás, nunca à frente (consulte
[A regra](#a-regra)).

## Relacionados

- [Guia de Implantação](/docs/getting-started/deployment/) — a implantação de processo único que este documento divide
- [Ambiente e Configuração](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` e `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — um deployment por role
