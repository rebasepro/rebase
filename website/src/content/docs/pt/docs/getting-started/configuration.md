---
sourceHash: a6ecab532bd0be01
title: Ambiente & Configuração
sidebar_label: Configuração
description: Todas as variáveis de ambiente e opções de configuração para projetos Rebase.
---

## Variáveis de Ambiente

Toda a configuração é feita por meio de variáveis de ambiente no seu arquivo `.env` na raiz do projeto.

> **Importante**: O Rebase valida variáveis de ambiente com **Zod** na inicialização. Se
> algo obrigatório estiver ausente ou malformado (uma URL que não é uma URL, uma porta que
> não é um número), o servidor recusa a inicialização e informa o nome da variável.
>
> O local onde o esquema reside depende de como você executa o backend. Um projeto inicializado
> pelo runtime — `rebase dev`, `rebase start`, a imagem publicada — usa o esquema de
> propriedade do runtime (`loadBootEnv` em `@rebasepro/server`), que é a união de todas as tabelas
> abaixo. Um projeto que executou [`rebase eject`](/docs/cli) possui um `backend/src/env.ts`
> chamando `loadEnv({ extend })` e pode adicionar suas próprias variáveis tipadas lá.

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `DATABASE_URL` | String de conexão do PostgreSQL. **Opcional em desenvolvimento** — se não definida, `rebase dev` executa um PostgreSQL gerenciado para o projeto, com seus dados em `.rebase/`. Obrigatória em todos os outros lugares. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chave secreta para assinar tokens JWT. Use uma string aleatória forte (mín. 32 caracteres). **Obrigatória em produção** (gerada automaticamente em desenvolvimento). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` é uma grafia do node-postgres, não do libpq.**
>
> O Rebase e o driver do Node a aceitam — criptografam, mas não verificam o
> certificado. O `psql`, `pg_dump`, `pg_restore` e Atlas não aceitam, e não
> degradam graciosamente: eles recusam iniciar com `invalid sslmode value: "no-verify"`.
>
> Os próprios comandos do Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) reescrevem isso para o equivalente `sslmode=require` antes de executar os comandos shell,
> funcionando assim com a URL configurada. Executar o `psql` manualmente não faz isso
> — substitua por `sslmode=require` lá, o que criptografa sem verificar exatamente da
> mesma forma.

### Frontend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `VITE_API_URL` | URL da API do backend para o SDK do cliente. **Defina isso apenas em desenvolvimento** — veja abaixo. | origem da página |
| `VITE_GOOGLE_CLIENT_ID` | ID do cliente OAuth do Google. Habilita o "Entrar com Google". | — |

> **Deixe `VITE_API_URL` não configurado em builds de produção.**
>
> Em desenvolvimento, o frontend e o backend são origens separadas, portanto, o servidor
> de desenvolvimento injeta isso. Em produção, o backend do Rebase serve a SPA, de modo que a
> API é a própria origem da página e o cliente a resolve dessa forma por conta própria.
>
> Fixar uma URL absoluta em um bundle de produção funciona até o momento em que um segundo
> hostname aponta para a mesma aplicação: um domínio customizado então carrega a página de
> `example.com` e chama a API em `example.rebase.website`, o que é cross-origin, fazendo com
> que cada requisição falhe no preflight. Permitir a origem no CORS **não** resolve isso
> também — o cookie de atualização (refresh cookie) é `SameSite=Lax` e não é enviado cross-site,
> portanto você limparia os erros do console e ainda continuaria com a autenticação quebrada.
> Não definida, todo domínio que aponta para a aplicação funciona sem nenhuma configuração
> de CORS.

### Backend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta para o servidor HTTP do backend. Lida por `rebase start`. O `rebase dev` a lê **apenas do ambiente do shell** — uma `PORT` no `.env` não é lida lá, porque a porta é resolvida antes que esse arquivo seja carregado — e, caso contrário, vincula uma porta derivada do caminho do projeto, para que vários projetos possam rodar ao mesmo tempo. `rebase dev --port` tem precedência sobre ambos, e o banner inicial indica qual foi utilizado. | `3001` |
| `LOG_LEVEL` | Nível de detalhe dos logs: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra o SQL por trás de uma linha `Failed query: [redacted]`. Toda instrução que falha é ocultada por padrão, porque uma consulta com falha carrega seus parâmetros vinculados — um e-mail, um hash de senha. Defina como `true` ao diagnosticar uma falha de DDL, RLS ou captura de alterações. Ignorado quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Lista separada por vírgulas de origens permitidas. **Obrigatório em produção** se for diferente do domínio do backend. Em desenvolvimento, é *adicionado ao* localhost — veja abaixo. | — |
| `FRONTEND_URL` | URL do aplicativo frontend. Usado como alternativa ao CORS_ORIGINS, em ambos os ambientes. | — |
| `ADMIN_CONNECTION_STRING` | String de conexão do banco de dados com nível de administrador (usada para introspecção de esquema e operações administrativas). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desativa a alternância de roles do PostgreSQL no SQL Editor (útil para autenticação personalizada onde as roles do banco não são mapeadas). | `false` |

#### CORS em desenvolvimento

O desenvolvimento permite o **localhost, além do que `CORS_ORIGINS` (ou `FRONTEND_URL`)
indicar** — a mesma lista que a produção usa, com o localhost adicionado em vez de
substituído. Portanto, a variável funciona da mesma forma em ambos os ambientes, e os
casos que precisam dela em desenvolvimento são os comuns:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Uma origem que não seja o localhost nem esteja listada é recusada, e a recusa é
registrada em log **uma vez por origem** com a linha exata que a permitiria. A recusa
não é cautela por capricho: a API envia credenciais, portanto refletir um
`Origin` arbitrário permitiria que qualquer site que o desenvolvedor visitasse fizesse
requisições autenticadas contra o servidor de desenvolvimento com sua sessão e lesse as
respostas.

### Autenticação

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `JWT_SECRET` | Segredo para assinatura de JWT (obrigatório em produção, gerado automaticamente em desenvolvimento) | — |
| `JWT_PRIVATE_KEY` | Chave privada PEM para assinar tokens de acesso assimetricamente (RS256), para que qualquer serviço que possua o JWKS possa verificar uma sessão sem conseguir forjar uma. Aceita um PEM com quebras de linha reais, um PEM com escapes `\n` ou base64 de todo o PEM. Sem isso, os tokens permanecem em HS256. | — |
| `JWT_KEY_ID` | Identifica a `JWT_PRIVATE_KEY` no cabeçalho do token e no JWKS. Altere-o sempre que a chave mudar — a rotação depende de o antigo e o novo serem distinguíveis. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tempo de vida do token de acesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tempo de vida do token de atualização (refresh token). Deslizante — cada rotação o renova, portanto isso governa quanto tempo uma sessão sobrevive à **inatividade**. | `400d` |
| `ALLOW_REGISTRATION` | Permite que novos usuários se registrem (`true`/`false`). Fora de produção, o **primeiro** usuário sempre pode se registrar, independentemente do que estiver definido aqui — uma tabela de usuários vazia precisa admitir alguém, e esse alguém se torna o administrador. Em produção (`NODE_ENV=production`), essa janela é fechada: uma tabela vazia recusa o registro de inicialização com `SETUP_REQUIRED`, uma primeira conta criada por registro aberto é uma conta comum, e o administrador é definido com `REBASE_ADMIN_EMAIL` abaixo ou atribuído com a service key. O `.env.example` do scaffold define como `true`; o padrão do framework é desativado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Botão de desligamento de emergência (kill switch). Fecha a janela de inicialização do primeiro usuário que `ALLOW_REGISTRATION=false` deliberadamente deixa aberta fora de produção, para que o registro seja bloqueado mesmo em um banco de dados vazio. Combine com `REBASE_ADMIN_EMAIL` abaixo, ou a implantação não terá como produzir seu primeiro chamador autenticado. Todo artefato de implantação distribuído define isso. | — |
| `REBASE_ADMIN_EMAIL` | E-mail da primeira conta de administrador, criada na inicialização **enquanto a tabela de usuários ainda estiver vazia** e nunca depois disso. É assim que uma implantação de produção obtém seu administrador: o operador define a primeira conta em vez de disputá-la com a internet. A inicialização emite um aviso quando a tabela está vazia em produção e isso não está configurado. | — |
| `REBASE_ADMIN_PASSWORD` | Senha para essa conta. Pelo menos 12 caracteres, caso contrário é recusada e a conta não é criada. Altere-a após o primeiro login. | — |
| `MFA_ENCRYPTION_KEY` | Criptografa cada segredo TOTP armazenado. Se não configurado, os segredos são criptografados com `JWT_SECRET` e a inicialização avisa uma vez — portanto, rotacionar o `JWT_SECRET` desconecta todos *e* torna indecriptável qualquer autenticador registrado. Defina uma chave dedicada (32+ caracteres aleatórios) antes que alguém se registre. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | A chave antiga da qual se está fazendo a rotação. Defina ambas durante uma rotação: novos segredos são gravados com `MFA_ENCRYPTION_KEY` e os existentes ainda podem ser lidos, para que ninguém fique bloqueado fora de sua própria conta no meio da rotação. Remova-a quando todos os segredos tiverem sido recriptografados. | — |
| `ALLOW_ANONYMOUS` | Habilita o login anônimo (`POST /api/auth/anonymous`). Opcional (opt-in) e deliberadamente não bloqueado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticação para a API de dados. Defina como `false` para uma superfície de leitura totalmente pública — o RLS ainda se aplica. | `true` |
| `AUTH_DEFAULT_ROLE` | Role atribuída a um usuário recém-registrado quando nenhuma for informada. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta a rota `POST /api/auth/find-user`, que resolve um e-mail para um perfil público mínimo (`uid`, `displayName`, `photoURL`) para fluxos de convite por e-mail. Apenas chamadores autenticados, e nunca retorna o e-mail, roles ou metadados do usuário encontrado. Desativado por padrão: é uma superfície de enumeração. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` no cookie de atualização: `Strict`, `Lax` ou `None`. `None` requer HTTPS e serve apenas para um frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` no cookie de atualização. Seguro por padrão; `AUTH_COOKIE_SECURE=false` para http simples — uma implantação em um endereço de LAN onde o navegador descartaria o cookie e a sessão morreria no vencimento do token de acesso sem erro. Um aviso é exibido na inicialização. `http://localhost` não precisa disso. | `true` |
| `GOOGLE_CLIENT_ID` | ID do cliente OAuth do Google (validação no backend) | — |
| `GOOGLE_CLIENT_SECRET` | Segredo do cliente OAuth do Google | — |
| `GITHUB_CLIENT_ID` | ID do cliente OAuth do GitHub | — |
| `GITHUB_CLIENT_SECRET` | Segredo do cliente OAuth do GitHub | — |
| `MICROSOFT_CLIENT_ID` | ID do cliente OAuth da Microsoft | — |
| `MICROSOFT_CLIENT_SECRET` | Segredo do cliente OAuth da Microsoft | — |
| `LINKEDIN_CLIENT_ID` | ID do cliente OAuth do LinkedIn | — |
| `LINKEDIN_CLIENT_SECRET` | Segredo do cliente OAuth do LinkedIn | — |
| `FACEBOOK_CLIENT_ID` | ID do cliente OAuth do Facebook | — |
| `FACEBOOK_CLIENT_SECRET` | Segredo do cliente OAuth do Facebook | — |
| `TWITTER_CLIENT_ID` | ID do cliente OAuth do X/Twitter | — |
| `TWITTER_CLIENT_SECRET` | Segredo do cliente OAuth do X/Twitter | — |
| `DISCORD_CLIENT_ID` | ID do cliente OAuth do Discord | — |
| `DISCORD_CLIENT_SECRET` | Segredo do cliente OAuth do Discord | — |
| `GITLAB_CLIENT_ID` | ID do cliente OAuth do GitLab. A `baseUrl` de uma instância auto-hospedada não possui configuração por variável de ambiente — configure o GitLab no bloco `auth` para isso. | — |
| `GITLAB_CLIENT_SECRET` | Segredo do cliente OAuth do GitLab | — |
| `BITBUCKET_CLIENT_ID` | ID do cliente OAuth do Bitbucket | — |
| `BITBUCKET_CLIENT_SECRET` | Segredo do cliente OAuth do Bitbucket | — |
| `SLACK_CLIENT_ID` | ID do cliente OAuth do Slack | — |
| `SLACK_CLIENT_SECRET` | Segredo do cliente OAuth do Slack | — |
| `SPOTIFY_CLIENT_ID` | ID do cliente OAuth do Spotify | — |
| `SPOTIFY_CLIENT_SECRET` | Segredo do cliente OAuth do Spotify | — |
| `APPLE_CLIENT_ID` | ID de Serviços da Apple (Apple Services ID). A Apple não possui um segredo de cliente estático — o Rebase assina um JWT ES256 de curta duração por troca de token — portanto, precisa de todos os quatro valores `APPLE_*` e não configura nada sem eles. | — |
| `APPLE_TEAM_ID` | ID da equipe de desenvolvedor da Apple (Apple Developer Team ID), o emissor do JWT. | — |
| `APPLE_KEY_ID` | Key ID da chave privada registrada na Apple. | — |
| `APPLE_PRIVATE_KEY` | Conteúdo do arquivo de chave privada `.p8`, com quebras de linha e tudo (escapes `\n` são aceitos). | — |
| `REBASE_SERVICE_KEY` | Chave estática da API de administração. Ignora a autenticação JWT normal para chamadas servidor-para-servidor quando passada como `Authorization: Bearer <key>`. (Gerada automaticamente em desenvolvimento). | — |
| `REBASE_RATE_LIMIT_STORE` | Onde os contadores de rate limit de autenticação residem: `memory` (por processo) ou `sql` (compartilhado entre réplicas). Um processo não pode ver sua própria contagem de réplicas, portanto uma implantação com instâncias paralelas precisa especificar — três réplicas no padrão aplicam três vezes o limite. Qualquer outro valor **recusa a inicialização** em vez de adotar um fallback, incluindo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monta o fluxo de link de login sem senha (magic link). Requer um serviço de e-mail configurado, caso contrário o link não tem para onde ir. | `false` |
| `AUTH_EMAIL_OTP` | Monta o login sem senha com um código de seis dígitos enviado por e-mail. Mesmo requisito de e-mail acima. | `false` |
| `CAPTCHA_PROVIDER` | Ativa a verificação de captcha nas rotas de autenticação: `turnstile` ou `hcaptcha`. Não configurado significa sem captcha. | — |
| `CAPTCHA_SECRET` | O segredo do provedor, usado no servidor para verificar o token enviado pelo navegador. Obrigatório uma vez que `CAPTCHA_PROVIDER` esteja definido. | — |
| `CAPTCHA_ROUTES` | Rotas de autenticação separadas por vírgula para proteger (por exemplo, `register,login`). Não configurado protege o conjunto padrão do provedor. | — |

### Armazenamento

:::caution[O armazenamento não possui segurança em nível de linha, portanto precisa de um modelo de acesso]
As coleções são protegidas pelo RLS do Postgres. O armazenamento de objetos não tem
equivalente — as chaves compartilham um namespace único e plano —, portanto, com um
bucket configurado e nenhum modelo de acesso, o servidor **recusa a inicialização em produção**.
Satisfaça isso com exatamente um dos seguintes: um hook `storageAuthorize` exportado de
`config/index.ts` (o que o scaffold inclui por padrão), `STORAGE_PUBLIC_READ` ou
`STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `STORAGE_TYPE` | Backend de armazenamento: `local`, `s3` ou `gcs`. Em produção, `local` desativa o armazenamento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Caminho base para o armazenamento local | `./uploads` |
| `FORCE_LOCAL_STORAGE` | Permite armazenamento local em produção — apenas com um volume persistente montado em `STORAGE_PATH` | `false` |
| `S3_BUCKET` | Nome do bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Região da AWS | — |
| `S3_ACCESS_KEY_ID` | Chave de acesso da AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chave secreta de acesso da AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Força URLs em estilo de caminho para o bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome do bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projeto do GCP. Geralmente inferido das credenciais. | — |
| `GCS_KEY_FILENAME` | Caminho para o arquivo de chave da conta de serviço. Omita no GCP, onde o Workload Identity fornece credenciais. | — |
| `STORAGE_PUBLIC_READ` | Serve qualquer objeto para qualquer pessoa, sem token. Apenas para um bucket que seja genuinamente uma CDN pública. Uma das três maneiras de satisfazer a verificação de inicialização abaixo. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite que qualquer chamador autenticado leia, grave, liste e exclua todos os objetos. Chamado de `INSECURE` no objeto de configuração por um motivo: é defensável apenas em um aplicativo single-tenant onde toda conta é confiável para acessar todos os arquivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Armazena em cache rendições de imagens geradas (redimensionamentos, conversões de formato) em vez de produzi-las a cada requisição. | `false` |

### E-mail (Opcional)

| Variável | Descrição |
|----------|-----------|
| `SMTP_HOST` | Host do servidor SMTP |
| `SMTP_PORT` | Porta do servidor SMTP |
| `SMTP_SECURE` | Ativa conexão segura (`true`/`false`) |
| `SMTP_USER` | Usuário SMTP |
| `SMTP_PASS` | Senha SMTP |
| `SMTP_FROM` | Endereço do remetente para e-mails do sistema |
| `SMTP_NAME` | Nome de exibição no endereço do remetente |
| `APP_NAME` | Nome do produto usado nos assuntos e corpos de e-mail (padrão: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo exibido no topo dos modelos de e-mail padrão. PNG ou JPG absoluto em `http(s)` — os clientes de e-mail removem SVG e bloqueiam URIs `data:`. Se não configurado, um app ainda chamado `Rebase` recebe a marca do Rebase e um renomeado não recebe nenhum |

### Pool de conexões do banco de dados

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `DB_POOL_MAX` | Máximo de conexões no pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milissegundos que uma conexão inativa é mantida | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milissegundos para aguardar por uma conexão | `10000` |
| `DATABASE_DIRECT_URL` | Conexão direta (sem pool). O [Realtime](/docs/backend/realtime) precisa de uma: o `LISTEN`/`NOTIFY` não sobrevive a um pooler de transações como o PgBouncer e, sem isso, as notificações de alteração são desativadas com um aviso em vez de serem perdidas silenciosamente. | — |
| `DATABASE_READ_URL` | Réplica de leitura. As leituras vão para lá quando estiver definido e for diferente de `DATABASE_URL`; se a conexão falhar, tudo volta para o primário com um aviso. | — |
| `REBASE_DB_POOL_MAX` | Um limite máximo para todos os pools no processo, aplicado independentemente do que cada um solicitou. Apenas dígitos numéricos: um valor malformado é ignorado em vez de serializar silenciosamente o servidor. | — |

### Comportamento do runtime

Lido pelo runtime — `rebase dev`, `rebase start` e a imagem de servidor
publicada. Um projeto que foi ejetado é responsável por essas decisões em seu próprio código.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_RLS_AUDIT` | Executa a auditoria de segurança em nível de linha (RLS) na inicialização e monta seu endpoint, que relata tabelas expostas sem políticas. | — |
| `REBASE_BASE_PATH` | Caminho base para todas as rotas da API. O cliente deve ser configurado com o mesmo valor — veja [Alterando `basePath`](#changing-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve os arquivos estáticos/admin do bundle a partir deste processo. Desative quando houver uma CDN à frente. | `true` |
| `REBASE_HISTORY` | Registra o [histórico de alterações de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respostas com compressão gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Tamanho máximo do corpo da requisição, **em bytes** (`10485760`, não `10MB` — um valor que não seja numérico recusa a inicialização em vez de remover silenciosamente o limite). | — |
| `REBASE_ENABLE_SWAGGER` | A interface OpenAPI. Três estados: não definido significa ativado em desenvolvimento, desativado em produção; `false` desativa ambos em qualquer lugar. Observe que `true` em produção serve a **especificação** em `/api/docs`, mas não a **UI** do Swagger em `/api/swagger` — a UI é restrita por `NODE_ENV` separadamente. | — |
| `REBASE_METRICS` | Expõe métricas do Prometheus em `/metrics`. | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer protegendo `/metrics`. Não definido deixa o endpoint aberto para qualquer um que consiga acessar a porta — aceitável em uma rede privada, não em uma pública, e os logs de inicialização alertam sobre isso. | — |
| `REBASE_MIGRATE_ON_BOOT` | O que o runtime pode fazer com o esquema na inicialização. `ensure` (o padrão em todo lugar — inclusive produção) executa a etapa **aditiva**: cria tabelas, colunas e tipos enum ausentes, nunca remove ou reescreve um. `none` não altera nada. A imagem publicada aceita apenas esses dois e **recusa a inicialização com `push`**. Em uma [implantação dividida](/docs/deployment/split-processes), exatamente um processo pode provisionar, portanto, todos os outros papéis devem definir `none` ou recusarão a inicialização. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Recusa a inicialização quando o banco de dados foi provisionado pela última vez a partir de um conjunto de coleções diferente do que este processo foi construído. Não definido (ou qualquer coisa diferente de `true`/`1`) emite um aviso. | warn |
| `REALTIME_CDC` | Captura de alterações no nível do banco de dados: `auto` (habilita onde a conexão suportar, faz fallback silencioso caso contrário), `trigger` (força o uso, avisa se impossível), `wal` (atualmente se degrada para `trigger`), `off`. Veja [Realtime](/docs/backend/realtime#database-level-change-capture-cdc). | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instâncias para canais de broadcast e presença: `memory` ou `postgres`. Ignorado quando um transporte construído foi fornecido a `realtime.bus`. | `memory` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores `localhost`/loopback sob `NODE_ENV=production`. Desativado por padrão, para que uma inicialização em produção falhe explicitamente em vez de conectar a um banco de dados que não existe. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | O que a inicialização faz com uma chave nas suas coleções que esta versão não lê: `warn`, `error` (recusa inicializar — vale a pena ativar no CI) ou `off`. Controla apenas chaves que não são *reconhecidas*, que geralmente são erros de digitação e ocasionalmente metadados deliberados; uma chave que o sistema sabe que mudou de lugar é sempre fatal, pois o recurso configurado estaria silenciosamente ausente de outra forma. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` executa a etapa de esquema e encerra sem abrir um socket — o formato que um Job de migração precisa, a partir da mesma imagem e do mesmo bundle que o servidor subsequente. Um valor vazio é considerado *não definido*, portanto um `${SOMETHING}` não substituído em um compose file não transformará uma implantação comum em uma que apenas migra e recusa atender requisições. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que uma máquina — um agente, um job de CI — *aplique* uma alteração de esquema por meio de `/api/admin/schema`, não apenas a planeje. Desativado a menos que solicitado: a credencial que faria tal alteração é a mais propensa a estar armazenada em uma variável de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Quanto tempo uma função customizada pode executar antes que sua requisição seja abortada. O mesmo controle que a opção `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` faz com que uma rejeição de promise não tratada encerre o processo em vez de registrá-la em log. Ativado sob um orquestrador que reiniciará o processo; desativado onde uma reinicialização for pior do que um vazamento de memória. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Mantém o agendador do cron em execução em uma plataforma que o runtime detectaria como scale-to-zero (escala até zero), onde um timer disparado em uma instância inativa dispararia em nenhuma instância. | — |
| `TRUSTED_PROXY_HOPS` | Quantos proxies existem à frente deste servidor, para que o rate limiter possa ler o endereço real do cliente a partir de `X-Forwarded-For`. Padrão seguro contra falhas `0`: sem proxy, confiar no cabeçalho permitiria que qualquer chamador forjasse uma identidade. | `0` |

:::note[O provisionamento na inicialização é aditivo e não é uma ferramenta de migração]
A etapa de inicialização executa de forma autônoma sem ninguém avaliando um diff,
portanto nunca removerá uma coluna, restringirá um tipo ou reescreverá uma tabela.
É também por isso que a imagem recusa `REBASE_MIGRATE_ON_BOOT=push`: um push completo
calcula um diff e executará alegremente `DROP COLUMN`, e o reinício de um contêiner
nunca deve ser capaz de destruir uma coluna de produção como efeito colateral de um
reagendamento.

Alterações destrutivas ou de remodelação permanecem onde podem ser revisadas: `rebase db
generate` + `rebase db migrate`, ou `rebase db push` a partir de um checkout ou CI,
que executa em modo dry-run, recusa alterações destrutivas sem confirmação e
pode criar um backup primeiro.
:::

### Implantações divididas

Uma imagem e um bundle podem ser inicializados várias vezes, cada um servindo uma
parte diferente do projeto. Uma linha para cada aqui, pois esta página lista todas
as variáveis; o que cada combinação *monta e gerencia* — e quais combinações
recusam inicializar — está em
**[Processos Divididos](/docs/deployment/split-processes)**.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_ROLE` | Qual parte este processo atende: `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescreve se *este* processo executa os timers do cron. Não definido segue a role. | — |
| `REBASE_JOB_WORKERS` | Sobrescreve se este processo executa workers da fila de jobs. Não definido segue a role. | — |
| `REBASE_FUNCTIONS_ONLY` | Atende apenas as funções customizadas especificadas neste processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Atende todas as funções customizadas, exceto as especificadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Para onde o processo da API encaminha uma requisição de função que ele próprio não atende. | — |

### Superfície MCP

Um endpoint opcional (opt-in) do Model Context Protocol em `/mcp`, para que um cliente de IA possa ler
e gravar neste projeto **como o usuário autenticado**. Desativado a menos que configurado e — ao contrário de
qualquer outra superfície — nenhum `REBASE_ROLE` o ativa: os outros descrevem o formato de
um processo, enquanto este é uma decisão de conceder credenciais a software de terceiros,
devendo ser tomada por uma pessoa em vez de herdada da função de um contêiner.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_MCP_ENABLED` | Monta a superfície MCP. Requer `REBASE_PUBLIC_URL`; sem ela, a superfície se recusa a montar e registra isso no log de inicialização. | `false` |
| `REBASE_PUBLIC_URL` | A origem acessível externamente desta implantação, por exemplo `https://app.example.com`. A superfície MCP não pode derivá-la — obter a origem do cabeçalho `Host` tornaria a identidade do emissor, e o público-alvo (audience) contra o qual seus próprios tokens são validados, um valor fornecido pelo chamador. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite o registro dinâmico de clientes OAuth (RFC 7591), para que um cliente possa se cadastrar automaticamente. Defina como `false` para exigir que os clientes sejam registrados com antecedência. | `true` |

### Backups

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `BACKUP_SCHEDULE` | Expressão cron para backups agendados. Não definido significa que os backups agendados estão desativados. | — |
| `BACKUP_DESTINATION` | Caminho local ou uma URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Exclui backups anteriores a N dias. Não definido ou `0` mantém tudo. | — |
| `BACKUP_KEEP_MINIMUM` | Sempre retém pelo menos N dos backups mais recentes, independentemente do que a retenção definir. | — |
| `PG_DUMP_PATH` | Sobrescreve o binário `pg_dump` — ele deve corresponder à versão principal do servidor. | — |
| `PG_RESTORE_PATH` | Sobrescreve o binário `pg_restore`. | — |

Os backups contêm segredos e dados de identificação pessoal (PII). Use um destino privado com
criptografia em repouso.
| `PG_DUMPALL_PATH` | Onde o `pg_dumpall` reside, quando não estiver no `PATH`. Sem ele — e sem as ferramentas de cliente do PostgreSQL instaladas —, o backup de variáveis globais falha com um erro indicando esta variável. | — |

### Entrega de bundles

Uma implantação gerenciada não armazena seu código na imagem: o runtime busca um
bundle na inicialização. Estas variáveis definem qual deles e como.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BUNDLE` | Caminho para um diretório de bundle já extraído. O que o `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | De onde buscar o arquivo do bundle, quando não houver um local. | — |
| `REBASE_BUNDLE_TOKEN` | A credencial Bearer para essa busca. Trate-a como um segredo: é o que autoriza um tenant a baixar seu próprio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Onde um bundle baixado é extraído. Deve ter permissão de escrita e persistir entre o download e a inicialização. | — |
| `REBASE_RUNTIME_MODULES` | Módulos extras que a imagem de runtime fornece ao bundle, além daqueles que ele próprio declara. | — |

### Vinculação de recursos

Cada banco de dados, bucket e tópico que um projeto declara em `config/resources.ts` é
vinculado por variáveis de ambiente nomeadas a partir dele. Os nomes base estão abaixo; um
recurso não padrão anexa `__` e sua chave em maiúsculas, portanto, um bucket chamado
`media` lê `S3_BUCKET__MEDIA`. O `rebase status`
exibe, por recurso,
a variável exata que está sendo lida e se ela está definida.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_DRIVER` | O pacote npm que implementa o driver de uma fonte de dados, quando não for o padrão do Postgres. Com sufixo por fonte: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | A string de conexão para um tópico declarado. Com sufixo por tópico. | — |

### Ambiente próprio da CLI

Lido pelo `rebase`, não pelo servidor. Nada aqui afeta uma implantação.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BASE_URL` | O backend com o qual `rebase auth` e `rebase api-keys` se comunicam, em vez de derivá-lo do projeto. | — |
| `REBASE_PORT` | A porta que esses comandos assumem ao derivar essa URL. | — |
| `SERVICE_KEY` | A chave de serviço com a qual eles se autenticam, em vez de solicitar interativamente. | — |
| `REBASE_ENV_FILE_PATH` | Qual `.env` a CLI lê e grava, quando não for o do projeto. | — |
| `REBASE_CLOUD_URL` | O control plane com o qual o `rebase cloud` se comunica. | — |
| `REBASE_CLOUD_EMAIL` | A conta com a qual o `rebase cloud login` faz login, em vez de solicitar interativamente. | — |
| `REBASE_CLOUD_PASSWORD` | Sua senha, para que um gerenciador de segredos possa fornecê-la sem que ela fique no histórico do shell. | — |
| `REBASE_DEBUG` | `1` imprime o erro subjacente e os detalhes da requisição em vez da mensagem curta. A primeira coisa a configurar quando um comando `rebase cloud` falhar sem fornecer detalhes úteis. | — |
| `REBASE_DEV_NO_DB` | `rebase dev` não inicializa nenhum banco de dados e não provisiona nada — você fornece o seu próprio. O mesmo que `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixa a porta do servidor de desenvolvimento do frontend, que o `rebase dev` caso contrário deriva do caminho do projeto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Quanto tempo o `rebase dev` aguarda o backend se anunciar antes de informar que ele não iniciou. `0` desativa o relatório. | `30000` |
| `DATABASE_PASSWORD` | A senha que `rebase dev --docker` insere na string de conexão derivada do `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convenção entre ferramentas. Defina com qualquer valor diferente de `0` e a CLI não enviará telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | O mesmo, especificamente para o Rebase. Não precisa de arquivo, por isso é a opção a ser usada no CI e em imagens. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Para onde a telemetria é enviada, no caso de um coletor auto-hospedado. | — |

## Segredos em desenvolvimento

`JWT_SECRET` e `REBASE_SERVICE_KEY` são obrigatórios em produção e gerados
para você fora dela, para que você possa começar sem precisar configurar nada.

Esses valores gerados são armazenados em cache em `.rebase-dev-secrets.json`, junto a
`.rebase-dev-port` e `.rebase-dev-url`, e ignorados pelo Git com eles. Anteriormente, eles
eram regenerados a cada inicialização — portanto, reiniciar o servidor de desenvolvimento desconectava você do
seu próprio aplicativo e invalidava qualquer chave de API recém-criada.

- Defina qualquer uma das variáveis explicitamente e a sua será usada; nada é armazenado em cache ou lido.
- Aponte o cache para outro lugar com `REBASE_DEV_SECRETS_FILE` — um caminho, e a
  única variável nesta seção que você configuraria deliberadamente.
- Exclua o arquivo para renovar ambos os segredos. A próxima inicialização grava um novo.
- Se o arquivo não puder ser gravado — como em um contêiner somente leitura —, o servidor inicia
  de qualquer maneira com um segredo efêmero, exatamente como fazia antes.

Nada é armazenado em cache em produção ou sob um executor de testes. Em produção, uma inicialização
que precise gerar qualquer um dos segredos ainda falhará, informando o nome da variável, e isso permanece
inalterado:

```
JWT_SECRET must be explicitly set in production.
Do not rely on auto-generated secrets outside development.
```

## Objeto de Configuração do Backend

O `RebaseBackendConfig` passado para `initializeRebaseBackend()` fornece controle programático:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    basePath: "/api",        // Base path for all API routes (default: "/api")

    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),

    auth: {                  // Authentication config
        jwtSecret: env.JWT_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        requireAuth: true,    // Require auth for data API (default: true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: env.GOOGLE_CLIENT_ID
            ? {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
            : undefined,
        serviceKey: env.REBASE_SERVICE_KEY
    },

    // No bucket configured in production means storage is off, not local:
    // uploads answer 501 rather than landing on a filesystem that is erased
    // on the next redeploy.
    storage: env.STORAGE_TYPE === "s3"
        ? {
            type: "s3",
            bucket: env.S3_BUCKET!,
            region: env.S3_REGION,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            endpoint: env.S3_ENDPOINT
        }
        : env.STORAGE_TYPE === "gcs"
            ? {
                type: "gcs",
                bucket: env.GCS_BUCKET!,
                projectId: env.GCS_PROJECT_ID,
                keyFilename: env.GCS_KEY_FILENAME
            }
            : isProduction && !env.FORCE_LOCAL_STORAGE
                ? undefined
                : {
                    type: "local",
                    basePath: env.STORAGE_PATH || "./uploads"
                },

    history: true,           // Enable entity change history

    enableSwagger: true,     // Enable OpenAPI docs at /api/docs

    logging: {
        level: "info"
    }
});
```

### Alterando `basePath`

`basePath` move todas as rotas da API, portanto o cliente deve ser configurado com o mesmo valor —
caso contrário, continuará solicitando `/api/...` e receberá 404 para tudo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

O painel de administração obtém isso do cliente fornecido a ele; nada mais precisa de
configuração. Se você construir uma URL de requisição manualmente, una-a a partir do cliente em vez
de escrever `/api` você mesmo:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solução de Problemas

### Permissão Negada no SQL Editor (`permission denied for table <name>`)

* **Sintomas:** Consultas personalizadas executadas no SQL Editor do Rebase Studio falham com `cause: error: permission denied for table <name>`, mesmo que a visualização de planilha do CMS carregue os dados com sucesso.
* **Causa:** Por padrão, o Rebase tenta executar consultas do SQL Editor alternando temporariamente as roles do banco de dados para corresponder à role de aplicação do usuário ativo (por exemplo, `SET LOCAL ROLE "admin"`). Se você estiver usando autenticação personalizada em que as roles existem apenas nas tabelas do banco de dados em vez de roles reais do PostgreSQL, a alternância de role falha ou faltam privilégios no banco. A visualização de planilha do CMS é executada com o usuário proprietário da conexão padrão e ignora isso.
* **Solução:** Adicione `DISABLE_DB_ROLE_SWITCHING=true` à configuração do `.env` do seu backend. Isso força o Rebase a executar as consultas do SQL Editor usando os privilégios do proprietário da conexão (geralmente um superusuário/owner).

### Falha na Busca de Esquema no SQL Editor (`Cross-database execution requires adminConnectionString`)

* **Sintomas:** O Studio falha ao carregar a árvore de esquema, ou o SQL Editor exibe `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** O Rebase requer privilégios administrativos para consultar os catálogos do sistema do banco de dados e executar comandos administrativos. Se `adminConnectionString` não for fornecida ao bootstrapper, ou se `getAdmin()` for sobrescrito para retornar `undefined`, essas operações falham.
* **Solução:** Certifique-se de que `adminConnectionString` esteja configurada durante a inicialização do bootstrapper do backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Próximos Passos

- **[Implantação](/docs/getting-started/deployment)** — Guia de implantação em produção
- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend

---
