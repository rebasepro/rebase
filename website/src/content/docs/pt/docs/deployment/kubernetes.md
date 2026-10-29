---
sourceHash: 5764a95deb8e4e9c
title: Kubernetes
sidebar_label: Kubernetes
description: Faça o deploy do Rebase em um cluster Kubernetes com o Helm chart oficial — um Deployment ou vários, um Job de migração responsável pelo schema, e aplicações estáticas no mesmo host.
---

## Visão Geral

O chart oficial é o equivalente em Kubernetes da configuração de auto-hospedagem (self-hosting) com Docker Compose. Mesma ideia, mesma imagem, mesmo bundle: **o runtime é a imagem, seu projeto é o bundle, e atualizar o Rebase é apenas mudar uma tag.**

Ele é publicado como um artefato OCI junto com a imagem de runtime, e ambos compartilham a mesma versão — o chart que faz o deploy do runtime `0.17.3` *é* o chart `0.17.3`, logo há apenas um número para acompanhar. Sem `--version` você obtém a versão mais recente; fixe-a para um deploy real, da mesma forma que você fixaria `image.tag`:

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

O chart sai com o autorregistro desligado, então uma release precisa nomear a conta
com a qual seu operador entra — caso contrário ela sobe com a tabela de usuários vazia e
sem como produzir o primeiro chamador autenticado. `config.adminPassword` deve ter
pelo menos 12 caracteres, e `config.adminEmail` precisa de um ponto no domínio: a
rota de login valida o corpo com `z.string().email()`, então `admin@localhost`
é uma conta na qual ninguém conseguiria entrar e o runtime se recusa a criá-la. Ambas
são recusas em tempo de renderização, e não
surpresas em tempo de execução — veja [o que o chart se recusa a
renderizar](#o-que-o-chart-se-recusa-a-renderizar). Entre e troque a senha;
esses valores vão para um Secret.

Gerencie-os por fora, apontando `existingSecret` para um Secret
que contenha `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` junto com
`DATABASE_URL` e o restante.

O chart faz o deploy **apenas do runtime**. Ele não faz o deploy do Postgres — use CloudNativePG, um banco de dados gerenciado ou seu próprio StatefulSet, e aponte `config.databaseUrl` para ele. Um chart que também gerenciasse seu banco de dados teria que assumir seus backups e failover, o que é uma promessa muito maior do que apenas "executar a aplicação".

> **Maturidade.** Duas coisas separadas são verificadas em CI, e uma terceira não.
> O chart passa por lint e renderização contra o Helm v4.2.4 — todas as topologias
> documentadas nesta página, incluindo o comando de instalação acima, e um caso
> que atinge cada recusa listada abaixo. A imagem de runtime que o chart implanta é
> compilada e inicializada contra um Postgres real, das duas formas pelas quais um bundle pode chegar. O que
> **nunca rodou foi o chart contra um cluster ativo**: nada agendou
> esses manifestos, então os probes, a ordem do Job de migração de pré-instalação e
> o ingress estão corretos como YAML e não comprovados como um deploy. Trate-o como um
> ponto de partida bem testado em vez de um padrão comprovado em produção, e leia
> [Auto-hospedagem](/docs/deployment/self-hosting) para o caminho comprovado.

Para trabalhar a partir de um clone local — um chart modificado ou uma instalação air-gapped — `helm install rebase ./infra/charts/rebase` aceita os mesmos valores.

## Levando seu projeto para o pod

| `bundle.mode` | Como | Quando |
|---|---|---|
| `image` (padrão) | Crie a imagem `FROM rebasepro/server` com `COPY dist-bundle /bundle`, depois defina `image.repository` | Quase sempre. Um único artefato, imutável, sem dependência em tempo de execução de que uma URL permaneça ativa |
| `url` | Imagem padrão; o runtime baixa um tarball a cada inicialização do pod | Um painel de controle (control plane) que entrega bundles fora de banda |

## Um processo ou vários

O padrão é um único Deployment servindo tudo — o mesmo formato executado pelo arquivo Compose. A divisão requer apenas um valor:

```yaml
split: true
functions:
  enabled: true
  replicas: 3
worker:
  enabled: true
```

Isso fornece uma camada de `api`, uma camada de `functions` e um `worker`, todos a partir da mesma imagem e do mesmo bundle. Veja [Processos Divididos](/docs/deployment/split-processes) para entender o que cada função faz e por que separá-las.

O que o chart acrescenta em relação a fazer isso manualmente é que ele **deduz as configurações cujo modo de falha é silencioso**, a partir dos valores que você já forneceu:

- `REBASE_ROLE` por unidade
- `REBASE_MIGRATE_ON_BOOT=none` em todos os lugares, porque o Job de migração gerencia o schema
- `REBASE_CRON_SCHEDULER=false` / `REBASE_JOB_WORKERS=false` na api quando um worker existir
- `TRUSTED_PROXY_HOPS` na unidade de functions
- `REBASE_RATE_LIMIT_STORE=sql` assim que um segundo processo passar a servir HTTP

Um `REBASE_ROLE` incorreto não serve HTTP enquanto `/health` ainda responde, fazendo o readiness passar e toda requisição retornar 404. A ausência de `REBASE_MIGRATE_ON_BOOT` gera um loop de travamento (crash loop) cujo motivo fica em um log que ninguém está monitorando. O chart define todos eles, e o `config.env` não pode sobrescrevê-los.

### Separando o cron da execução de jobs

Dois workers com responsabilidades opostas — sem nova role e sem código:

```yaml
worker:
  enabled: true
  cronScheduler: true
  jobWorkers: false
```

## O painel de administração e qualquer outro front-end

Uma aplicação estática usa a mesma imagem de runtime inicializando um bundle `kind: static`. Esse fluxo é interrompido antes de o runtime ler `DATABASE_URL` ou `JWT_SECRET`, portanto esses pods **não contêm nenhum segredo**.

```yaml
staticApps:
  - name: admin
    path: /admin
    image:
      repository: my-registry/my-admin
      tag: "1.4.0"
```

O ingress roteia `/admin` para ele e `/` para a API, no **mesmo host**. Isso é proposital: mesma origem significa que a autenticação por cookies e o CORS permanecem exatamente iguais, e a divisão continua sendo uma decisão interna de topologia, em vez de uma alteração na superfície pública do seu produto. A contrapartida é que os assets precisam ser *compilados* para esse caminho, o que o runtime verifica durante a inicialização.

O deploy do admin passa a ser apenas o incremento da tag da imagem em um Deployment. O backend não é reiniciado.

## Schema

`migrationJob.enabled` (o padrão) executa um Job de `pre-install,pre-upgrade` que provisiona e finaliza, e cada pod inicializa com `REBASE_MIGRATE_ON_BOOT=none`. Nada no caminho das requisições gerencia o schema das coleções, o que é a resposta mais limpa para "exatamente um processo provisiona o schema" — isso deixa de ser uma regra que alguém precisa lembrar. Os pods ainda mantêm atualizadas, na inicialização, as tabelas do próprio framework (autenticação, chaves de API, jobs, cron); `provision: false` interrompe isso também, não renderiza nenhum Job e deixa o schema para uma [execução de provisionamento](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database) sob o seu próprio processo de mudanças.

`mode: ensure` cria o que estiver faltando, de forma aditiva, e é o único modo que a imagem de runtime aceita. `push` é recusado na inicialização: aplicar alterações de schema das coleções é destrutivo, e o `rebase db push`, a partir de um checkout ou do CI, faz um dry-run da mudança, recusa as destrutivas sem confirmação e pode fazer um backup antes — nada disso um pod iniciando sem supervisão consegue fazer.

## O que o chart se recusa a renderizar

Cada um destes itens é uma configuração que não gera erros em tempo de execução — o deploy sobe e algo silenciosamente deixa de funcionar. Em vez disso, o `helm install` falha, indicando qual valor deve ser alterado:

- mais de um processo HTTP com `sharedState.rateLimitStore=memory`
- `functions.enabled` ou `worker.enabled` enquanto `split=false`
- duas aplicações estáticas reivindicando o mesmo caminho, ou uma reivindicando um caminho sob `/api`
- `bundle.mode=image` enquanto `image.repository` ainda for a imagem padrão de runtime
- `ingress.enabled` sem host, ou `bundle.mode=url` sem URL
- um `migrationJob.mode` ou `sharedState.rateLimitStore` não reconhecido
- nenhum `config.adminEmail` com o autorregistro desligado — uma release na qual ninguém
  consegue entrar. Defina os dois valores de admin, ou `config.allowSelfRegistration=true`
  entendendo que a primeira pessoa a chegar ao formulário de cadastro se torna
  administradora
- um `config.adminPassword` com menos de 12 caracteres, ou um `config.adminEmail` cujo
  domínio não tem ponto. O runtime se recusa a criar qualquer um dos dois, na inicialização, e deixa a
  mesma release trancada para fora

## O que o chart não pode fazer por você

**Transmissão em tempo real (broadcast) e presença entre réplicas.** O barramento de canal padrão do runtime é em memória; portanto, com mais de uma réplica da API, um assinante em um pod não verá uma transmissão publicada em outro. A correção fica na configuração do seu projeto, e não no chart:

```ts
realtime: { bus: { type: "postgres" } }
```

Defina `sharedState.channelBusConfigured: true` para declarar que você o configurou — o chart usa isso apenas para decidir se deve emitir um aviso. Assinaturas comuns de coleções não são afetadas; elas trafegam pelo CDC do Postgres.

O restante do que um processo mantém só para si — arquivos locais, uploads retomáveis, o cache de transformação de imagens, o Logs Explorer — está listado com a configuração que compartilha cada um em [Executando mais de uma instância](/docs/deployment/multiple-instances/).
