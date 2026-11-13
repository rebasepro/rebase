---
sourceHash: d2e9fbce6bf304f5
title: Executando mais de uma instância
sidebar_label: Mais de uma instância
description: Cada parte do estado que um processo do Rebase mantém para si e a configuração que o compartilha — o que configurar antes que uma segunda réplica, um rolling deploy ou uma implantação dividida receba tráfego.
---

## Visão geral

A maior parte de uma implantação do Rebase já reside no banco de dados: linhas, usuários e
sessões, chaves de API, a fila de jobs, reivindicações de cron, chaves de idempotência, histórico de
registros, tokens do servidor OAuth MCP. Um segundo processo apontado para o mesmo
banco de dados enxerga tudo isso.

Algumas coisas não. Cada uma é por processo por padrão, porque um único processo é
a implantação padrão e o compartilhamento tem um custo — uma tabela, uma gravação no bucket, uma
conexão com o banco de dados. Executar dois processos atrás de um balanceador de carga, fazer autoscaling
além de um, ou um rolling deploy que executa brevemente o antigo e o novo lado a lado,
colocam você nesta página. O mesmo se aplica a uma [implantação dividida](/docs/deployment/split-processes/),
que é composta por vários processos por definição.

Revise a lista abaixo antes que o segundo processo receba tráfego. Nada nela
falha de forma evidente: cada item se manifesta como um limite aplicado três vezes a mais, um evento
que alguns clientes nunca veem ou uma página que mostra logs diferentes a cada atualização.

## O checklist

| O que | Por processo por padrão | O que compartilha |
| --- | --- | --- |
| Segredos de assinatura | Gerados por processo em desenvolvimento | `JWT_SECRET` e `REBASE_SERVICE_KEY`, definidos explicitamente e **idênticos** em todos os lugares |
| Contadores de rate limit | Na memória | `REBASE_RATE_LIMIT_STORE=sql` |
| Endereço do cliente atrás de um proxy | `TRUSTED_PROXY_HOPS=0` | O número de proxies à frente, igual em todos os lugares |
| Assinaturas de tabela | Compartilhadas pelo banco de dados quando o CDC está ativo | `REALTIME_CDC=auto` (o padrão) |
| Canais de broadcast e presença | Na memória | `REALTIME_CHANNEL_BUS=postgres` |
| Arquivos enviados, `STORAGE_TYPE=local` | O próprio disco da instância | S3 ou GCS, ou um volume compartilhado no diretório pai de `STORAGE_PATH` |
| Uploads retomáveis (TUS) em andamento | O disco da instância, em `STORAGE_PATH/.tus-uploads` | Um volume compartilhado em `STORAGE_PATH`, ou sessões fixas (sticky sessions) |
| Transformações de imagem | Um cache no processo | `STORAGE_RENDITION_CACHE=true` |
| Logs Explorer | Um buffer circular das últimas 10.000 linhas | Nada — envie o stdout para um agregador de logs |
| Temporizadores de cron | Todo processo que executa o agendador | Reivindicado no banco de dados: uma execução por slot. `REBASE_CRON_SCHEDULER` define onde os temporizadores residem |
| Auditoria RLS agendada | Todo processo responsável por ela | `REBASE_RLS_AUDIT=false` em todos, exceto um |
| O `index.html` de um app estático | Lido uma vez por processo | Reinicie cada instância quando o build mudar |
| `/metrics` | Cada processo conta o seu próprio | Faça scrape em cada instância |

As seções abaixo explicam o que cada item faz quando é mantido por processo.

## Segredos de assinatura

O `JWT_SECRET` assina cada sessão e a `REBASE_SERVICE_KEY` autentica
chamadas server-to-server. Em desenvolvimento, cada processo gera o seu próprio quando não
estão definidos, portanto, um token emitido por um processo é recusado pelo próximo. A produção
já se recusa a inicializar sem o `JWT_SECRET` (sem `REBASE_SERVICE_KEY`, ela inicializa
sem nenhuma chave de serviço); o que importa com vários processos é
que cada um receba os **mesmos** valores — a partir de um único segredo, e não um por réplica.

## Limites de taxa e o endereço do cliente

Os limitadores de taxa (rate limiters) — o limite por chamador nas APIs de dados, armazenamento e funções,
e os limitadores de autenticação em login, redefinição de senha, códigos de uso único e
tentativas de MFA — realizam a contagem em memória por padrão. Um processo não consegue enxergar quantos pares
possui; portanto, três réplicas com a configuração padrão aplicarão três vezes cada limite. Defina
`REBASE_RATE_LIMIT_STORE=sql` e os contadores ficarão no banco de dados.

Atrás de um balanceador de carga, o limitador também precisa do endereço real do cliente,
que chega em `X-Forwarded-For`. `TRUSTED_PROXY_HOPS` define por quantos proxies olhar
além; no padrão `0`, cada requisição parece vir do balanceador de carga
e todos os clientes compartilham o mesmo bucket. Veja
[Configuração](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

As **assinaturas de tabela** funcionam entre instâncias quando a captura de alterações
no nível do banco de dados está ativa, o que ocorre por padrão (`REALTIME_CDC=auto`): um trigger anuncia
cada gravação confirmada, e o listener de cada instância busca novamente os dados para seus próprios
assinantes. Se o CDC estiver desativado ou se o modo `auto` não conseguir provisioná-lo (o log de inicialização informa
qual é o caso), uma assinatura verá apenas as gravações feitas pela instância à qual
seu socket está conectado. Veja
[Realtime](/docs/backend/realtime-cdc/).

**Canais de broadcast e presença** operam dentro do processo, a menos que um barramento (bus) os transporte:
dois clientes em instâncias diferentes no mesmo canal não se comunicam entre si,
e cada instância responde "quem está aqui?" com a sua própria metade. Defina
`REALTIME_CHANNEL_BUS=postgres`. O barramento escuta o banco de dados, o que requer uma
conexão direta em vez de um pooler de transações — defina `DATABASE_DIRECT_URL`
quando `DATABASE_URL` passar pelo pgBouncer. Veja
[Canais e presença entre instâncias](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Arquivos

Com `STORAGE_TYPE=local`, os uploads são arquivos no disco da instância que
os recebeu, e outra instância responderá 404 para eles. Use S3 ou GCS, ou
monte um volume em cada instância, no diretório pai de `STORAGE_PATH`, para que ele também
contenha o diretório `<STORAGE_PATH>__<key>` de cada bucket local nomeado. Veja
[Auto-hospedagem: armazenamento de arquivos](/docs/deployment/self-hosting/#file-storage).

**Uploads retomáveis** (o endpoint TUS) mantêm o arquivo parcial de cada upload e
um registro do upload junto a ele no disco da instância que o
criou, sob `STORAGE_PATH/.tus-uploads` — mesmo quando os arquivos concluídos vão para o
S3 ou GCS. Monte um volume em `STORAGE_PATH` em todas as instâncias e qualquer instância
atenderá a qualquer upload; uma reinicialização ou rolling deploy retomará um upload de onde
parou. Sem um volume compartilhado, um chunk que chegue a outra instância
receberá resposta 404: encaminhe as requisições de upload de um cliente para uma única instância (sessões fixas / sticky sessions
no balanceador de carga). O SDK e o painel de administração, que usam esse endpoint para
arquivos maiores que 8 MiB, enviarão o arquivo via `POST /upload` e
continuarão fazendo isso pelo restante da sessão. Uploads comuns via `POST /upload` são feitos em uma única requisição
e não são afetados.

**Transformações de imagem** (`?width=400&format=webp`) são armazenadas em cache na memória, de modo que cada
instância calcula cada variante uma vez, e uma nova instância começa fria. Defina
`STORAGE_RENDITION_CACHE=true` para gravar cada renderização de volta no bucket de onde
veio, onde qualquer instância poderá encontrá-la. Isso faz com que uma requisição `GET` realize uma gravação no seu
bucket, razão pela qual o recurso vem desativado a menos que solicitado. Veja
[Armazenamento](/docs/backend/storage/).

## Logs Explorer

O Logs Explorer do Studio lê um buffer circular das últimas 10.000 linhas de log mantidas pelo
processo que atende à requisição. Atrás de um balanceador de carga, cada atualização de página pode exibir as
linhas de uma instância diferente, e nenhuma delas mostra a implantação completa.
O explorer indica o nome da instância que está exibindo.
Não há configuração para compartilhar esse buffer circular: o runtime grava uma linha JSON por evento no
stdout em produção, e é isso que deve ser coletado — pelo serviço de logs da sua
plataforma, Loki ou qualquer ferramenta que leia a saída do contêiner.

## Cron e a fila de jobs

Cada processo que executa o agendador de cron ativa seus próprios temporizadores, e a execução é
reivindicada primeiro no banco de dados, para que um slot seja executado apenas **uma vez**, independentemente de quantos processos
o acionem. O pausamento de um job e o lease que impede que um disparo manual interfira em uma execução
em andamento são compartilhados da mesma forma. Não há nada para configurar, desde que o banco de dados
seja o Postgres. `REBASE_CRON_SCHEDULER` e `REBASE_JOB_WORKERS` decidem quais
processos executam temporizadores e workers — veja
[Processos divididos](/docs/deployment/split-processes/).

A auditoria RLS agendada é a exceção: ela não é reivindicada no banco, portanto, cada processo
que a possui realiza a varredura em seu próprio temporizador. Isso é redundante, mas não inseguro; defina
`REBASE_RLS_AUDIT=false` em todas as instâncias, exceto em uma.

## Aplicativos estáticos

Um processo que serve o frontend ou o CMS (`REBASE_SERVE_STATIC`, ativado por
padrão) lê o `index.html` de cada aplicativo uma vez e o mantém em memória. Substituir o build
em um volume compartilhado não afeta um processo em execução: ele continuará servindo o documento
antigo, que faz referência a chunks que podem não existir mais. Lance um novo build
reiniciando ou realizando rolling deploy em cada instância — o que uma nova imagem ou bundle já faz normalmente.
Com uma CDN à frente e `REBASE_SERVE_STATIC=false`, isso não se aplica.

## Métricas

O endpoint `/metrics` reporta os dados do processo que responde à requisição. Faça o scrape de cada instância — uma
tarefa de service discovery do Prometheus por pod, e não um único target atrás do balanceador de
carga — e faça a soma na consulta.

## Provisionamento na inicialização

Cada instância executa a etapa aditiva de esquema na inicialização
(`REBASE_MIGRATE_ON_BOOT=ensure`). Instâncias com a mesma função (role) podem executá-la ao
mesmo tempo: ela foi projetada para tolerar que um par crie a mesma tabela um instante
antes. Em uma implantação dividida, exatamente uma função provisiona e todas as outras definem
`none` — veja [Processos divididos](/docs/deployment/split-processes/).
