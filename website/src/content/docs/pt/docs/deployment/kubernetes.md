---
sourceHash: 51abd249a5639803
title: Kubernetes
sidebar_label: Kubernetes
description: Faça o deploy do Rebase em um cluster Kubernetes com o Helm chart oficial — um ou vários Deployments, um Job de migração proprietário do schema e apps estáticos no mesmo host.
---

## Visão Geral

O chart oficial é o equivalente no Kubernetes da configuração de auto-hospedagem
(self-hosting) com Docker Compose. Mesma ideia, mesma imagem, mesmo bundle: **o
runtime é a imagem, seu projeto é o bundle e atualizar o Rebase é uma alteração de tag.**

Ele é publicado como um artefato OCI ao lado da imagem do runtime, e ambos
possuem a mesma versão — o chart que faz o deploy do runtime `0.17.3` *é* o
chart `0.17.3`, então há apenas um número para acompanhar. Sem `--version`,
você obtém a versão mais recente; fixe-a para um deploy real, da mesma forma
que você fixaria o `image.tag`:

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

O chart vem com o auto-registro desativado, portanto, uma release precisa indicar
a conta com a qual seu operador fará login — caso contrário, ele inicializa com
uma tabela de usuários vazia e nenhuma maneira de gerar o primeiro chamador autenticado.
`config.adminPassword` deve ter pelo menos 12 caracteres e `config.adminEmail` precisa
de um ponto no domínio: a rota de login analisa seu corpo com `z.string().email()`,
então `admin@localhost` é uma conta na qual ninguém conseguiria fazer login e o runtime
se recusa a criá-la (seed). Ambas são recusas em tempo de renderização, em vez de
surpresas em tempo de execução — veja [o que o chart se recusa a
renderizar](#o-que-o-chart-se-recusa-a-renderizar). Faça o login e altere a senha;
esses valores são gravados em uma Secret.

Em vez disso, gerencie-os fora de banda apontando `existingSecret` para uma Secret
contendo `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` junto com
`DATABASE_URL` e o restante.

O chart faz o deploy **apenas do runtime**. Ele não faz o deploy do Postgres — use
CloudNativePG, um banco de dados gerenciado ou seu próprio StatefulSet, e aponte
`config.databaseUrl` para ele. Um chart que também gerenciasse seu banco de dados
seria responsável pelos seus backups e seu failover, o que é uma promessa muito
maior do que "executar a aplicação".

> **Maturidade.** Duas coisas distintas são verificadas no CI, e uma terceira não é.
> O chart é submetido a lint e renderizado com o Helm v4.2.4 — cada topologia
> documentada nesta página, incluindo o comando de instalação acima, e um caso
> que atinge cada recusa listada abaixo. A imagem do runtime que o chart implanta é
> construída e inicializada contra um Postgres real, de ambas as maneiras que um bundle pode chegar. O que
> **nunca foi executado é o chart contra um cluster ativo**: nada agendou
> esses manifestos, portanto os probes, a ordenação do Job de migração pré-instalação e
> o ingress estão corretos como YAML e não comprovados como um deploy. Considere-o como um
> ponto de partida bem testado, e não como um padrão comprovado em produção, e leia
> [Self-Hosting](/docs/deployment/self-hosting) para o caminho comprovado.

Para trabalhar a partir de um checkout local — um chart modificado ou uma
instalação isolada (air-gapped) — `helm install rebase ./infra/charts/rebase` aceita
os mesmos valores.

## Como colocar seu projeto no pod

| `bundle.mode` | Como | Quando |
|---|---|---|
| `image` (padrão) | Crie com `FROM rebasepro/server` e `COPY dist-bundle /bundle`, depois defina `image.repository` | Quase sempre. Um único artefato, imutável, sem dependência em tempo de execução de uma URL permanecer ativa |
| `url` | Imagem padrão; o runtime baixa um tarball a cada inicialização do pod | Um plano de controle que distribui bundles fora de banda |

## Um processo, ou vários

O padrão é um único Deployment servindo tudo — o mesmo formato executado pelo
arquivo Compose. Dividir requer apenas um valor:

```yaml
split: true
functions:
  enabled: true
  replicas: 3
worker:
  enabled: true
```

Isso fornece uma camada `api`, uma camada `functions` e um `worker`, todos a partir
da mesma imagem e do mesmo bundle. Consulte [Processos Divididos](/docs/deployment/split-processes)
para entender o que cada função faz e por que você os separaria.

O que o chart acrescenta em relação a fazer isso manualmente é que ele **deduz as
configurações cujo modo de falha é o silêncio**, a partir dos valores que você já forneceu:

- `REBASE_ROLE` por unidade — `all` na API quando não há unidade de funções, para que ela ainda execute suas funções
- `REBASE_MIGRATE_ON_BOOT=none` em todos os lugares, porque o Job de migração é o proprietário do schema
- `REBASE_CRON_SCHEDULER=false` / `REBASE_JOB_WORKERS=false` na API assim que um worker existir
- `TRUSTED_PROXY_HOPS` na unidade de funções
- `REBASE_RATE_LIMIT_STORE=sql` assim que um segundo processo passar a servir HTTP

Um `REBASE_ROLE` incorreto não serve HTTP enquanto `/health` ainda responde, portanto o
teste de prontidão (readiness) passa e todas as requisições retornam 404. A ausência de
`REBASE_MIGRATE_ON_BOOT` gera um crash loop cuja causa fica em um log que ninguém está
monitorando. O chart define todas elas, e `config.env` não pode sobrescrevê-las.

### Dividindo o cron da execução de jobs

Dois workers com responsabilidades opostas — nenhuma nova role e nenhum código:

```yaml
worker:
  enabled: true
  cronScheduler: true
  jobWorkers: false
```

## O painel de administração e qualquer outro front-end

Um app estático é a mesma imagem de runtime inicializando um bundle `kind: static`.
Esse caminho é interrompido antes que o runtime leia `DATABASE_URL` ou `JWT_SECRET`,
de modo que esses pods **não possuem segredo algum**.

```yaml
staticApps:
  - name: admin
    path: /admin
    image:
      repository: my-registry/my-admin
      tag: "1.4.0"
```

O ingress encaminha `/admin` para ele e `/` para a API, no **mesmo host**. Isso
é deliberado: mesma origem significa que a autenticação por cookie e o CORS permanecem
exatamente como eram, e a divisão continua sendo uma decisão interna de topologia em
vez de uma alteração na superfície pública do seu produto. O custo disso é que os
assets devem ser *compilados* para esse caminho, o que o runtime verifica na inicialização.

Fazer o deploy do admin passa a ser apenas atualizar a tag da imagem em um Deployment.
O backend não reinicia.

## Schema

`migrationJob.enabled` (o padrão) executa um Job de `pre-install,pre-upgrade` que
faz o provisionamento e é finalizado, e cada pod inicializa com `REBASE_MIGRATE_ON_BOOT=none`.
Nada no caminho da requisição é responsável pelo schema das tabelas, o que é a
resposta mais limpa possível para "exatamente um processo provisiona o schema" — deixa
de ser uma regra que alguém precisa se lembrar. Os pods ainda mantêm as tabelas do
próprio framework (autenticação, chaves de API, jobs, cron) atualizadas na inicialização;
`provision: false` desativa isso também, não renderiza nenhum Job e delega o schema a uma
[execução de provisionamento](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database)
sob seu próprio processo de mudanças.

`mode: ensure` cria o que está faltando, de forma cumulativa, e é o único modo que a
imagem de runtime aceita. `push` é recusado na inicialização: aplicar alterações no
schema das tabelas é destrutivo, e o comando `rebase db push` executado a partir de um
checkout ou CI simula a alteração (dry-run), recusa mudanças destrutivas sem confirmação
e pode fazer um backup antes — nada do que um pod inicializando sem supervisão consegue fazer.

## O que o chart se recusa a renderizar

Cada uma dessas é uma configuração que não gera erros em tempo de execução — o
deploy sobe e algo silenciosamente deixa de funcionar como esperado. Em vez disso,
o `helm install` falha, indicando qual valor deve ser alterado:

- mais de um processo HTTP com `sharedState.rateLimitStore=memory`
- `functions.enabled` ou `worker.enabled` enquanto `split=false`
- dois apps estáticos reivindicando o mesmo caminho, ou um reivindicando um caminho sob `/api`
- `bundle.mode=image` enquanto `image.repository` ainda for a imagem padrão do runtime
- `ingress.enabled` sem host, ou `bundle.mode=url` sem URL
- um `migrationJob.mode` ou `sharedState.rateLimitStore` não reconhecido
- ausência de `config.adminEmail` com o auto-registro desativado — uma release na
  qual ninguém consegue fazer login. Defina os dois valores de admin, ou
  `config.allowSelfRegistration=true`, ciente de que a primeira pessoa a acessar o
  formulário de cadastro se tornará a administradora
- um `config.adminPassword` com menos de 12 caracteres, ou um `config.adminEmail` cujo
  domínio não contenha ponto. O runtime se recusa a inicializar qualquer um dos dois
  na inicialização, resultando na mesma release inacessível

## O que o chart não pode fazer por você

**Transmissão e presença em tempo real (Realtime) entre réplicas.** O barramento de
canais padrão do runtime é em memória, portanto, com mais de uma réplica da API, um
assinante em um pod não verá uma transmissão publicada em outro. A correção está na
configuração do seu projeto, e não no chart:

```ts
realtime: { bus: { type: "postgres" } }
```

Defina `sharedState.channelBusConfigured: true` para confirmar que configurou — o
chart usa isso apenas para decidir se deve emitir um aviso. Assinaturas normais
de tabelas não são afetadas; elas trafegam pelo CDC do Postgres.

O restante do que um processo mantém isolado em si — arquivos locais, uploads
retomáveis, o cache de transformação de imagens, a visualização de Logs do Studio — está
listado com a configuração correspondente para compartilhá-los em [Executando mais de uma instância](/docs/deployment/multiple-instances/).
