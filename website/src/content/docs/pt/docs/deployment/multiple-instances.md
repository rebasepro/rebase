---
sourceHash: 079933126e9be226
title: Executando mais de uma instância
sidebar_label: Mais de uma instância
description: Cada parte do estado que um processo do Rebase mantém para si e a configuração que a compartilha — o que configurar antes que uma segunda réplica, um rolling deploy ou um split deployment receba tráfego.
---

## Visão Geral

A maior parte de uma implantação do Rebase já reside no banco de dados: linhas, usuários e sessões, chaves de API, a fila de jobs, reivindicações de cron, chaves de idempotência, histórico de registros, os tokens do servidor MCP OAuth. Um segundo processo apontado para o mesmo banco de dados enxerga tudo isso.

Algumas coisas não. Cada uma é por processo por padrão, porque um único processo é a implantação padrão e o compartilhamento tem um custo — uma tabela, uma gravação em bucket, uma conexão de banco de dados. Executar dois processos atrás de um balanceador de carga, escalar automaticamente além de um, ou um rolling deploy que executa brevemente a versão antiga e a nova lado a lado colocam você nesta página. O mesmo vale para um [split deployment](/docs/deployment/split-processes/), que é composto por vários processos por definição.

Analise a lista abaixo antes que o segundo processo receba tráfego. Nada nela falha de forma ruidosa: cada item se manifesta como um limite aplicado três vezes a mais, um evento que alguns clientes nunca veem ou uma página que mostra logs diferentes a cada atualização.

## Lista de verificação

| O quê | Por processo por padrão | O que compartilha |
| --- | --- | --- |
| Segredos de assinatura | Gerados por processo em desenvolvimento | `JWT_SECRET` e `REBASE_SERVICE_KEY`, definidos explicitamente e **idênticos** em todos os lugares |
| Contadores de limite de taxa (rate-limit) | Em memória | `REBASE_RATE_LIMIT_STORE=sql` |
| Endereço do cliente atrás de um proxy | `TRUSTED_PROXY_HOPS=0` | O número de proxies à frente, o mesmo em todos os lugares |
| Assinaturas de tabelas | Compartilhadas através do banco de dados quando o CDC está ativado | `REALTIME_CDC=auto` (o padrão) |
| Canais de transmissão (broadcast) e presença | Em memória | `REALTIME_CHANNEL_BUS=postgres` |
| Arquivos enviados, `STORAGE_TYPE=local` | O próprio disco da instância | S3 ou GCS, ou um volume compartilhado no diretório pai de `STORAGE_PATH` |
| Uploads retomáveis (TUS) em andamento | O disco da instância, em `STORAGE_PATH/.tus-uploads` | Um volume compartilhado em `STORAGE_PATH`, ou sessões persistentes (sticky sessions) |
| Transformações de imagem | Um cache no próprio processo | `STORAGE_RENDITION_CACHE=true` |
| Visualização de Logs do Studio | Um buffer circular das últimas 10.000 linhas | Nada — envie o stdout para um agregador de logs |
| Temporizadores de cron | Todo processo que executa o agendador | Reivindicado no banco de dados: uma execução por slot. `REBASE_CRON_SCHEDULER` define onde os temporizadores residem |
| Auditoria agendada de RLS | Todo processo que a possui | `REBASE_RLS_AUDIT=false` em todos, exceto um |
| O `index.html` de um app estático | Lido uma vez por processo | Reinicie cada instância quando o build mudar |
| `/metrics` | Cada processo conta o seu próprio | Faça scraping de cada instância |

As seções abaixo detalham o comportamento de cada item quando mantido por processo.

## Segredos de assinatura

O `JWT_SECRET` assina todas as sessões e o `REBASE_SERVICE_KEY` autentica chamadas entre servidores. Em desenvolvimento, cada processo gera o seu próprio quando não estão definidos, de modo que um token emitido por um processo é recusado pelo seguinte. Em produção, a inicialização já é recusada sem `JWT_SECRET` (sem `REBASE_SERVICE_KEY`, ela inicializa sem nenhuma service key); o que importa com vários processos é que cada um receba os **mesmos** valores — a partir de um único segredo, não um por réplica.

## Limites de taxa e o endereço do cliente

Os limitadores de taxa — a cota por solicitante nas APIs de dados, armazenamento e funções, e os limitadores de autenticação em login, redefinição de senha, códigos de uso único e tentativas de MFA — realizam a contagem em memória por padrão. Um processo não consegue ver quantos pares possui; portanto, três réplicas com a configuração padrão aplicam o triplo de cada limite. Defina `REBASE_RATE_LIMIT_STORE=sql` e os contadores passarão a residir no banco de dados.

Atrás de um balanceador de carga, o limitador também precisa do endereço real do cliente, que chega em `X-Forwarded-For`. `TRUSTED_PROXY_HOPS` informa por quantos proxies avançar; no valor padrão `0`, todas as requisições parecem vir do balanceador de carga e todos os clientes compartilham o mesmo bucket. Consulte [Configuration](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

**Assinaturas de tabelas** funcionam entre instâncias quando a captura de alterações no nível do banco de dados (CDC) está ativada, o que é o padrão (`REALTIME_CDC=auto`): o write-ahead log (onde o banco de dados permite decodificação lógica) ou um trigger anuncia cada gravação confirmada, e o listener de cada instância busca novamente os dados para seus próprios assinantes. Instâncias com captura via WAL mantêm os triggers em vigor enquanto qualquer instância ainda estiver escutando neles, garantindo que uma réplica que recorreu aos triggers nunca fique isolada. Se o CDC estiver desativado, ou se `auto` não conseguir provisioná-lo (o log de inicialização informa o motivo), uma assinatura verá apenas as gravações feitas através da instância à qual seu socket está conectado. Consulte [Realtime](/docs/backend/realtime-cdc/).

**Canais de transmissão (broadcast) e presença** funcionam no próprio processo, a menos que um barramento os transporte: dois clientes em instâncias diferentes no mesmo canal não ouvem um ao outro, e cada instância responde a "quem está aqui?" com a sua própria metade. Defina `REALTIME_CHANNEL_BUS=postgres`. O barramento escuta o banco de dados, o que exige uma conexão direta em vez de um pooler de transações — defina `DATABASE_DIRECT_URL` quando `DATABASE_URL` passar pelo pgBouncer. Consulte [Channels and presence across instances](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Arquivos

Com `STORAGE_TYPE=local`, os uploads são arquivos no disco da instância que os recebeu, e outra instância responderá com 404 por eles. Use S3 ou GCS, ou monte um volume compartilhado em cada instância, no diretório pai de `STORAGE_PATH`, para que ele também contenha o diretório `<STORAGE_PATH>__<key>` de cada bucket local nomeado. Consulte [Self-hosting: file storage](/docs/deployment/self-hosting/#file-storage).

**Uploads retomáveis** (o endpoint TUS) mantêm o arquivo parcial de cada upload e um registro do upload ao lado dele no disco da instância que o criou, sob `STORAGE_PATH/.tus-uploads` — mesmo quando os arquivos finalizados vão para o S3 ou GCS. Monte um volume em `STORAGE_PATH` em todas as instâncias e qualquer instância poderá atender a qualquer upload; uma reinicialização ou um rolling deploy retomará o upload de onde parou. Sem um volume compartilhado, um chunk que chegue a outra instância receberá um 404: roteie as requisições de upload de um cliente para uma única instância (sessões persistentes / sticky sessions no balanceador de carga). O SDK e o painel de administração, que utilizam este endpoint para arquivos maiores que 8 MiB, enviarão o arquivo via `POST /upload` como alternativa e continuarão fazendo isso pelo restante da sessão. Uploads comuns via `POST /upload` consistem em uma única requisição e não são afetados.

**Transformações de imagem** (`?width=400&format=webp`) são armazenadas em cache na memória, portanto, cada instância computa cada variante uma vez, e uma nova instância começa do zero. Defina `STORAGE_RENDITION_CACHE=true` para gravar cada renderização de volta no bucket de origem, onde qualquer instância poderá encontrá-la. Isso faz com que uma requisição `GET` realize uma gravação no seu bucket, razão pela qual permanece desativado a menos que seja explicitamente solicitado. Consulte [Storage](/docs/backend/storage/).

## Visualização de Logs do Studio

A visualização de Logs do Studio lê um buffer circular das últimas 10.000 linhas de log mantidas pelo processo que atende à requisição. Atrás de um balanceador de carga, cada atualização de página pode exibir as linhas de uma instância diferente, e nenhuma delas mostra a implantação inteira. O explorer indica o nome da instância que está exibindo. Não existe configuração para compartilhar esse buffer circular: em produção, o runtime grava uma linha JSON por evento no stdout, e é isso que deve ser coletado — pelo serviço de logs da sua plataforma, Loki ou qualquer ferramenta que leia a saída do contêiner.

## Cron e a fila de jobs

Cada processo que executa o agendador de cron arma seus próprios temporizadores, e a execução é reivindicada primeiro no banco de dados, garantindo que um slot seja executado **apenas uma vez**, independentemente de quantos processos disparem para ele. Pausar um job e a concessão (lease) que impede um disparo manual durante uma execução em andamento são compartilhados da mesma forma. Nada precisa ser configurado, desde que o banco de dados seja o Postgres. `REBASE_CRON_SCHEDULER` e `REBASE_JOB_WORKERS` decidem quais processos executam temporizadores e workers — consulte [Split processes](/docs/deployment/split-processes/).

A auditoria agendada de RLS é a exceção: ela não é reivindicada, portanto cada processo que a possui realiza a varredura em seu próprio temporizador. Isso é redundante, mas não inseguro; defina `REBASE_RLS_AUDIT=false` em todas as instâncias, exceto em uma.

## Aplicações estáticas

Um processo que serve o frontend ou o CMS (`REBASE_SERVE_STATIC`, ativado por padrão) lê o `index.html` de cada aplicativo uma vez e o mantém em cache. Substituir o build em um volume compartilhado não afeta um processo em execução: ele continuará servindo o documento antigo, que referencia chunks que podem não existir mais. Implemente um novo build reiniciando ou atualizando (rolling restart) cada instância — o que uma nova imagem ou bundle já faz naturalmente. Com uma CDN à frente e `REBASE_SERVE_STATIC=false`, isso não se aplica.

## Métricas

O endpoint `/metrics` reporta as métricas do processo que responde a ele. Colete métricas (scrape) de cada instância — um job de service discovery do Prometheus por pod, e não um único alvo atrás do balanceador de carga — e faça a soma na consulta.

## Provisionamento na inicialização

Cada instância executa a etapa aditiva de schema na inicialização (`REBASE_MIGRATE_ON_BOOT=ensure`). Instâncias com a mesma função podem executá-la ao mesmo tempo: ela foi desenvolvida para tolerar que um par crie a mesma tabela um instante antes. Em um split deployment, exatamente uma função faz o provisionamento e todas as outras definem como `none` — consulte [Split processes](/docs/deployment/split-processes/).
