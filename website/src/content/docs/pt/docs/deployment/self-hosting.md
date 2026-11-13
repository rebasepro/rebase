---
sourceHash: cfc9a95285da2353
title: Auto-hospedagem
sidebar_label: Auto-hospedagem
description: Execute o Rebase em qualquer lugar com a imagem oficial do runtime e o bundle do seu projeto — Docker Compose, Fly, Railway ou uma VPS comum.
---

## Visão Geral

Fazer auto-hospedagem do Rebase significa executar duas coisas: um banco de dados Postgres e a imagem oficial `rebasepro/server` com o bundle do seu projeto montado nela.

**Não há imagem de aplicação para construir**. Seu projeto transita como um bundle, o runtime é publicado e atualizar o Rebase é uma mudança de tag em vez de uma reconstrução. Consulte [Runtime e bundles](/docs/architecture/runtime-and-bundles/) para saber por que ele é dividido dessa forma.

## Docker Compose

**Se o seu projeto veio do `rebase init`, use o próprio `docker-compose.yml` dele.**
Ele está no seu repositório, o `init` preencheu seus segredos, sua primeira conta de administrador e sua versão fixada do runtime, e ele é o arquivo que [Implantação](/docs/getting-started/deployment/#docker-compose-recommended) descreve:

```bash
rebase build
docker compose up -d
```

O restante desta página trata da mesma implantação sem um scaffold por trás — o projeto de outra pessoa, um bundle construído em CI ou as duas coisas que o arquivo gerado deliberadamente omite: um pooler de conexões e os formatos de processos divididos. Esse arquivo reside no repositório, em [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Use-o em vez de copiar um trecho desta página: ambos os arquivos são inicializados pelo próprio gate de aceitação do projeto a cada push, portanto nenhum dos dois pode divergir do que realmente funciona.

Os dois concordam em todas as variáveis de ambiente, exceto a senha do banco de dados, e isso ocorre porque cada um foi escrito para seu próprio gerador: este lê `POSTGRES_PASSWORD`, que o `quickstart.sh` gera; o gerado lê `DATABASE_PASSWORD`, que o `rebase init` também embute na `DATABASE_URL` gravada no seu `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

O `quickstart.sh` é um comando único que faz duas coisas óbvias e imprime ambas. O formato longo, caso prefira controlar cada etapa:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Você não precisa iniciar o banco de dados separadamente — a `api` aguarda o healthcheck dele.

### Os seis valores necessários

O `quickstart.sh` gera isso para você. Para escrever o `.env` manualmente:

```bash
cat > infra/docker/.env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
REBASE_SERVICE_KEY=$(openssl rand -hex 32)
CORS_ORIGINS=https://app.example.com
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=$(openssl rand -hex 16)
EOF
```

Três segredos, um fato e a conta com a qual você faz login:

- **`POSTGRES_PASSWORD`** — a senha do banco de dados. Alterá-la mais tarde significa alterá-la no volume também, portanto escolha-a uma única vez.
- **`JWT_SECRET`** — assina todas as sessões. Rotacioná-la desconecta todos os usuários.
- **`REBASE_SERVICE_KEY`** — a credencial que ignora a segurança em nível de linha (row-level security) para chamadas servidor-para-servidor. Trate-a como uma senha de root: qualquer coisa que a possua pode ler todas as linhas.
- **`CORS_ORIGINS`** — as origens a partir das quais seu frontend é servido, separadas por vírgula. Não é um segredo e não é opcional: o runtime se recusa a iniciar em produção sem ele em vez de tentar adivinhar, porque uma API que adivinha suas origens permitidas eventualmente permite a errada.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — o primeiro administrador. Um banco de dados novo não tem usuários e, fora de produção, a política de registro aceita o primeiro cadastro e o promove a administrador — caso contrário, um banco de dados vazio seria um beco sem saída, já que inicializar um admin precisa de um chamador que já esteja autenticado. No momento em que essa stack responde em um hostname, essa conveniência se torna uma corrida que o operador pode perder; por isso, em produção a janela é fechada e a conta é nomeada aqui. O runtime a cria uma vez, enquanto a tabela de usuários estiver vazia, e não faz nada a cada inicialização posterior.

`JWT_SECRET` e `REBASE_SERVICE_KEY` devem ter pelo menos 32 caracteres cada, e a senha de admin pelo menos 12. Use um endereço com um ponto no domínio: `POST /auth/login` faz o parse do corpo com `z.string().email()`, portanto o runtime se recusa a fazer seed de `admin@localhost` — uma conta na qual ninguém conseguiria fazer login — e registra o motivo nos logs. O arquivo compose declara todas as seis com `${VAR:?…}`, de modo que a ausência de uma interrompe a stack com uma mensagem indicando-a, em vez de iniciar algo parcialmente configurado — e o autorregistro vem desativado (`DISABLE_SELF_REGISTRATION`, padrão `true`), para que nada fique desprotegido.

Faça login com essas credenciais e altere a senha: elas estão salvas em um arquivo no host.

## Dependências

O `rebase build` **instala as dependências do seu projeto dentro do bundle** por padrão, de modo que o `dist-bundle` vem com um `node_modules` e um `package-lock.json` ao lado do seu `package.json`. Um bundle com dependências embutidas (vendored) inicializa em cerca de cinco segundos.

Como elas já estão lá, você pode montar o bundle como somente leitura — algo que vale a pena fazer, já que um hook comprometido não poderá sobrescrever o código executado após a próxima reinicialização:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

O comando `rebase build --no-vendor` desativa isso e produz um bundle que instala suas dependências na primeira inicialização, o que leva de 40 a 60 segundos por inicialização e exige que o ponto de montagem seja gravável.

Para uma implantação real, prefira embutir ambos em uma imagem, o que também fixa com precisão o que é executado:

```dockerfile
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

## Criando o schema

<span class="since-badge" data-since="0.31">Desde a 0.31</span>

**O runtime cria as tabelas ausentes na inicialização, incluindo as que `backend/schema` declara.**
O padrão de `REBASE_MIGRATE_ON_BOOT` é `ensure`, que é aditivo em todo o schema: ele cria tabelas, colunas e tipos enum ausentes, e aplica a segurança em nível de linha (RLS) correspondente. Uma primeira inicialização em um banco de dados vazio já sobe servindo suas tabelas, sem nenhuma etapa separada.

O que o `ensure` deliberadamente nunca faz é alterar qualquer coisa que já exista. Ele não altera o tipo de uma coluna, não exclui uma tabela ou coluna e não edita os rótulos de um enum existente — pois o reinício de um container não deve ser capaz de remodelar um schema como efeito colateral de um deploy.

Portanto, ainda vale a pena executar o `rebase db push` para aquilo que a inicialização não mexe — qualquer alteração que não seja puramente aditiva: uma coluna renomeada, um tipo mais restrito, um campo removido.

```bash
rebase db push
```

Execute-o a partir de um checkout ou de um job de CI, apontado para o banco de dados da implantação. Ele simula a alteração primeiro (dry-run), recusa mudanças destrutivas sem confirmação explícita e pode fazer um backup antes de aplicar. O banco de dados expõe uma porta no arquivo compose para que seja possível alcançá-lo a partir do host; remova esse mapeamento assim que o schema estiver definido se o banco de dados não dever ser acessível externamente.

`REBASE_MIGRATE_ON_BOOT` aceita `ensure` e `none`, e nada mais — a imagem **se recusa a inicializar** com `push`, pelo motivo citado acima.

## Quando apenas o seu processo de mudança pode alterar o banco de dados

`REBASE_MIGRATE_ON_BOOT=none` não mexe nas suas tabelas. Mas não deixa o banco de dados intocado: as tabelas do próprio framework (auth, chaves de API, jobs, cron) ainda são criadas e mantidas atualizadas a cada inicialização. Quando o banco de dados só puder ser alterado por meio de um processo de mudança revisado, defina `REBASE_PROVISION=false` em todos os processos que atendem requisições:

| Configuração | Tabelas e políticas declaradas | Tabelas do framework |
|---|---|---|
| padrão (`REBASE_MIGRATE_ON_BOOT=ensure`) | criadas e mantidas atualizadas na inicialização | criadas e mantidas atualizadas |
| `REBASE_MIGRATE_ON_BOOT=none` | não modificadas | criadas e mantidas atualizadas |
| `REBASE_PROVISION=false` | não modificadas | não modificadas; o que estiver ausente é informado no log |

Com o provisionamento desativado, o runtime não cria nem altera nada: nenhuma tabela, coluna, índice, função, trigger, política, role ou permissão (grant). Isso vale na inicialização e posteriormente, incluindo as tabelas que um processo de atendimento criaria no primeiro uso (chaves de idempotência, reivindicações de cron, contadores compartilhados de rate limit). Em vez disso, ele lê o que já existe:

- **Tabelas de autenticação ou uma coluna lida pela autenticação ausentes:** a inicialização é recusada e lista cada uma delas.
- **A role de requisição pode acessar uma tabela do framework** como `rebase.refresh_tokens` ou `rebase.api_keys`: a inicialização é recusada e exibe o comando `REVOKE` a ser executado. Uma inicialização com provisionamento remove esses privilégios por conta própria. Com o provisionamento desativado, nada faz isso.
- **Uma tabela opcional ausente** (chaves de API, chaves de idempotência, reivindicações de cron, contadores de rate limit, presença, histórico de métricas): esse recurso é desativado e o log indica qual tabela é necessária.
- <span class="since-badge" data-since="0.31">Desde a 0.31</span> **Uma tabela declarada que o banco de dados não protege** — segurança em nível de linha (RLS) desativada, nenhuma das políticas declaradas presente ou uma política restritiva declarada ausente: essa tabela não é servida (uma política permissiva ausente é servida, com um aviso na inicialização indicando-a). Uma requisição para ela responde `503 TABLE_WITHHELD`, e o log de inicialização informa o SQL que a protege (ou `rebase db push`). As outras tabelas continuam sendo servidas, e a inicialização prossegue. Uma junção many-to-many é verificada da mesma forma: uma que o banco de dados não protege retém as tabelas cujas relações a utilizam, e o erro `TABLE_WITHHELD` nomeia a junção. Uma tabela cuja relação `via` passa por uma tabela retida também é retida, e a mensagem indica a relação. Isso também se aplica com `REBASE_MIGRATE_ON_BOOT=none` e em uma atualização de schema em tempo real (live schema refresh).

As linhas ainda sofrem alterações, como em qualquer banco de dados: logins, sessões, uso de chaves de API, chaves de idempotência, reivindicações de cron. A primeira conta de administrador (`REBASE_ADMIN_EMAIL`) é populada pela execução de provisionamento, não pelos processos de atendimento. A [Edição de schema ao vivo](/docs/backend/live-schema-editing) ainda pode commitar uma alteração no código-fonte, mas se recusa a aplicá-la ao banco de dados.

### A execução de provisionamento

O schema vem de uma execução controlada pelo seu processo de mudança. Use a mesma imagem e bundle do servidor, com `REBASE_PROVISION_ONLY=true`, conectado como uma role que tenha permissão de criação no banco de dados. O `REBASE_PROVISION_SQL_OUT` salva todas as alterações de schema feitas pela execução como um script SQL:

```bash
docker run --rm \
  -e DATABASE_URL="postgres://admin:…@scratch-db:5432/app" \
  -e JWT_SECRET="…" \
  -e CORS_ORIGINS="https://app.example.com" \
  -e REBASE_PROVISION_ONLY=true \
  -e REBASE_PROVISION_SQL_OUT=/out/rebase.sql \
  -v "$PWD/out:/out" \
  -v "$PWD/dist-bundle:/bundle" \
  "rebasepro/server:$REBASE_VERSION"
```

A imagem roda com `NODE_ENV=production`, então essa execução é submetida às mesmas verificações de ambiente que o servidor, incluindo `CORS_ORIGINS` ou `FRONTEND_URL`, embora não sirva nada.

O script é um registro, não um plano: cada instrução contida nele foi executada, em ordem, e teve sucesso. Registrado contra um banco de dados vazio, ele representa todo o schema que a release precisa. Registrado contra uma cópia restaurada de produção, ele é exatamente a atualização. As linhas gravadas pela execução não estão nele. Revise-o e, em seguida, aplique-o ao banco de dados real:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Faça isso novamente a cada atualização do Rebase, antes do rollout dos processos de atendimento. Uma versão pode adicionar uma tabela ou coluna, e um processo que não tem permissão para criá-la reportará que ela está ausente em vez de criá-la.

Um servidor construído por você segue a mesma regra: `initializeRebaseBackend` lê `REBASE_PROVISION`, e `createRebaseBackend` aceita [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Armazenamento de arquivos

O armazenamento fica **desativado** a menos que um bucket seja configurado, e isso é deliberado: o padrão alternativo seria o sistema de arquivos do container, que perderia silenciosamente todos os arquivos enviados na próxima reinicialização. Os uploads são recusados com `501 STORAGE_NOT_CONFIGURED` até que você configure um.

Para um bucket, defina `STORAGE_TYPE=s3` (ou `gcs`), além do bucket e de suas credenciais — o arquivo compose lista as variáveis comentadas. O `gcs` carrega o `@google-cloud/storage`, que a imagem oficial não inclui; portanto, nessa imagem, acesse o Google Cloud Storage por meio de seu endpoint compatível com S3 (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, chaves HMAC).

Para disco local, o que só é adequado quando o caminho for um volume real que sobreviva ao container:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` não é opcional nesse caso: em produção, um backend `local` é descartado em vez de registrado, pois a alternativa seria aceitar uploads em um sistema de arquivos prestes a ser destruído. A variável é a forma de você declarar que a montagem é durável.

Monte o volume **acima** de `STORAGE_PATH`, não diretamente nele. `STORAGE_PATH` é o diretório do bucket padrão, e cada bucket declarado em `backend/resources.ts` ganha o seu próprio ao lado dele, `<STORAGE_PATH>__<key>`. Um volume apontado diretamente para `STORAGE_PATH` conterá apenas o bucket padrão. Todos os outros buckets gravarão no sistema de arquivos do container e perderão seus arquivos quando o container for recriado. `STORAGE_PATH__MEDIA` pode mover um bucket para outro lugar no volume. Ele não pode movê-lo para dentro do diretório de outro bucket, como `/storage/uploads/media`, pois o bucket padrão passaria a listar, servir e excluir seus arquivos.

A imagem cria `/storage` para o usuário não privilegiado `node` com o qual ela executa, razão pela qual o volume deve ficar lá. Um volume montado onde a imagem não possui um diretório pertence ao root, e todo upload falha com `EACCES`. O arquivo compose gerado pelo `rebase init` faz a montagem dessa forma.

### O armazenamento precisa de um modelo de controle de acesso

Assim que um bucket **está** configurado, o runtime **se recusa a inicializar em produção** até que a implantação declare como os objetos são protegidos. O armazenamento não está sob segurança em nível de linha (RLS) e suas chaves compartilham um namespace único e plano, portanto, sem regras, a única coisa que separa os arquivos de dois usuários é a impossibilidade de adivinhar as chaves — o que `GET /storage/list?prefix=` contorna. Qualquer uma das seguintes opções satisfaz a exigência:

- um **hook `storageAuthorize`** (ou `storagePolicies`) na configuração do seu projeto, que é a resposta real e o que o scaffold fornece em `backend/storage.ts` — nenhuma variável de ambiente consegue expressar "este usuário pode ler esta chave";
- **`STORAGE_PUBLIC_READ=true`**, para um bucket que é genuinamente uma CDN pública somente leitura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para um aplicativo single-tenant onde qualquer conta autenticada tem permissão de acesso a todos os arquivos.

Fora de produção, a mesma condição emite um aviso evidente em vez de uma recusa; portanto, essa é uma falha de inicialização com a qual você se depara no deploy, e não no computador de desenvolvimento. Isso é intencional: a falha que ela substitui é silenciosa.

Defina também `MFA_ENCRYPTION_KEY` se você usar TOTP. Se deixado em branco, os segredos de autenticador armazenados serão criptografados com `JWT_SECRET` — logo, rotacioná-lo desconectará todos os usuários *e* tornará todos os dispositivos cadastrados indecifráveis.

## Outras plataformas

O runtime é um container comum escutando na porta `$PORT`, portanto qualquer plataforma que execute containers funciona. Duas coisas que você deve configurar corretamente em qualquer lugar:

1. O bundle deve estar presente em `/bundle` (ou onde `REBASE_BUNDLE` apontar), com suas dependências instaladas ao lado dele — consulte [Dependências](#dependências).
2. Defina `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. O runtime se recusa a iniciar em produção sem eles em vez de tentar adivinhar.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.30.1 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Use o formato de imagem derivada acima para que o bundle vá junto com o app e, em seguida, execute `fly deploy`.

### Railway / Render

Aponte o serviço para a imagem derivada, defina as variáveis de ambiente e configure o caminho do health check para `/livez`.

### Uma VPS comum

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` lista as variáveis que ele lê. No systemd:

```ini title="/etc/systemd/system/rebase.service"
[Service]
ExecStart=/usr/bin/rebase-server /srv/myapp/dist-bundle
Restart=always
Environment=NODE_ENV=production
Environment=DATABASE_URL=postgresql://rebase:...@127.0.0.1:5432/rebase
Environment=ALLOW_LOCALHOST_IN_PRODUCTION=true
Environment=JWT_SECRET=...
Environment=REBASE_SERVICE_KEY=...
Environment=CORS_ORIGINS=https://app.example.com
Environment=DISABLE_SELF_REGISTRATION=true
Environment=REBASE_ADMIN_EMAIL=you@example.com
Environment=REBASE_ADMIN_PASSWORD=...
```

`NODE_ENV=production` não é enfeite. Se não for definido, o processo roda em modo de desenvolvimento: ele reflete origens de localhost, serve a especificação OpenAPI e **deixa a janela do primeiro administrador aberta** — assim, o primeiro estranho que encontrar o formulário de cadastro se tornará o administrador. As duas linhas `REBASE_ADMIN_*` são as que fecham essa janela; consulte [Seu primeiro admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` está ali porque o banco de dados fica na mesma máquina. Em produção, o runtime recusa qualquer variável que aponte para localhost — em um container, o loopback é o próprio container, então esse endereço é sempre um engano — e essa linha informa que o endereço é intencional. Remova-a quando o banco de dados rodar em outro lugar.

Prefira `EnvironmentFile=/etc/rebase.env` com o arquivo no modo 0600 em vez de linhas `Environment=` para os segredos: um arquivo de unidade (unit file) pode ser lido por qualquer usuário, e o `systemctl show` exibe todos os valores de `Environment=`.

## Pooling de conexões

O runtime mantém um pool pequeno e de longa duração e não precisa de um pooler. O que precisa é todo o resto que se comunica com o mesmo banco de dados e não pode manter conexões persistentes: uma função serverless, um script agendado, uma ferramenta de BI, um worker de fila que escala para cinquenta instâncias. O `max_connections` do Postgres é um limite estrito na casa das centenas e cada conexão é um *processo*, de modo que uma explosão de lambdas o esgota muito antes de o banco de dados ficar ocupado.

O arquivo compose traz um serviço `pgbouncer` para esse tráfego, protegido por um profile para que uma implantação sem esse tipo de cliente não execute um processo desnecessário:

```bash
docker compose --profile pooler up -d
```

```
postgres://rebase:$POSTGRES_PASSWORD@your-host:6432/rebase
```

```bash
PGBOUNCER_PORT=6432           # host port
PGBOUNCER_MAX_CLIENT_CONN=500 # client connections accepted
PGBOUNCER_POOL_SIZE=20        # server connections used to serve them
```

A autenticação do cliente é gerada a partir da `DATABASE_URL` na inicialização, portanto a senha não é escrita duas vezes. O pooler autentica no Postgres com `scram-sha-256`, que o Postgres 18 armazena — o padrão `md5` da imagem falha no login do *servidor* com `FATAL: server login failed: wrong password type`, o que parece um erro de senha incorreta, mas não é.

Mantenha a soma de `PGBOUNCER_POOL_SIZE` de todos os poolers confortavelmente abaixo do `max_connections` do banco de dados — o runtime consome do mesmo limite.

### O que o transaction pooling muda

Um cliente sob pooling retém uma conexão do servidor pela duração de uma transação e depois a devolve, o que permite que 500 clientes compartilhem 20 conexões. Três coisas param de funcionar através dessa porta, e todas elas são usadas pelo próprio Rebase — e é exatamente por isso que o runtime se conecta diretamente e essa porta é destinada a outros clientes:

- **`LISTEN`/`NOTIFY`.** O Realtime é construído sobre isso, e um listener precisa de uma conexão que dure mais do que uma transação. O `LISTEN` é *aceito* através do pooler — ele responde `LISTEN`, e então nenhuma notificação chega.
- **Estado de sessão**: `SET` (ao contrário de `SET LOCAL`), advisory locks mantidos entre instruções, cursores `WITH HOLD`, tabelas temporárias. A próxima transação pode cair em uma conexão de servidor diferente, que não verá nada disso. Ambos falham da mesma forma enganosa: com apenas um cliente ocioso, o estado geralmente ainda está lá, funcionando durante os testes e quebrando sob a concorrência para a qual você adicionou o pooler.
- **Prepared statements no nível do protocolo.** A maioria dos drivers pode ser configurada para não usá-los — o node-postgres não usa por padrão; o asyncpg precisa de `statement_cache_size=0`.

`SET LOCAL` tem escopo de transação e funciona, sendo o mecanismo usado para definir a segurança em nível de linha (RLS) — portanto, o RLS se comporta de forma idêntica através da porta em pool.

Mantenha o profile desativado se nada fora do runtime se conectar ao seu banco de dados. Uma porta sem uso é superfície de ataque exposta.

## Health checks

| Caminho | Uso |
| --- | --- |
| `/livez` | Liveness. Responde se "este processo está vivo" sem tocar no banco de dados. |
| `/health` | Readiness. Executa uma viagem de ida e volta ao banco de dados (round-trip) e relata a latência. |

Aponte os probes de liveness para `/livez`. Um probe de liveness em `/health` reinicia um processo perfeitamente saudável durante uma oscilação momentânea do banco de dados, o que é o oposto do seu propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expõe métricas do Prometheus em `/metrics`: contagens de requisições e histogramas de latência detalhados por superfície de API (data, auth, storage, functions) e tabela, além de medidores (gauges) do processo. Sem um token, o endpoint pode ser lido por qualquer um que consiga alcançar a porta, portanto configure um, a menos que ele esteja em uma rede privada.

`rebase_db_pool_wait_ms` é um histograma de quanto tempo cada consulta aguardou por uma conexão do pool do banco de dados, abertura de conexão inclusa, rotulado pela chave da fonte de dados (`source="(default)"` em um projeto que não declara fontes de dados). Um pool saudável o mantém próximo de zero. Uma cauda que cresce com o tráfego significa que as requisições estão formando fila por conexões — mais frequentemente retidas por hooks de escrita que aguardam algo lento; consulte [Um hook retém uma conexão](/docs/collections/context-data-api/#a-hook-holds-a-connection).

O banco de dados em si, por fonte de dados:

| Métrica | O que ela indica |
|--------|--------------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Conexões de cada pool, rotuladas como `pool="primary"`, `"read"` (a réplica) ou `"session"` (o pool direto do console SQL atrás de um pooler). Um valor de `waiting` acima de zero por muito tempo indica um pool pequeno demais para sua carga. |
| `rebase_db_connection_errors_total` | Requisições respondidas com 503 por falta de conexão, por `code`: `53300` / `53400` (o servidor está sem conexões), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Conexões de cliente no servidor, por `state`, em comparação com `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | O tamanho do banco de dados. |
| `rebase_db_replica_lag_seconds` | Quanto a `DATABASE_READ_URL` está atrasada em relação à primária. |

As últimas quatro são coletadas a cada 30 segundos na própria conexão da instância, de modo que uma coleta (scrape) nunca se transforma em uma consulta.

`rebase_realtime_*` relata os sockets e canais abertos de cada instância e os quadros enviados ao barramento de canais ou retidos: consulte [Vendo o que o barramento faz](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Cabeçalhos de segurança

Toda resposta inclui `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` e `Strict-Transport-Security: max-age=15552000` (180 dias). O cabeçalho HSTS omite `includeSubDomains`: isso diria aos navegadores para recusar HTTP simples em todos os subdomínios do seu domínio, incluindo aqueles com os quais este servidor não tem relação alguma, e o navegador mantém isso pelo tempo especificado no cabeçalho.
Defina `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` quando todos os subdomínios forem exclusivamente HTTPS.

`strict-origin-when-cross-origin` é o padrão dos próprios navegadores: uma requisição para outro site carrega a sua origem e nunca o caminho ou a query da página. Não é `no-referrer` porque verificações de origem precisam da origem — o botão de login do Google a compara com as origens JavaScript autorizadas do cliente OAuth e, com `no-referrer`, ele respondia "The given origin is not allowed for the given client ID" em qualquer app, independentemente do que o cliente autorizasse. Uma resposta que define sua própria política a mantém (a página de consentimento do MCP envia `no-referrer`); uma página que queira uma política mais estrita pode declarar isso com `<meta name="referrer" content="no-referrer">`. `X-Frame-Options` funciona da mesma maneira: `SAMEORIGIN`, a menos que a resposta defina a sua própria, como a página de consentimento do MCP faz com `DENY`.

Os aplicativos estáticos — o admin do CMS e qualquer frontend servido pelo bundle — também trazem `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Isso define quem pode enquadrar a aplicação em frames/iframes, descarta plugins e fixa `<base>` na sua origem, sem restringir nada além disso, permitindo que scripts inline, workers e autenticação de terceiros continuem funcionando. Uma resposta que define sua própria política a mantém. Para algo mais rigoroso, configure a política no proxy reverso à frente.

## Mais de uma instância

Um único container é o padrão e não precisa de mais nada. Antes que uma segunda réplica receba tráfego — ou que um rolling deploy execute duas lado a lado —, consulte [Executando mais de uma instância](/docs/deployment/multiple-instances/): rate limits, canais de broadcast, arquivos locais, uploads retomáveis e o cache de imagens são isolados por processo até que uma configuração os compartilhe.

## Conectando o Claude

Um único comando adiciona este servidor ao [Rebase connector](/docs/ai/rebase-connector/), o conector MCP unificado que alcança todos os seus projetos a partir do Claude:

```bash
rebase cloud connect https://your-app.com
```

Defina as duas variáveis exibidas por ele neste servidor e reinicie-o. O servidor deve rodar o Rebase 0.28.1 ou posterior e responder via https em um endereço público. Nada mais muda: ele não guarda segredos e concede ao conector o mesmo acesso que o Studio concederia.

## Executando funções em seu próprio processo

Tudo o que foi visto acima é um único container servindo todo o projeto, que é o formato ideal para quase todas as implantações. Quando uma função customizada precisar parar de disputar o event loop com a API de dados — ou precisar escalar, reiniciar e falhar de forma independente —, a mesma imagem e o mesmo bundle podem ser inicializados como vários processos cooperantes. Consulte [Processos divididos](/docs/deployment/split-processes/).

## Atualização

```yaml
image: rebasepro/server:0.30.1
```

Reinicie. Seu bundle permanece inalterado. Dentro de uma mesma versão major do contrato de runtime, um bundle que foi validado continuará funcionando — consulte [Compatibilidade](/docs/architecture/runtime-and-bundles/#compatibility).
