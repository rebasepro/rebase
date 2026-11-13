---
sourceHash: 00bc3369d6f3db69
title: Kubernetes
sidebar_label: Kubernetes
description: Implante o Rebase em um cluster Kubernetes com o Helm chart oficial — um Deployment ou vários, um Job de migração que gerencia o schema e aplicações estáticas no mesmo host.
---

## Visão Geral

O chart oficial é o equivalente em Kubernetes da configuração de auto-hospedagem
com Docker Compose. Mesma ideia, mesma imagem, mesmo bundle: **o runtime é a imagem,
seu projeto é o bundle e atualizar o Rebase é apenas uma alteração de tag.**

Ele é publicado como um artefato OCI ao lado da imagem de runtime, e ambos possuem
a mesma versão — o chart que faz o deploy do runtime `0.17.3` *é* o chart `0.17.3`,
portanto há apenas um número para acompanhar. Sem `--version` você obtém o mais
recente; fixe-o para um deploy real, da mesma forma que fixaria `image.tag`:

```bash
helm install rebase oci://registry-1.docker.io/rebasepro/rebase \
  --set config.databaseUrl='postgres://user:pass@host:5432/db' \
  --set config.jwtSecret="$(openssl rand -hex 32)" \
  --set config.serviceKey="$(openssl rand -hex 32)" \
  --set config.adminEmail=you@example.com \
  --set config.adminPassword="$(openssl rand -hex 16)" \
  --set ingress.host=api.example.com \
  --set image.repository=my-registry/my-app
```

O chart vem com o auto-registro desativado, portanto um release precisa definir
a conta com a qual seu operador fará login — caso contrário, ele inicializará com
uma tabela de usuários vazia e nenhuma maneira de gerar o primeiro chamador autenticado.
`config.adminPassword` deve ter pelo menos 12 caracteres, e `config.adminEmail` precisa
de um ponto em seu domínio: a rota de login analisa seu corpo com `z.string().email()`,
de modo que `admin@localhost` seria uma conta na qual ninguém conseguiria fazer login
e o runtime se recusa a criá-la (seed). Ambas são recusas em tempo de renderização, e
não surpresas em tempo de execução — veja [o que o chart se recusa a renderizar](#o-que-o-chart-se-recusa-a-renderizar).
Faça login e altere a senha; esses valores são armazenados em um Secret.

Em vez disso, gerencie-os fora de banda apontando `existingSecret` para um Secret
contendo `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` juntamente com `DATABASE_URL`
e o restante.

O chart implanta **apenas o runtime**. Ele não implanta o Postgres — use CloudNativePG,
um banco de dados gerenciado ou seu próprio StatefulSet, e aponte `config.databaseUrl`
para ele. Um chart que também gerenciasse seu banco de dados teria que gerenciar seus
backups e seu failover, o que é uma promessa muito maior do que "executar a aplicação".

> **Maturidade.** Duas coisas distintas são verificadas no CI, e uma terceira não é.
> O chart passa por lint e renderização com o Helm v4.2.4 — para cada topologia documentada
> nesta página, incluindo o comando de instalação acima, e um caso cobrindo cada recusa
> listada abaixo. A imagem de runtime que o chart implanta é construída e inicializada
> contra um Postgres real, para ambas as formas que um bundle pode chegar. O que
> **nunca foi executado é o chart contra um cluster ativo**: nada agendou esses manifestos,
> de modo que os probes, a ordenação do Job de migração pré-instalação e o ingress estão
> corretos como YAML, mas não foram comprovados como uma implantação real. Considere-o um
> ponto de partida bem testado, e não um padrão comprovado em produção, e leia
> [Auto-hospedagem](/docs/deployment/self-hosting) para o caminho comprovado.

Para trabalhar a partir de um checkout local — um chart modificado ou uma instalação
isolada (air-gapped) — `helm install rebase ./infra/charts/rebase` aceita os mesmos valores.

## Como colocar seu projeto no pod

| `bundle.mode` | Como | Quando |
|---|---|---|
| `image` (padrão) | Construa `FROM rebasepro/server` com `COPY dist-bundle /bundle`, e então defina `image.repository` | Quase sempre. Um único artefato, imutável, sem dependência em tempo de execução de que uma URL permaneça online |
| `url` | Imagem padrão; o runtime baixa um tarball a cada inicialização do pod | Um plano de controle que distribui bundles fora de banda |

## Um processo ou vários

O padrão é um único Deployment servindo tudo — o mesmo formato executado pelo
arquivo Compose. Dividir exige apenas um valor:

```yaml
split: true
functions:
  enabled: true
  replicas: 3
worker:
  enabled: true
```

Isso fornece a você uma camada de `api`, uma camada de `functions` e um `worker`, todos
a partir da mesma imagem e do mesmo bundle. Consulte [Processos Separados](/docs/deployment/split-processes)
para saber o que cada papel faz e por que você os separaria.

O que o chart agrega em relação a fazer isso manualmente é que ele **deriva as
configurações cujo modo de falha é o silêncio**, a partir dos valores que você já forneceu:

- `REBASE_ROLE` por unidade — `all` na api quando não houver unidade functions, para que ela ainda atenda suas functions
- `REBASE_MIGRATE_ON_BOOT=none` em todos os lugares, pois o Job de migração é o responsável pelo schema
- `REBASE_CRON_SCHEDULER=false` / `REBASE_JOB_WORKERS=false` na api assim que um worker existir
- `TRUSTED_PROXY_HOPS` na unidade functions
- `REBASE_RATE_LIMIT_STORE=sql` assim que um segundo processo atender requisições HTTP

Um `REBASE_ROLE` incorreto não atende HTTP enquanto `/health` continua respondendo,
de modo que a verificação de prontidão (readiness) passa e toda requisição retorna 404.
Um `REBASE_MIGRATE_ON_BOOT` ausente resulta em um crash loop cujo motivo fica registrado
em um log que ninguém está monitorando. O chart define todos eles, e `config.env` não
pode sobrescrevê-los.

### Separando o cron da execução de jobs

Dois workers com responsabilidades opostas — sem novos papéis e sem código:

```yaml
worker:
  enabled: true
  cronScheduler: true
  jobWorkers: false
```

## O painel de administração e qualquer outro front-end

Uma aplicação estática usa a mesma imagem de runtime inicializando um bundle
`kind: static`. Esse caminho é interrompido antes que o runtime leia `DATABASE_URL`
ou `JWT_SECRET`, portanto esses pods **não possuem nenhum secret**.

```yaml
staticApps:
  - name: admin
    path: /admin
    image:
      repository: my-registry/my-admin
      tag: "1.4.0"
```

O ingress roteia `/admin` para ela e `/` para a API, no **mesmo host**. Isso é
deliberado: mesma origem significa que a autenticação por cookie e o CORS permanecem
exatamente iguais, e a separação continua sendo uma decisão de topologia interna
em vez de uma mudança na superfície pública do seu produto. O preço disso é que os
assets estáticos devem ser *compilados* para esse caminho, o que o runtime valida
na inicialização.

Fazer o deploy do admin passa a ser apenas atualizar a tag da imagem em um único
Deployment. O backend não reinicia.

## Schema

`migrationJob.enabled` (o padrão) executa um Job `pre-install,pre-upgrade` que faz o
provisionamento e é finalizado, e cada pod inicializa com `REBASE_MIGRATE_ON_BOOT=none`.
Nada no caminho da requisição gerencia o schema das tabelas, o que é a resposta mais
limpa possível para "exatamente um processo provisiona o schema" — deixa de ser uma
regra que alguém precisa lembrar. Os pods ainda mantêm as tabelas do próprio framework
(auth, chaves de API, jobs, cron) atualizadas na inicialização; `provision: false`
desativa isso também, não renderiza nenhum Job e deixa o schema a cargo de uma
[execução de provisionamento](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database)
sob seu próprio processo de mudanças.

`mode: ensure` cria o que estiver faltando de forma aditiva, e é o único modo aceito
pela imagem de runtime. `push` é recusado na inicialização: aplicar alterações no schema
de tabelas é destrutivo, e o `rebase db push` a partir de um checkout ou CI simula a
alteração (dry-run), recusa mudanças destrutivas sem confirmação e pode realizar um
backup previamente — coisas que um pod inicializando sem supervisão não consegue fazer.

## O que o chart se recusa a renderizar

Cada uma dessas é uma configuração que não gera erro em tempo de execução — a
implantação sobe e algo silenciosamente deixa de funcionar. Em vez disso, o `helm install`
falha, indicando qual valor deve ser alterado:

- mais de um processo HTTP com `sharedState.rateLimitStore=memory`
- `functions.enabled` ou `worker.enabled` enquanto `split=false`
- duas aplicações estáticas reivindicando o mesmo caminho, ou uma reivindicando um caminho sob `/api`
- `bundle.mode=image` enquanto `image.repository` ainda for a imagem padrão de runtime
- `ingress.enabled` sem host, ou `bundle.mode=url` sem URL
- um `migrationJob.mode` ou `sharedState.rateLimitStore` não reconhecido
- ausência de `config.adminEmail` com o auto-registro desativado — um release no qual ninguém
  consegue fazer login. Defina os dois valores de admin, ou `config.allowSelfRegistration=true`
  entendendo que a primeira pessoa a acessar o formulário de cadastro se tornará a administradora
- um `config.adminPassword` com menos de 12 caracteres, ou um `config.adminEmail` cujo
  domínio não possua ponto. O runtime se recusa a inicializar qualquer um deles durante a
  inicialização (seed), resultando na mesma situação de bloqueio de acesso

## O que o chart não pode fazer por você

**Broadcast e presença em tempo real (Realtime) entre réplicas.** O barramento de canal
padrão do runtime funciona em memória; portanto, com mais de uma réplica de API, um
assinante em um pod não verá um broadcast publicado em outro. A correção fica na
configuração do seu projeto, não no chart:

```ts
realtime: { bus: { type: "postgres" } }
```

Defina `sharedState.channelBusConfigured: true` para declarar que você configurou isso —
o chart usa essa flag apenas para decidir se deve exibir um aviso. Assinaturas normais
de tabelas não são afetadas; estas trafegam através do CDC do Postgres.

O restante do que um processo mantém isolado — arquivos locais, uploads retomáveis,
o cache de transformação de imagem, o Logs Explorer — está listado com a configuração
que compartilha cada um deles em [Executando mais de uma instância](/docs/deployment/multiple-instances/).
