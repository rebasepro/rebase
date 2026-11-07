---
sourceHash: dd7f515c841c860b
title: Auto-hospedagem
sidebar_label: Auto-hospedagem
description: Execute o Rebase em qualquer lugar com a imagem oficial de runtime e o bundle do seu projeto — Docker Compose, Fly, Railway ou uma VPS comum.
---

## Visão Geral

Fazer a auto-hospedagem do Rebase significa executar duas coisas: um banco de dados Postgres e a imagem oficial `rebasepro/server` com o bundle do seu projeto montado nela.

Não há **nenhuma imagem de aplicação para construir**. Seu projeto viaja como um bundle, o runtime é publicado, e atualizar o Rebase é uma simples mudança de tag em vez de uma nova compilação. Veja [Runtime e bundles](/docs/architecture/runtime-and-bundles/) para entender por que essa separação é feita dessa forma.

## Docker Compose

**Se o seu projeto foi criado com `rebase init`, use o próprio `docker-compose.yml` dele.**
Ele já está no seu repositório, o `init` preencheu seus segredos, sua primeira conta de administrador e sua versão fixada do runtime, e é o arquivo descrito em
[Implantação](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

O restante desta página trata da mesma implantação sem um scaffold pré-existente — o projeto de outra pessoa, um bundle compilado em CI, ou as duas coisas que o arquivo gerado deliberadamente deixa de fora: um pooler de conexões e as estruturas de processos divididos. Esse arquivo reside no repositório, em
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Prefira usá-lo em vez de copiar um trecho desta página: ambos os arquivos são inicializados pelo próprio teste de aceitação do projeto a cada push, portanto nenhum deles fica desalinhado com o que realmente funciona.

Ambos concordam em todas as variáveis de ambiente, exceto na senha do banco de dados, e isso acontece porque cada um foi projetado para seu respectivo gerador: este lê `POSTGRES_PASSWORD`, que o `quickstart.sh` gera; o gerado lê `DATABASE_PASSWORD`, que o `rebase init` também embute na `DATABASE_URL` que ele grava no seu `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

O `quickstart.sh` é um comando único que faz duas coisas óbvias e exibe ambas. O formato detalhado, caso você prefira gerenciar cada etapa manualmente:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Você não precisa iniciar o banco de dados separadamente — a `api` aguarda o healthcheck dele.

### Os seis valores necessários

O `quickstart.sh` gera estes valores para você. Para escrever o `.env` manualmente:

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

Três segredos, um dado de configuração e a conta usada para fazer login:

- **`POSTGRES_PASSWORD`** — a senha do banco de dados. Alterá-la mais tarde significa alterá-la também no volume, portanto, defina-a uma única vez.
- **`JWT_SECRET`** — assina todas as sessões. Rotacioná-la desconecta todos os usuários.
- **`REBASE_SERVICE_KEY`** — a credencial que ignora o row-level security para chamadas de servidor para servidor. Trate-a como uma senha de root: qualquer entidade com ela pode ler todas as linhas do banco.
- **`CORS_ORIGINS`** — as origens das quais seu frontend é servido, separadas por vírgula. Não é um segredo e não é opcional: em produção, o runtime se recusa a iniciar sem ela em vez de tentar adivinhar, pois uma API que adivinha suas origens permitidas eventualmente permitirá a origem errada.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — o primeiro administrador. Um banco de dados recém-criado não tem usuários e, fora de produção, a política de registro aceita o primeiro cadastro e o promove a administrador — caso contrário, um banco vazio seria um beco sem saída, já que inicializar um admin requer um solicitante já autenticado. No momento em que essa stack responde em um hostname público, essa conveniência se torna uma corrida que o operador pode perder; por isso, em produção, essa brecha é fechada e a conta é definida aqui. O runtime a cria uma única vez, enquanto a tabela de usuários estiver vazia, e não faz nada nas inicializações seguintes.

`JWT_SECRET` e `REBASE_SERVICE_KEY` devem ter pelo menos 32 caracteres cada, e a senha de administrador pelo menos 12. Use um endereço com ponto no domínio: `POST /auth/login` valida seu corpo com `z.string().email()`, portanto o runtime se recusa a criar `admin@localhost` — uma conta na qual ninguém conseguiria fazer login — e registra o motivo no log. O arquivo compose declara todas as seis variáveis com `${VAR:?…}`, de modo que a ausência de uma delas interrompe a stack com uma mensagem indicando-a, em vez de iniciar um serviço configurado pela metade — e o autorregistro vem desativado por padrão (`DISABLE_SELF_REGISTRATION`, padrão `true`), evitando cadastros indevidos.

Faça login com essas credenciais e altere a senha: elas estão salvas em um arquivo no host.

## Dependências

O comando `rebase build` **instala as dependências do seu projeto dentro do bundle** por padrão, portanto `dist-bundle` já chega com um `node_modules` e um `package-lock.json` ao lado do seu `package.json`. Um bundle com dependências incluídas (vendored) inicia em cerca de cinco segundos.

Como elas já estão presentes, você pode montar o bundle como somente leitura — algo altamente recomendável, já que um hook comprometido não poderá reescrever o código executado após a próxima reinicialização:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` desativa esse comportamento e gera um bundle que instala suas dependências na primeira inicialização, o que leva de 40 a 60 segundos por inicialização e exige que o ponto de montagem seja gravável.

Para uma implantação real, prefira embutir ambos em uma imagem, o que também fixa com exatidão o que é executado:

```dockerfile
FROM rebasepro/server:0.28.2
COPY dist-bundle /bundle
```

## Criando o schema

**O runtime cria tabelas ausentes na inicialização, incluindo as das suas coleções.**
`REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o schema: cria tabelas, colunas e tipos enum ausentes, e aplica seu row-level security. Uma primeira inicialização em um banco vazio já começa servindo suas coleções, sem nenhuma etapa intermediária.

O que o `ensure` deliberadamente nunca faz é alterar algo que já existe. Ele não altera o tipo de uma coluna, não remove tabelas ou colunas e não edita os rótulos de um enum existente — pois o reinício de um contêiner não deve ter o poder de remodelar um schema como efeito colateral de um deploy.

Por isso, `rebase db push` ainda deve ser executado para o que a inicialização não altera — qualquer mudança que não seja puramente aditiva: uma coluna renomeada, um tipo restringido, um campo removido.

```bash
rebase db push
```

Execute-o a partir de um checkout local ou de um job de CI, apontado para o banco de dados da implantação. Ele simula as alterações primeiro, recusa mudanças destrutivas sem confirmação explícita e pode gerar um backup antes da aplicação. O banco de dados expõe uma porta no arquivo compose para permitir o acesso a partir do host; remova esse mapeamento assim que o schema estiver configurado, caso o banco não deva ser acessível externamente.

`REBASE_MIGRATE_ON_BOOT` aceita apenas `ensure` e `none` — a imagem **se recusa a inicializar** com `push`, pelo motivo citado acima.

## Quando apenas o seu processo de mudanças pode alterar o banco de dados

`REBASE_MIGRATE_ON_BOOT=none` deixa suas coleções intactas. No entanto, não deixa o banco de dados intocado: as tabelas do próprio framework (auth, chaves de API, jobs, cron) continuam sendo criadas e mantidas atualizadas a cada inicialização. Quando o banco de dados só puder ser alterado por meio de um processo formal de mudança revisado, defina `REBASE_PROVISION=false` em cada processo que atende requisições:

| Configuração | Tabelas e políticas de coleções | Tabelas do framework |
|---|---|---|
| padrão (`REBASE_MIGRATE_ON_BOOT=ensure`) | criadas e mantidas atualizadas na inicialização | criadas e mantidas atualizadas |
| `REBASE_MIGRATE_ON_BOOT=none` | inalteradas | criadas e mantidas atualizadas |
| `REBASE_PROVISION=false` | inalteradas | inalteradas; o que estiver ausente será apontado no log |

Com o provisionamento desativado, o runtime não cria nem altera nada: nenhuma tabela, coluna, índice, função, trigger, política, role ou permissão (grant). Isso se aplica tanto na inicialização quanto posteriormente, incluindo tabelas que um processo de atendimento criaria no primeiro uso (chaves de idempotência, reservas de cron, contadores compartilhados de rate-limit). Em vez disso, ele lê apenas o que já existe:

- **Tabelas de autenticação ou colunas usadas pela autenticação ausentes:** a inicialização é recusada e cada item faltante é listado.
- **A role de requisição tem acesso a tabelas do framework** como `rebase.refresh_tokens` ou `rebase.api_keys`: a inicialização é recusada e o comando `REVOKE` a ser executado é impresso. Uma inicialização com provisionamento revoga esses privilégios por conta própria. Com o provisionamento desativado, nada é alterado automaticamente.
- **Tabela opcional ausente** (chaves de API, chaves de idempotência, reservas de cron, contadores de rate-limit, presença, histórico de métricas): o recurso correspondente é desativado e o log indica qual tabela é necessária.

As linhas continuam sendo alteradas normalmente, como em qualquer banco: logins, sessões, uso de chaves de API, chaves de idempotência, execuções de cron. A primeira conta de administrador (`REBASE_ADMIN_EMAIL`) é criada pela execução de provisionamento, não pelos processos de atendimento. A [Edição de schema ao vivo](/docs/backend/live-schema-editing) ainda pode comitar uma alteração como código-fonte, mas se recusará a aplicá-la ao banco de dados.

### A execução de provisionamento

O schema é aplicado a partir de uma execução controlada pelo seu processo de mudanças. Use a mesma imagem e o mesmo bundle do servidor, com `REBASE_PROVISION_ONLY=true`, conectado como uma role que tenha permissão de criação no banco de dados. `REBASE_PROVISION_SQL_OUT` salva todas as alterações de schema feitas durante a execução em um script SQL:

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

A imagem roda com `NODE_ENV=production`, portanto esta execução passa pelas mesmas validações de ambiente do servidor, incluindo `CORS_ORIGINS` ou `FRONTEND_URL`, mesmo sem atender a nenhuma requisição.

O script gerado é um registro, não um plano: cada instrução contida nele foi executada, em ordem, com sucesso. Gerado contra um banco de dados vazio, ele contém todo o schema necessário para a versão. Gerado contra uma cópia restaurada de produção, ele reflete exatamente a migração de atualização. Linhas de dados inseridas durante a execução não são incluídas no arquivo. Revise-o e aplique-o ao banco de dados real:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Repita esse processo a cada atualização do Rebase, antes de reiniciar os processos de atendimento. Uma nova versão pode adicionar uma tabela ou coluna, e um processo impedido de criá-las registrará o erro de ausência em vez de criá-las automaticamente.

Um servidor customizado segue a mesma regra: `initializeRebaseBackend` lê `REBASE_PROVISION`, e `createRebaseBackend` aceita [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Armazenamento de arquivos

O armazenamento fica **desativado** a menos que um bucket seja configurado, e isso é intencional: a alternativa padrão seria o sistema de arquivos do contêiner, que perderia silenciosamente todos os arquivos enviados no próximo reinício. Os uploads são rejeitados com `501 STORAGE_NOT_CONFIGURED` até que um storage seja definido.

Para usar um bucket, defina `STORAGE_TYPE=s3` (ou `gcs`), além do bucket e de suas credenciais — o arquivo compose lista as variáveis comentadas. O suporte a `gcs` carrega `@google-cloud/storage`, que a imagem oficial não inclui; portanto, nessa imagem, acesse o Google Cloud Storage por meio do seu endpoint compatível com S3 (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, chaves HMAC).

Para armazenamento em disco local, apropriado apenas quando o caminho for um volume real persistente além do ciclo de vida do contêiner:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` não é opcional nesse caso: em produção, um backend `local` é descartado em vez de registrado, pois a alternativa seriam uploads bem-sucedidos em um sistema de arquivos prestes a ser destruído. Essa variável é a forma de confirmar que o ponto de montagem é durável.

Monte o volume **no diretório pai** de `STORAGE_PATH`, e não diretamente nele. `STORAGE_PATH` é o diretório do bucket padrão, e cada bucket declarado em `config/resources.ts` recebe o seu próprio diretório ao lado dele: `<STORAGE_PATH>__<chave>`. Um volume montado diretamente em `STORAGE_PATH` manterá apenas o bucket padrão. Qualquer outro bucket gravará no sistema de arquivos temporário do contêiner e perderá seus arquivos quando o contêiner for recriado. `STORAGE_PATH__MEDIA` permite mover um bucket específico para outro local no volume. Ele não pode ser movido para dentro do diretório de outro bucket (como `/storage/uploads/media`), pois o bucket padrão passaria a listar, servir e excluir seus arquivos.

A imagem cria `/storage` para o usuário sem privilégios `node` sob o qual ela roda, e é por isso que o volume deve ser mapeado ali. Um volume montado onde a imagem não possui um diretório pré-existente pertencerá ao root, fazendo com que todo upload falhe com `EACCES`. O arquivo compose gerado pelo `rebase init` já configura a montagem dessa forma.

### O armazenamento precisa de um modelo de controle de acesso

Assim que um bucket **é** configurado, o runtime **se recusa a inicializar em produção** até que a implantação defina como os objetos são protegidos. O armazenamento não é protegido por row-level security e suas chaves compartilham um único namespace simples. Sem regras, a única barreira entre os arquivos de dois usuários seria a imprevisibilidade das chaves — algo facilmente contornado por `GET /storage/list?prefix=`. Qualquer uma das seguintes opções satisfaz essa exigência:

- um **hook `storageAuthorize`** (ou `storagePolicies`) na configuração do seu projeto, que é a abordagem recomendada e que o scaffold já traz em `config/storage.ts` — nenhuma variável de ambiente consegue expressar "este usuário pode ler esta chave";
- **`STORAGE_PUBLIC_READ=true`**, para um bucket que atua legitimamente como uma CDN pública somente leitura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para aplicações single-tenant em que qualquer conta autenticada tem permissão de acesso a todos os arquivos.

Fora de produção, essa mesma condição gera apenas um aviso visível no log em vez de bloquear o boot, portanto essa é uma falha de inicialização vista no deploy e não na máquina local. Isso é proposital: o problema que ela previne aconteceria silenciosamente.

Defina também `MFA_ENCRYPTION_KEY` caso utilize TOTP. Se não definida, os segredos dos autenticadores armazenados serão criptografados com `JWT_SECRET` — fazendo com que rotacionar essa chave deslogue todos os usuários *e* torne impossível decifrar os dispositivos já cadastrados.

## Outras plataformas

O runtime é um contêiner comum escutando na porta `$PORT`, portanto qualquer plataforma que execute contêiners funcionará. Dois pontos essenciais em qualquer ambiente:

1. O bundle deve estar presente em `/bundle` (ou onde `REBASE_BUNDLE` apontar), com suas dependências instaladas ao lado — veja [Dependências](#dependências).
2. Configure `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. Em produção, o runtime se recusa a iniciar sem eles em vez de tentar valores padrão.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.28.2 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Use o formato de imagem derivada acima para que o bundle seja distribuído com a aplicação e, em seguida, execute `fly deploy`.

### Railway / Render

Aponte o serviço para a imagem derivada, defina as variáveis de ambiente e configure o caminho do health check para `/livez`.

### Uma VPS comum

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` lista as variáveis lidas pelo binário. Sob o systemd — as duas linhas `REBASE_ADMIN_*` exigem a versão 0.18 ou superior; na versão 0.17.3, a primeira conta registrada torna-se a administradora:

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

`NODE_ENV=production` não é mero detalhe. Se omitido, o processo roda em modo de desenvolvimento: reflete origens de localhost, serve a especificação OpenAPI e **deixa a janela do primeiro admin aberta** — de modo que o primeiro desconhecido que encontrar o formulário de cadastro se tornará o administrador. As duas linhas `REBASE_ADMIN_*` substituem essa brecha; consulte [Seu primeiro admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` é necessária porque o banco de dados está na mesma máquina. Em produção, o runtime recusa qualquer variável apontando para localhost — em um contêiner, loopback refere-se ao próprio contêiner, logo esse endereço é quase sempre um erro — e essa linha confirma que esse endereço é intencional. Remova-a se o banco de dados rodar em outro host.

Prefira usar `EnvironmentFile=/etc/rebase.env` com permissão 0600 em vez de linhas `Environment=` para dados sensíveis: arquivos de serviço de unidade são legíveis por qualquer usuário, e `systemctl show` exibe todos os valores de `Environment=`.

## Pooling de conexões

O runtime mantém um pool pequeno e persistente, dispensando um pooler dedicado. Quem realmente precisa de um pooler é qualquer outro serviço que acesse o mesmo banco e não consiga reter conexões: funções serverless, scripts agendados, ferramentas de BI ou workers de fila que escalam para dezenas de instâncias. O `max_connections` do Postgres é um limite rígido na faixa de algumas centenas e cada conexão é um *processo*, de modo que uma explosão de lambdas esgota o limite muito antes de o banco estar sobrecarregado.

O arquivo compose traz um serviço `pgbouncer` para esse tráfego, isolado sob um profile para que implantações sem essas demandas não executem um processo desnecessário:

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

A autenticação do cliente é gerada a partir de `DATABASE_URL` na inicialização, evitando duplicar a escrita da senha. O pooler autentica-se no Postgres usando `scram-sha-256`, suportado pelo Postgres 18 — o padrão `md5` da imagem faz o login do *servidor* falhar com `FATAL: server login failed: wrong password type`, o que parece uma senha incorreta, mas não é.

Mantenha a soma de `PGBOUNCER_POOL_SIZE` entre todos os poolers confortavelmente abaixo do `max_connections` do banco — o runtime consome conexões do mesmo limite.

### O que o pooling de transações muda

Um cliente em pool retém a conexão com o servidor apenas pela duração de uma transação e a devolve em seguida, permitindo que 500 clientes compartilhem 20 conexões. Três recursos deixam de funcionar através dessa porta, e todos eles são utilizados pelo próprio Rebase — razão pela qual o runtime conecta-se diretamente e essa porta deve ser reservada para outros consumidores:

- **`LISTEN`/`NOTIFY`.** O Realtime é construído sobre isso, e um listener exige uma conexão que viva além de uma única transação. O `LISTEN` chega a ser *aceito* pelo pooler — ele responde com sucesso ao `LISTEN`, mas nenhuma notificação jamais é entregue.
- **Estado de sessão**: `SET` (ao contrário de `SET LOCAL`), advisory locks mantidos entre comandos, cursores `WITH HOLD`, tabelas temporárias. A transação seguinte pode ser roteada para uma conexão de servidor diferente, que não terá esse estado. Ambos falham de maneira sutil: com apenas um cliente ocioso, o estado costuma persistir, funcionando nos testes e quebrando sob a concorrência para a qual o pooler foi implementado.
- **Prepared statements em nível de protocolo.** A maioria dos drivers pode ser configurada para não utilizá-los — o node-postgres não os usa por padrão; o asyncpg requer `statement_cache_size=0`.

`SET LOCAL` possui escopo restrito à transação e funciona normalmente, sendo exatamente o mecanismo usado para definir o row-level security — logo, o RLS se comporta de forma idêntica através da porta com pooling.

Mantenha o profile desativado se nada fora do runtime se conectar ao seu banco de dados. Portas não utilizadas representam superfície de ataque desnecessária.

## Health checks

| Caminho | Usar para |
| --- | --- |
| `/livez` | Liveness. Responde se "este processo está ativo" sem tocar no banco de dados. |
| `/health` | Readiness. Realiza um ciclo de comunicação (round-trip) com o banco de dados e informa a latência. |

Aponte sondas de liveness para `/livez`. Uma sonda de liveness em `/health` reiniciará um processo perfeitamente saudável durante uma oscilação momentânea do banco, o que contraria seu propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expõe métricas Prometheus em `/metrics`: contagem de requisições e histogramas de latência divididos por superfície de API (data, auth, storage, functions) e coleção, além de gauges do processo. Sem um token, o endpoint fica acessível a qualquer um que alcance a porta; defina um token a menos que esteja em uma rede privada.

`rebase_db_pool_wait_ms` é um histograma do tempo de espera de cada consulta por uma conexão do pool do banco de dados (incluindo a abertura de uma nova), identificado pela chave da fonte de dados (`source="(default)"` em projetos que não declaram múltiplas fontes). Em um pool saudável, esse valor permanece próximo de zero. Uma cauda que cresce com o tráfego indica requisições esperando por conexões — geralmente presas por callbacks de escrita que aguardam operações lentas; veja [Um callback retém uma conexão](/docs/collections/context-data-api/#a-callback-holds-a-connection).

O próprio banco de dados, por fonte de dados:

| Métrica | O que diz |
|---------|-----------|
| `rebase_db_pool_total`, `_idle`, `_waiting` | As conexões de cada pool, etiquetadas `pool="primary"`, `"read"` (a réplica) ou `"session"` (o pool direto do console SQL atrás de um pooler). `waiting` acima de zero por muito tempo é um pool pequeno demais para a sua carga. |
| `rebase_db_connection_errors_total` | Pedidos respondidos com 503 por falta de conexão, por `code`: `53300` / `53400` (o servidor ficou sem conexões), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Conexões de clientes no servidor, por `state`, face a `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | O tamanho do banco de dados. |
| `rebase_db_replica_lag_seconds` | Quanto `DATABASE_READ_URL` está atrasada em relação à primária. |

As quatro últimas são amostradas a cada 30 segundos na própria conexão da instância, por isso um scrape nunca se torna uma consulta.

`rebase_realtime_*` reporta os sockets e canais abertos de cada instância, bem como os frames enviados ao barramento de canais ou retidos: veja [Acompanhando o que o barramento faz](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Cabeçalhos de segurança

Todas as respostas incluem `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` e `Strict-Transport-Security: max-age=15552000` (180 dias). O cabeçalho HSTS omite `includeSubDomains`: incluí-lo instruiria os navegadores a recusar HTTP simples em todos os subdomínios do seu domínio, incluindo aqueles que nada têm a ver com este servidor, persistindo pelo tempo definido no cabeçalho.
Defina `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` quando todos os subdomínios forem estritamente HTTPS; até a versão 0.23, o cabeçalho sempre incluía `includeSubDomains`.

`strict-origin-when-cross-origin` é o padrão dos navegadores: uma requisição para outro site envia sua origem, nunca o caminho ou query da página. Não é utilizado `no-referrer` porque verificações de origem dependem dessa informação — o botão de login do Google compara a origem com as origens JavaScript autorizadas no cliente OAuth, e sob `no-referrer` respondia "The given origin is not allowed for the given client ID" em qualquer aplicação, independentemente das permissões cadastradas. Uma resposta que configure sua própria política tem sua regra mantida (a página de consentimento do MCP envia `no-referrer`); uma página que exija uma regra mais restrita pode declará-la com `<meta name="referrer" content="no-referrer">`.
O `X-Frame-Options` segue o mesmo princípio: `SAMEORIGIN` a menos que a resposta defina o seu próprio, como faz a página de consentimento do MCP com `DENY`.

Aplicações estáticas — o painel administrativo do CMS e qualquer frontend servido pelo bundle — também trazem `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Isso define quem pode renderizar a aplicação em frames, bloqueia plugins e restringe `<base>` à sua origem, sem restringir nada além disso, permitindo que scripts inline, workers e autenticação de terceiros continuem funcionando. Respostas com políticas próprias são respeitadas. Para regras mais rígidas, configure a política no proxy reverso à frente da aplicação.

## Mais de uma instância

Um único contêiner é a configuração padrão e atende perfeitamente a maioria dos casos. Antes que uma segunda réplica passe a receber tráfego — ou que um rolling deploy execute duas instâncias lado a lado — leia [Executando mais de uma instância](/docs/deployment/multiple-instances/): limites de taxa (rate limits), canais de broadcast, arquivos locais, uploads retomáveis e cache de imagens operam por processo até que sejam configurados para compartilhamento.

## Conectando o Claude

Um único comando adiciona este servidor ao [Rebase connector](/docs/ai/rebase-connector/), o conector MCP unificado que acessa todos os seus projetos a partir do Claude:

```bash
rebase cloud connect https://your-app.com
```

Configure as duas variáveis exibidas no terminal neste servidor e reinicie-o. O servidor precisa rodar o Rebase 0.28.1 ou superior e responder via HTTPS em um endereço público. Nada mais é alterado: ele não armazena segredos e concede ao conector os mesmos privilégios do Studio.

## Executando funções em seu próprio processo

Tudo o que foi descrito acima considera um único contêiner servindo todo o projeto, o que é a arquitetura ideal para quase todas as implantações. Caso uma função personalizada precise parar de disputar o event loop com a API de dados — ou deva escalar, reiniciar e falhar de forma independente —, a mesma imagem e o mesmo bundle podem ser inicializados como múltiplos processos cooperantes. Consulte [Processos divididos](/docs/deployment/split-processes/).

## Atualizando

```yaml
image: rebasepro/server:0.28.2
```

Reinicie. Seu bundle permanece inalterado. Dentro da mesma versão major do contrato de runtime, um bundle validado continuará funcionando — veja [Compatibilidade](/docs/architecture/runtime-and-bundles/#compatibility).
