---
sourceHash: d156ac95aebe2dab
title: Executando mais de uma instância
sidebar_label: Mais de uma instância
description: Cada parte de estado que um processo do Rebase mantém para si e a configuração que a compartilha — o que definir antes de uma segunda réplica, um rolling deploy ou uma implantação dividida receber tráfego.
---

## Visão geral

A maior parte de uma implantação do Rebase já reside no banco de dados: linhas, usuários e
sessões, chaves de API, a fila de jobs, reivindicações de cron, chaves de idempotência, histórico
de registros, os tokens do servidor OAuth do MCP. Um segundo processo apontado para o mesmo
banco de dados enxerga tudo isso.

Algumas coisas, não. Cada uma delas é por processo por padrão, porque um processo
é a implantação padrão e o compartilhamento tem um custo — uma tabela, uma gravação em bucket, uma
conexão com o banco de dados. Executar dois processos atrás de um balanceador de carga, fazer autoscaling
além de um ou realizar um rolling deploy que executa brevemente o antigo e o novo lado a lado
colocam você nesta página. O mesmo vale para uma [implantação dividida](/docs/deployment/split-processes/),
que por definição consiste em vários processos.

Revise a lista abaixo antes que a segunda receba tráfego. Nada nela
falha de forma evidente: cada item se manifesta como um limite aplicado três vezes a mais, um evento
que alguns clientes nunca veem ou uma página que mostra logs diferentes a cada atualização.

## Checklist

| O quê | Por processo por padrão | O que compartilha |
| --- | --- | --- |
| Segredos de assinatura | Gerados por processo em desenvolvimento | `JWT_SECRET` e `REBASE_SERVICE_KEY`, definidos explicitamente e **idênticos** em todos os lugares |
| Contadores de rate limit | Em memória | `REBASE_RATE_LIMIT_STORE=sql` |
| Endereço do cliente atrás de um proxy | `TRUSTED_PROXY_HOPS=0` | O número de proxies à frente, igual em todos os lugares |
| Assinaturas de tabelas | Compartilhado através do banco de dados quando o CDC está ativado | `REALTIME_CDC=auto` (o padrão) |
| Canais de broadcast e presença | Em memória | `REALTIME_CHANNEL_BUS=postgres` |
| Arquivos enviados (uploads), `STORAGE_TYPE=local` | O próprio disco da instância | S3 ou GCS, ou um volume compartilhado no diretório pai de `STORAGE_PATH` |
| Uploads retomáveis (TUS) em andamento | O disco da instância, em `STORAGE_PATH/.tus-uploads` | Um volume compartilhado em `STORAGE_PATH`, ou sessões persistentes (sticky sessions) |
| Transformações de imagem | Um cache interno no processo | `STORAGE_RENDITION_CACHE=true` |
| Logs Explorer | Um buffer circular das últimas 10.000 linhas | Nada — envie o stdout para um agregador de logs |
| Temporizadores de cron | Todo processo que executa o agendador | Reivindicado no banco de dados: uma execução por slot. `REBASE_CRON_SCHEDULER` define onde os temporizadores residem |
| Auditoria de RLS agendada | Todo processo que a possui | `REBASE_RLS_AUDIT=false` em todos, exceto um |
| O `index.html` de uma aplicação estática | Lido uma vez por processo | Reinicie cada instância quando a compilação (build) mudar |
| `/metrics` | Cada processo faz a sua própria contagem | Colete métricas (scrape) de cada instância |

As seções abaixo explicam o que cada item faz quando é deixado por processo.

## Segredos de assinatura

O `JWT_SECRET` assina cada sessão e o `REBASE_SERVICE_KEY` autentica
chamadas entre servidores (server-to-server). No desenvolvimento, cada processo gera o seu próprio quando não
estão definidos, portanto, um token emitido por um processo é recusado pelo próximo.
A produção já se recusa a iniciar sem o `JWT_SECRET` (sem o `REBASE_SERVICE_KEY`, ela inicia
sem nenhuma chave de serviço); o que importa com vários processos é
que cada um deles receba os **mesmos** valores — a partir de um único segredo, e não um por réplica.

## Rate limits e o endereço do cliente

Os limitadores de taxa (rate limiters) — a cota por chamador nas APIs de dados, armazenamento e funções,
e os limitadores de autenticação em login, redefinição de senha, códigos de uso único e
tentativas de MFA — contam em memória por padrão. Um processo não consegue ver quantos pares
ele possui; portanto, três réplicas no padrão aplicam três vezes cada limite. Defina
`REBASE_RATE_LIMIT_STORE=sql` para que os contadores fiquem no banco de dados.

Atrás de um balanceador de carga, o limitador também precisa do endereço real do cliente, que
chega no cabeçalho `X-Forwarded-For`. O `TRUSTED_PROXY_HOPS` indica quantos proxies devem ser ignorados;
no padrão `0`, cada requisição parece vir do balanceador de carga
e todos os clientes compartilham o mesmo bucket (cota). Consulte
[Configuração](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

**Assinaturas de tabelas** funcionam entre instâncias quando a captura de alterações
no nível do banco de dados (CDC) está ativada, o que ocorre por padrão (`REALTIME_CDC=auto`): o write-ahead
log (onde o banco de dados permite decodificação lógica) ou um trigger anuncia cada
gravação confirmada (commit), e o ouvinte (listener) de cada instância busca novamente os dados para seus próprios
assinantes. Instâncias em captura por WAL mantêm os triggers em vigor enquanto qualquer
instância ainda estiver escutando neles, de modo que uma réplica que recorreu aos triggers
nunca fique surda. Se o CDC estiver desativado, ou se `auto` não conseguir provisioná-lo (o log de inicialização
informa o motivo), uma assinatura verá apenas as gravações feitas por meio da instância à qual seu
socket está conectado. Consulte
[Realtime](/docs/backend/realtime-cdc/).

**Canais de broadcast e presença** ocorrem no processo, a menos que um barramento (bus) os transporte:
dois clientes em instâncias diferentes no mesmo canal não ouvem um ao outro,
e cada instância responde "quem está aqui?" apenas com a sua parte. Defina
`REALTIME_CHANNEL_BUS=postgres`. O barramento escuta no banco de dados, o que exige uma
conexão direta em vez de um pooler de transações — defina `DATABASE_DIRECT_URL`
quando `DATABASE_URL` passar pelo pgBouncer. Consulte
[Canais e presença entre instâncias](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Arquivos

Com `STORAGE_TYPE=local`, os uploads são arquivos no disco da instância que
os recebeu, e outra instância responderá com 404 por eles. Use S3 ou GCS, ou
monte um volume em cada instância, no diretório pai de `STORAGE_PATH`, para que ele também
contenha o diretório `<STORAGE_PATH>__<key>` de cada bucket local nomeado. Consulte
[Auto-hospedagem: armazenamento de arquivos](/docs/deployment/self-hosting/#file-storage).

**Uploads retomáveis** (o endpoint TUS) mantêm o arquivo parcial de cada upload e
um registro do upload ao lado dele no disco da instância que o
criou, sob `STORAGE_PATH/.tus-uploads` — mesmo quando os arquivos finalizados vão para o
S3 ou GCS. Monte um volume em `STORAGE_PATH` em cada instância e qualquer instância
atenderá a qualquer upload; uma reinicialização ou um rolling deploy retoma o upload de onde
parou. Sem um volume compartilhado, uma parte (chunk) que chega em outra instância recebe
resposta 404: direcione as requisições de upload de um cliente para uma única instância (sessões persistentes / sticky sessions
no balanceador de carga). O SDK e o painel administrativo, que usam este endpoint para
arquivos maiores que 8 MiB, enviam o arquivo via `POST /upload` nesses casos e continuam
fazendo isso pelo restante da sessão. Uploads comuns via `POST /upload` consistem em uma única requisição
e não são afetados.

**Transformações de imagem** (`?width=400&format=webp`) são armazenadas em cache na memória, portanto, cada
instância calcula cada variante uma vez, e uma nova instância começa fria (cold). Defina
`STORAGE_RENDITION_CACHE=true` para gravar cada renderização de volta no bucket de origem,
onde qualquer instância poderá encontrá-la. Isso faz com que uma requisição `GET` realize uma gravação no seu
bucket, razão pela qual permanece desativado a menos que seja solicitado. Consulte
[Armazenamento](/docs/backend/storage/).

## Logs Explorer

O Logs Explorer do Studio lê um buffer circular das últimas 10.000 linhas de log mantidas pelo
processo que atende à requisição. Atrás de um balanceador de carga, cada atualização de página pode exibir as
linhas de uma instância diferente, e nenhuma delas mostra a implantação inteira.
O explorer indica o nome da instância que está exibindo.
Não há configuração para compartilhar esse buffer circular: em produção, o runtime grava uma linha JSON por evento no
stdout, e é isso que deve ser coletado — pelo serviço de logs da sua plataforma,
Loki ou qualquer ferramenta que leia a saída do contêiner.

## Cron e a fila de jobs

Todo processo que executa o agendador de cron arma seus próprios temporizadores, e a execução é
primeiro reivindicada no banco de dados, de modo que um slot seja executado **uma única vez**, independentemente de quantos processos
disparem para ele. A pausa de um job e o lease que impede que um acionador manual interfira em uma execução
em andamento são compartilhados da mesma maneira. Não há nada a configurar, desde que o banco de dados
seja o Postgres. `REBASE_CRON_SCHEDULER` e `REBASE_JOB_WORKERS` definem quais
processos executam temporizadores e workers — consulte
[Processos divididos](/docs/deployment/split-processes/).

A auditoria agendada de RLS é a exceção: ela não é reivindicada, então todo processo
que a possui realiza a verificação em seu próprio temporizador. Isso é redundante, mas não inseguro; defina
`REBASE_RLS_AUDIT=false` em todas as instâncias, exceto uma.

## Aplicações estáticas

Um processo que serve o frontend ou o CMS (`REBASE_SERVE_STATIC`, ativado por
padrão) lê o `index.html` de cada app uma vez e o retém. Substituir o build
em um volume compartilhado não afeta um processo em execução: ele continuará servindo o documento
antigo, que referencia chunks que podem nem existir mais. Implante um novo build
reiniciando ou fazendo rolling deploy de cada instância — o que uma nova imagem ou bundle já faz de qualquer forma.
Com uma CDN à frente e `REBASE_SERVE_STATIC=false`, isso não se aplica.

## Métricas

O endpoint `/metrics` reporta o processo que responde à requisição. Colete métricas (scrape) de cada instância — um
job de service discovery do Prometheus por pod, e não um único destino atrás do balanceador de
carga — e faça a soma na consulta.

## Provisionamento de inicialização

Cada instância executa a etapa de esquema aditivo na inicialização
(`REBASE_MIGRATE_ON_BOOT=ensure`). Instâncias com a mesma função podem executá-la ao
mesmo tempo: ela foi desenvolvida para tolerar que um par crie a mesma tabela um instante
antes. Em uma implantação dividida, exatamente uma função provisiona e todas as outras definem
`none` — consulte [Processos divididos](/docs/deployment/split-processes/).
