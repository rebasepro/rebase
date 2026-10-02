---
sourceHash: 2e1acf0a887d27a1
title: Executando mais de uma instância
sidebar_label: Mais de uma instância
description: Todo estado que um processo Rebase mantém só para si, e a configuração que o compartilha — o que definir antes de uma segunda réplica, um deploy rolling ou uma implantação dividida receber tráfego.
---

## Visão geral

A maior parte de uma implantação do Rebase já vive no banco de dados: linhas,
usuários e sessões, chaves de API, a fila de jobs, claims de cron, chaves de
idempotência, histórico de registros, os tokens do servidor OAuth do MCP. Um
segundo processo apontado para o mesmo banco de dados vê tudo isso.

Algumas coisas não. Cada uma é por processo por padrão, porque um único
processo é a implantação padrão e compartilhar custa algo — uma tabela, uma
escrita em bucket, uma conexão de banco de dados. Executar dois processos
atrás de um load balancer, escalar além de um, ou um deploy rolling que
brevemente executa o antigo e o novo lado a lado — tudo isso coloca você nesta
página. O mesmo vale para uma [implantação dividida](/docs/deployment/split-processes/),
que por definição é vários processos.

Percorra a lista abaixo antes de o segundo receber tráfego. Nada nela falha
ruidosamente: cada item aparece como um limite aplicado três vezes, um evento
que alguns clientes nunca veem, ou uma página que mostra logs diferentes a
cada atualização.

## A lista de verificação

| O quê | Por processo por padrão | O que compartilha |
| --- | --- | --- |
| Segredos de assinatura | Gerados por processo em desenvolvimento | `JWT_SECRET` e `REBASE_SERVICE_KEY`, definidos explicitamente e **idênticos** em todo lugar |
| Contadores de rate limit | Em memória | `REBASE_RATE_LIMIT_STORE=sql` |
| Endereço do cliente atrás de um proxy | `TRUSTED_PROXY_HOPS=0` | O número de proxies na frente, igual em todo lugar |
| Assinaturas de coleções | Compartilhadas pelo banco de dados quando o CDC está ativo | `REALTIME_CDC=auto` (o padrão) |
| Canais de broadcast e presença | Em memória | `REALTIME_CHANNEL_BUS=postgres` |
| Arquivos enviados, `STORAGE_TYPE=local` | O próprio disco da instância | S3 ou GCS, ou um volume compartilhado em `STORAGE_PATH` |
| Uploads retomáveis (TUS) em andamento | A memória e o disco da instância | Sticky sessions; um restart ainda os perde |
| Transformações de imagem | Um cache em processo | `STORAGE_RENDITION_CACHE=true` |
| Logs Explorer | Um anel com as últimas 10.000 linhas | Nada — envie o stdout para um agregador de logs |
| Timers de cron | Todo processo que executa o scheduler | Reivindicado no banco de dados: uma execução por slot. `REBASE_CRON_SCHEDULER` decide onde os timers vivem |
| Auditoria de RLS agendada | Todo processo que a possui | `REBASE_RLS_AUDIT=false` em todos exceto um |
| O `index.html` de um app estático | Lido uma vez por processo | Reinicie cada instância quando o build mudar |
| `/metrics` | Cada processo conta apenas o seu | Faça scrape de cada instância |

As seções abaixo explicam o que cada um faz quando deixado por processo.

## Segredos de assinatura

O `JWT_SECRET` assina toda sessão e o `REBASE_SERVICE_KEY` autentica chamadas
servidor-para-servidor. Em desenvolvimento, cada processo gera o seu próprio
quando eles não estão definidos, então um token emitido por um processo é
recusado pelo próximo. A produção já se recusa a iniciar sem eles; o que
importa com vários processos é que todos recebam os **mesmos** valores — a
partir de um único segredo, não um por réplica.

## Rate limits e o endereço do cliente

Os rate limiters — o orçamento por chamador nas APIs de data, storage e
functions, e os limitadores de autenticação em login, redefinição de senha,
códigos de uso único e tentativas de MFA — contam em memória por padrão. Um
processo não consegue ver quantos pares ele tem, então três réplicas no padrão
aplicam cada limite três vezes. Defina `REBASE_RATE_LIMIT_STORE=sql` e os
contadores passam a viver no banco de dados.

Atrás de um load balancer, o limitador também precisa do endereço real do
cliente, que chega em `X-Forwarded-For`. O `TRUSTED_PROXY_HOPS` diz quantos
proxies ignorar; no padrão `0`, toda requisição parece vir do load balancer e
todo cliente compartilha um único bucket. Veja
[Configuração](/docs/getting-started/configuration/#comportamento-em-tempo-de-execução).

## Tempo real

**As assinaturas de coleções** funcionam entre instâncias quando a captura de
alterações em nível de banco de dados está ativa, o que ocorre por padrão
(`REALTIME_CDC=auto`): um trigger anuncia cada gravação confirmada, e o
listener de cada instância refaz a busca para seus próprios assinantes. Se o
CDC estiver desativado, ou se o `auto` não conseguiu provisioná-lo (o log de
inicialização diz o motivo), uma assinatura vê apenas as gravações feitas
através da instância a cujo socket ela está conectada. Veja
[Tempo real](/docs/backend/realtime/#captura-de-alterações-a-nível-de-banco-de-dados-cdc).

**Canais de broadcast e presença** são em processo a menos que um barramento
os carregue: dois clientes em instâncias diferentes no mesmo canal não se
ouvem, e cada instância responde "quem está aqui?" com apenas a sua metade.
Defina `REALTIME_CHANNEL_BUS=postgres`. O barramento escuta o banco de dados,
o que exige uma conexão direta em vez de um pooler de transação — defina
`DATABASE_DIRECT_URL` quando `DATABASE_URL` passa pelo pgBouncer. Veja
[Canais e presença entre instâncias](/docs/backend/realtime-transports/#canais-e-presença-entre-instâncias).

## Arquivos

Com `STORAGE_TYPE=local`, os uploads são arquivos no disco da instância que os
recebeu, e outra instância responde 404 para eles. Use S3 ou GCS, ou monte um
único volume em `STORAGE_PATH` em todas as instâncias. Veja
[Auto-hospedagem: armazenamento de arquivos](/docs/deployment/self-hosting/#armazenamento-de-arquivos).

**Os uploads retomáveis** (o endpoint TUS) mantêm o arquivo parcial de cada
upload e seu estado no disco local da instância que o criou, em
`STORAGE_PATH/.tus-uploads` — mesmo quando os arquivos finalizados vão para o
S3 ou o GCS. Um chunk que chega a outra instância recebe 404 e o cliente
recomeça. Direcione as requisições de upload de um cliente para uma única
instância (sticky sessions no load balancer). Um volume compartilhado em
`STORAGE_PATH` compartilha os arquivos parciais, mas ainda não o estado do
upload, que é mantido na memória do processo — então um restart ou um deploy
rolling também devolve um upload em andamento para o byte 0. Uploads comuns
via `POST /upload` são uma única requisição e não são afetados.

**As transformações de imagem** (`?width=400&format=webp`) são armazenadas em
cache na memória, então cada instância calcula cada variante uma vez, e uma
instância nova começa fria. Defina `STORAGE_RENDITION_CACHE=true` para gravar
cada rendition de volta no bucket de onde ela veio, onde toda instância a
encontra. Isso faz com que um `GET` grave no seu bucket, por isso fica
desativado a menos que seja solicitado. Veja
[Armazenamento](/docs/backend/storage/).

## Logs Explorer

O Logs Explorer do Studio lê um anel com as últimas 10.000 linhas de log
mantidas pelo processo que atende a requisição. Atrás de um load balancer,
cada atualização pode mostrar as linhas de uma instância diferente, e nenhuma
delas mostra a implantação inteira. Não há configuração que compartilhe isso:
o runtime grava uma linha JSON por evento no stdout em produção, e é isso que
deve ser coletado — o serviço de log da sua plataforma, o Loki, ou qualquer
coisa que leia a saída do contêiner.

## Cron e a fila de jobs

Todo processo que executa o scheduler de cron arma seus próprios timers, e a
execução é reivindicada no banco de dados primeiro, então um slot roda **uma
vez**, independentemente de quantos processos disparam para ele. Pausar um
job, e o lease que mantém um disparo manual fora de uma execução em
andamento, são compartilhados da mesma forma. Nada para configurar, desde que
o banco de dados seja Postgres. `REBASE_CRON_SCHEDULER` e
`REBASE_JOB_WORKERS` decidem quais processos executam timers e workers —
veja [Processos divididos](/docs/deployment/split-processes/).

A auditoria de RLS agendada é a exceção: ela não é reivindicada, então todo
processo que a possui faz a varredura em seu próprio timer. Isso é redundante,
não inseguro; defina `REBASE_RLS_AUDIT=false` em todos exceto um.

## Apps estáticos

Um processo que serve o frontend ou o CMS (`REBASE_SERVE_STATIC`, ativado por
padrão) lê o `index.html` de cada app uma vez e o mantém. Substituir o build
em um volume compartilhado não alcança um processo em execução: ele continua
servindo o documento antigo, que nomeia chunks que podem não existir mais.
Entregue um build novo reiniciando ou fazendo o rolling de cada instância —
o que uma imagem ou bundle novo faz de qualquer forma. Com uma CDN na frente e
`REBASE_SERVE_STATIC=false`, isso não se aplica.

## Métricas

O `/metrics` reporta o processo que o atende. Faça scrape de cada instância —
um job de service discovery do Prometheus por pod, não um único target atrás
do load balancer — e some na query.

## Provisionamento no boot

Toda instância executa a passagem aditiva de schema no boot
(`REBASE_MIGRATE_ON_BOOT=ensure`). Instâncias da mesma role podem executá-la
ao mesmo tempo: ela é escrita para tolerar um par criando a mesma tabela um
instante antes. Em uma implantação dividida, exatamente uma role provisiona e
toda outra define `none` — veja [Processos divididos](/docs/deployment/split-processes/).
