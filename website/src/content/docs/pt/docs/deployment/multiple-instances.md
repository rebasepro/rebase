---
sourceHash: de9051fe769a602b
title: Executando mais de uma instância
sidebar_label: Mais de uma instância
description: Cada fragmento de estado que um processo do Rebase mantém para si e a configuração que o compartilha — o que definir antes que uma segunda réplica, um rolling deploy ou um split deployment receba tráfego.
---

## Visão Geral

A maior parte de uma implantação do Rebase já reside no banco de dados: linhas, usuários e
sessões, chaves de API, a fila de jobs, reivindicações de cron, chaves de idempotência, histórico
de registros e os tokens do servidor OAuth MCP. Um segundo processo apontado para o mesmo
banco de dados enxerga tudo isso.

Algumas coisas não ficam no banco. Cada uma delas é isolada por processo por padrão, porque um
único processo é a implantação padrão e o compartilhamento tem um custo — uma tabela, uma gravação
em bucket, uma conexão com o banco de dados. Executar dois processos atrás de um balanceador de carga,
fazer autoscaling para mais de uma instância ou realizar um rolling deploy que execute brevemente a versão
antiga e a nova lado a lado trazem você a esta página. O mesmo vale para um [split deployment](/docs/deployment/split-processes/),
que é, por definição, composto por vários processos.

Revise a lista abaixo antes que a segunda instância passe a receber tráfego. Nada nela
falha de forma óbvia: cada item se manifesta como um limite aplicado três vezes a mais, um evento
que alguns clientes nunca recebem ou uma página que exibe logs diferentes a cada atualização.

## O checklist

| O que | Por processo por padrão | O que compartilha |
| --- | --- | --- |
| Segredos de assinatura | Gerados por processo em desenvolvimento | `JWT_SECRET` e `REBASE_SERVICE_KEY`, definidos explicitamente e **idênticos** em todos os lugares |
| Contadores de rate limit | Na memória | `REBASE_RATE_LIMIT_STORE=sql` |
| Endereço do cliente atrás de um proxy | `TRUSTED_PROXY_HOPS=0` | O número de proxies à frente, igual em todos os lugares |
| Assinaturas de coleções | Compartilhadas através do banco de dados quando o CDC está ativo | `REALTIME_CDC=auto` (o padrão) |
| Canais de broadcast e presença | Na memória | `REALTIME_CHANNEL_BUS=postgres` |
| Arquivos enviados, `STORAGE_TYPE=local` | O disco da própria instância | S3 ou GCS, ou um volume compartilhado no diretório pai de `STORAGE_PATH` |
| Uploads retomáveis (TUS) em andamento | O disco da instância, em `STORAGE_PATH/.tus-uploads` | Um volume compartilhado em `STORAGE_PATH`, ou sticky sessions |
| Transformações de imagem | Um cache em memória no processo | `STORAGE_RENDITION_CACHE=true` |
| Logs Explorer | Um buffer circular das últimas 10.000 linhas | Nada — envie o stdout para um agregador de logs |
| Temporizadores de cron | Cada processo que executa o agendador | Reivindicados no banco de dados: uma execução por slot. `REBASE_CRON_SCHEDULER` define onde os temporizadores residem |
| Auditoria agendada de RLS | Cada processo que a possui | `REBASE_RLS_AUDIT=false` em todas as instâncias, exceto uma |
| O `index.html` de uma aplicação estática | Lido uma vez por processo | Reinicie todas as instâncias quando o build mudar |
| `/metrics` | Cada processo contabiliza o seu próprio | Faça scrape de cada instância |

As seções abaixo explicam o comportamento de cada item quando deixado na configuração padrão por processo.

## Segredos de assinatura

O `JWT_SECRET` assina cada sessão e o `REBASE_SERVICE_KEY` autentica
chamadas de servidor para servidor. Em desenvolvimento, cada processo gera seus próprios segredos
quando eles não estão definidos; portanto, um token emitido por um processo é recusado pelo
próximo. Em produção, a inicialização já é bloqueada sem eles; o que importa ao executar
vários processos é que todos recebam os **mesmos** valores — a partir de um único segredo, e não um por réplica.

## Rate limits e o endereço do cliente

Os limitadores de taxa — a cota por cliente nas APIs de dados, armazenamento e funções,
bem como os limitadores de autenticação em login, redefinição de senha, códigos de uso único
e tentativas de MFA — contam na memória por padrão. Um processo não consegue ver quantos pares
ele possui; portanto, três réplicas com a configuração padrão aplicam cada limite três vezes. Defina
`REBASE_RATE_LIMIT_STORE=sql` e os contadores passarão a residir no banco de dados.

Atrás de um balanceador de carga, o limitador também precisa do endereço real do cliente, que
chega em `X-Forwarded-For`. O `TRUSTED_PROXY_HOPS` define quantos proxies devem ser ignorados;
no padrão `0`, cada requisição parece vir do balanceador de carga e todos os clientes compartilham
a mesma cota. Consulte
[Configuração](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

As **assinaturas de coleções** funcionam entre instâncias quando a captura de alterações
no nível do banco de dados (CDC) está ativada, o que é o padrão (`REALTIME_CDC=auto`): um trigger
anuncia cada gravação confirmada (commit), e o listener de cada instância busca novamente os dados para
seus próprios assinantes. Se o CDC estiver desativado, ou se `auto` não conseguir provisioná-lo
(o log de boot informa o motivo), uma assinatura verá apenas as gravações feitas através da instância à
qual seu socket está conectado. Consulte
[Realtime](/docs/backend/realtime-cdc/).

**Canais de broadcast e presença** ocorrem dentro do processo, a menos que um barramento os transporte:
dois clientes em instâncias diferentes no mesmo canal não ouvem um ao outro, e cada instância
responde "quem está aqui?" apenas com a sua parte. Defina `REALTIME_CHANNEL_BUS=postgres`.
O barramento escuta o banco de dados, o que exige uma conexão direta em vez de um pooler de transações — defina
`DATABASE_DIRECT_URL` quando o `DATABASE_URL` passar pelo pgBouncer. Consulte
[Canais e presença entre instâncias](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Arquivos

Com `STORAGE_TYPE=local`, os uploads são arquivos no disco da instância que
os recebeu, e outra instância responderá com 404 para eles. Use S3 ou GCS, ou
monte um volume em todas as instâncias, no diretório pai de `STORAGE_PATH`, para que ele também
contenha o diretório `<STORAGE_PATH>__<key>` de cada bucket local nomeado. Consulte
[Auto-hospedagem: armazenamento de arquivos](/docs/deployment/self-hosting/#file-storage).

**Uploads retomáveis** (o endpoint TUS) mantêm o arquivo parcial de cada upload e,
um registro do upload ao lado dele, no disco da instância
que o criou, sob `STORAGE_PATH/.tus-uploads` — mesmo quando os arquivos finalizados vão para
o S3 ou GCS. Monte um volume em `STORAGE_PATH` em todas as instâncias e qualquer instância
poderá atender a qualquer upload; uma reinicialização ou um rolling deploy retomará o upload de onde
ele parou. Sem um volume compartilhado, um chunk que chegue em outra instância receberá resposta 404:
roteie as requisições de upload de um cliente para uma única instância (sticky sessions
no balanceador de carga). O SDK e o painel de administração, que utilizam esse endpoint para
arquivos maiores que 8 MiB, passarão a enviar o arquivo via `POST /upload` e continuarão
fazendo isso pelo restante da sessão. Uploads comuns via `POST /upload` consistem em uma única requisição
e não são afetados. Na versão 0.23, o estado do upload ficava na memória do processo,
de modo que um volume compartilhado não resolvia e uma reinicialização reiniciava o upload no byte 0.

**Transformações de imagem** (`?width=400&format=webp`) são armazenadas em cache na memória; portanto, cada
instância processa cada variante uma vez, e uma nova instância começa com o cache frio. Defina
`STORAGE_RENDITION_CACHE=true` para gravar cada renderização de volta no bucket de
origem, onde qualquer instância poderá encontrá-la. Isso faz com que um `GET` realize uma gravação no seu
bucket, razão pela qual essa opção fica desativada a menos que seja solicitada. Consulte
[Armazenamento](/docs/backend/storage/).

## Logs Explorer

O Logs Explorer do Studio lê um buffer circular das últimas 10.000 linhas de log mantidas pelo
processo que atende à requisição. Atrás de um balanceador de carga, cada atualização de página pode exibir
as linhas de uma instância diferente, e nenhuma delas mostra a implantação completa.
O explorer indica o nome da instância que está exibindo.
Não existe uma configuração para compartilhar esse buffer: o runtime grava uma linha JSON por evento no
stdout em produção, e é isso o que deve ser coletado — pelo serviço de logs da sua plataforma,
Loki ou qualquer ferramenta que leia a saída de containers.

## Cron e a fila de jobs

Cada processo que executa o agendador de cron ativa seus próprios temporizadores, e a execução é
reivindicada primeiro no banco de dados; portanto, um slot é executado **uma única vez**, independentemente de quantos
processos o acionem. Pausar um job e o lease que impede que um acionamento manual concorra com uma
execução em andamento são compartilhados da mesma forma. Não há nada a configurar, desde que o banco
de dados seja o Postgres. `REBASE_CRON_SCHEDULER` e `REBASE_JOB_WORKERS` decidem quais
processos executam temporizadores e workers — consulte
[Processos divididos](/docs/deployment/split-processes/).

A auditoria agendada de RLS é a exceção: ela não é reivindicada, portanto cada processo
que a executa realiza a varredura em seu próprio temporizador. Isso é redundante, mas não inseguro; defina
`REBASE_RLS_AUDIT=false` em todas as instâncias, exceto em uma.

## Aplicações estáticas

Um processo que serve o frontend ou o CMS (`REBASE_SERVE_STATIC`, ativado por
padrão) lê o `index.html` de cada aplicação uma vez e o mantém em memória. Substituir o build
em um volume compartilhado não atualiza um processo em execução: ele continua servindo o documento
antigo, que referencia chunks que podem nem mais existir. Publique um novo build
reiniciando ou fazendo um deploy gradual (rolling) de cada instância — o que uma nova imagem ou bundle já faz por padrão.
Com uma CDN à frente e `REBASE_SERVE_STATIC=false`, isso não se aplica.

## Métricas

O endpoint `/metrics` reporta os dados do processo que responde à requisição. Faça o scrape de cada instância — um
job de service discovery do Prometheus por pod, e não um único alvo atrás do balanceador
de carga — e faça a soma na consulta.

## Provisionamento no boot

Cada instância executa a etapa aditiva de migração de esquema na inicialização
(`REBASE_MIGRATE_ON_BOOT=ensure`). Instâncias da mesma função (role) podem executá-la ao
mesmo tempo: ela foi desenvolvida para tolerar que outra instância crie a mesma tabela um instante
antes. Em um split deployment, exatamente uma função provisiona o esquema e todas as outras definem
`none` — consulte [Processos divididos](/docs/deployment/split-processes/).
