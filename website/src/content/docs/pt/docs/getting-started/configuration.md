---
sourceHash: 11b34d6efd4ef32e
title: Ambiente e Configuração
sidebar_label: Configuração
description: Todas as variáveis de ambiente e opções de configuração para projetos Rebase.
---

## Variáveis de Ambiente

Toda a configuração é feita por meio de variáveis de ambiente no seu arquivo `.env` na raiz do projeto.

> **Importante**: O Rebase valida variáveis de ambiente com o **Zod** na inicialização. Se
> algo obrigatório estiver faltando ou malformado (uma URL que não é uma URL, uma porta que
> não é um número), o servidor se recusa a iniciar e indica o nome da variável.
>
> O local onde o schema reside depende de como você executa o backend. Um projeto iniciado
> pelo runtime — `rebase dev`, `rebase start`, a imagem publicada — usa o schema
> pertencente ao runtime (`loadBootEnv` em `@rebasepro/server`), que é a união
> de todas as tabelas abaixo. Um projeto que executou [`rebase eject`](/docs/cli)
> possui um `backend/src/env.ts` chamando `loadEnv({ extend })`, e pode adicionar
> suas próprias variáveis tipadas lá.

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-------------|---------|
| `DATABASE_URL` | String de conexão PostgreSQL. **Opcional em desenvolvimento** — se não definida, o `rebase dev` executa um PostgreSQL gerenciado para o projeto, com seus dados sob `.rebase/`. Obrigatória em todos os outros lugares. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chave secreta para assinar tokens JWT. Use uma string aleatória forte (mínimo de 32 caracteres). **Obrigatória em produção** (gerada automaticamente em desenvolvimento). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` é uma grafia do node-postgres, não do libpq.**
>
> O Rebase e o driver Node a aceitam — criptografam, mas não verificam o
> certificado. `psql`, `pg_dump`, `pg_restore` e Atlas não aceitam, e não
> degradam graciosamente: eles se recusam a iniciar com `invalid sslmode value: "no-verify"`.
>
> Os próprios comandos do Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) reescrevem isso para o equivalente `sslmode=require` antes de invocar o
> shell, portanto funcionam com a URL conforme configurada. Executar o `psql` manualmente
> não faz isso — substitua por `sslmode=require` nesse caso, que criptografa sem
> verificar exatamente da mesma forma.

### Frontend

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `VITE_API_URL` | URL da API do backend para o SDK do cliente. **Defina apenas em desenvolvimento** — veja abaixo. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | ID de cliente Google OAuth. Habilita o "Sign in with Google". | — |


> **Deixe `VITE_API_URL` não definida em compilações de produção.**
>
> Em desenvolvimento, o frontend e o backend são origens separadas, portanto o servidor de
> desenvolvimento injeta isso. Em produção, o backend do Rebase serve a SPA, de modo que
> a API é a própria origem da página e o cliente a resolve dessa forma por conta própria.
>
> Embutir uma URL absoluta em um bundle de produção funciona até o momento em que um segundo
> hostname aponta para a mesma aplicação: um domínio personalizado então carrega a página a partir de
> `example.com` e chama a API em `example.rebase.website`, o que é cross-origin,
> fazendo com que cada requisição falhe no preflight. Permitir a origem no CORS
> **não** resolve isso também — o cookie de refresh é `SameSite=Lax` e não é
> enviado cross-site, portanto você limparia os erros do console e ainda continuaria com
> a autenticação quebrada. Sem definir a variável, cada domínio apontando para a aplicação funciona sem
> nenhuma configuração de CORS.

### Backend

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `PORT` | Porta para o servidor HTTP do backend. Lida por `rebase start`. O `rebase dev` a lê **apenas do ambiente do shell** — uma variável `PORT` em `.env` não é lida lá, porque a porta é resolvida antes desse arquivo ser carregado — e, caso contrário, vincula uma porta derivada do caminho do projeto, para que vários projetos possam rodar simultaneamente. `rebase dev --port` tem precedência sobre ambos, e o banner de inicialização informa qual nível foi utilizado. | `3001` |
| `LOG_LEVEL` | Verbosidade dos logs: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra o SQL por trás de uma linha `Failed query: [redacted]`. Toda instrução com falha é ocultada por padrão, porque uma consulta com falha carrega seus parâmetros vinculados — um e-mail, um hash de senha. Defina como `true` ao diagnosticar uma falha de DDL, RLS ou captura de alterações (change-capture). Ignorado quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Lista separada por vírgulas de origens permitidas. **Obrigatória em produção** se diferente do domínio do backend. Em desenvolvimento, ela é *adicionada ao* localhost — veja abaixo. | — |
| `FRONTEND_URL` | URL da aplicação frontend. Usada como alternativa ao CORS_ORIGINS, em ambos os ambientes. | — |
| `ADMIN_CONNECTION_STRING` | String de conexão com o banco de dados em nível de administrador (usada para introspecção de schema e operações de administração). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desativa a troca de funções (role-switching) do PostgreSQL no SQL Editor (útil para autenticação personalizada onde as roles do banco de dados não estão mapeadas). | `false` |

#### CORS em desenvolvimento

O desenvolvimento permite **localhost, além de qualquer origem indicada por `CORS_ORIGINS` (ou `FRONTEND_URL`)**
— a mesma lista usada em produção, com o localhost adicionado em vez de
substituído. Assim, a variável funciona da mesma maneira em ambos os ambientes, e os
casos que precisam dela em desenvolvimento são os comuns:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Uma origem que não seja localhost nem esteja listada é recusada, e a recusa é
registrada nos logs **uma vez por origem** com a linha exata que a permitiria. A recusa
não é excesso de cautela por si só: a API envia credenciais, portanto refletir um
`Origin` arbitrário permitiria que qualquer site visitado pelo desenvolvedor fizesse
requisições autenticadas contra o servidor de desenvolvimento com a sessão dele e lesse as
respostas.

### Autenticação

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `JWT_SECRET` | Segredo para assinatura de JWT (obrigatório em produção, gerado automaticamente em desenvolvimento) | — |
| `JWT_PRIVATE_KEY` | Chave privada PEM para assinar tokens de acesso assimetricamente (RS256), de modo que qualquer entidade com o JWKS possa verificar uma sessão sem poder emitir uma. Aceita uma PEM com quebras de linha reais, uma PEM com escapes `\n` ou base64 de toda a PEM. Sem ela, os tokens permanecem em HS256. | — |
| `JWT_KEY_ID` | Nomeia `JWT_PRIVATE_KEY` no cabeçalho do token e no JWKS. Altere sempre que a chave mudar — a rotação depende de o antigo e o novo serem distinguíveis. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tempo de vida do token de acesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tempo de vida do token de refresh. Deslizante — cada rotação o renova, portanto isso governa quanto tempo uma sessão sobrevive à **inatividade**. | `400d` |
| `ALLOW_REGISTRATION` | Permitir o registro de novos usuários (`true`/`false`). Fora de produção, o **primeiro** usuário sempre pode se registrar, independentemente do que esteja definido aqui — uma tabela de usuários vazia precisa admitir alguém, e esse alguém se torna o administrador. Em produção (`NODE_ENV=production`), essa janela é fechada: uma tabela vazia recusa o registro de bootstrap com `SETUP_REQUIRED`, uma primeira conta criada através do registro aberto é uma conta comum, e o administrador é definido com `REBASE_ADMIN_EMAIL` abaixo ou atribuído com a service key. O `.env.example` do scaffold define como `true`; o padrão do framework é desativado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Chave de emergência (kill switch). Fecha a janela de bootstrap do primeiro usuário que `ALLOW_REGISTRATION=false` deixa deliberadamente aberta fora de produção, de modo que o registro seja bloqueado mesmo em um banco de dados vazio. Combine com `REBASE_ADMIN_EMAIL` abaixo, ou a implantação não terá como produzir seu primeiro chamador autenticado. Todo artefato de implantação distribuído define isso. | — |
| `REBASE_ADMIN_EMAIL` | E-mail da primeira conta de administrador, criada na inicialização **enquanto a tabela de usuários ainda estiver vazia** e nunca depois disso. É assim que uma implantação em produção obtém seu administrador: o operador define a primeira conta em vez de disputar uma corrida com a internet por ela. A inicialização emite aviso quando a tabela está vazia em produção e isso não está configurado. | — |
| `REBASE_ADMIN_PASSWORD` | Senha para essa conta. Pelo menos 12 caracteres, caso contrário é recusada e a conta não é criada. Altere-a após o primeiro login. | — |
| `MFA_ENCRYPTION_KEY` | Criptografa todo segredo TOTP armazenado. Se não configurada, os segredos são criptografados com `JWT_SECRET` e a inicialização emite um aviso — portanto, rotacionar `JWT_SECRET` desconecta todos *e* torna qualquer autenticador registrado indecifrável. Defina uma chave dedicada (32+ caracteres aleatórios) antes que alguém se registre. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | A chave da qual se está rotacionando *para longe*. Defina ambas durante uma rotação: novos segredos são gravados com `MFA_ENCRYPTION_KEY` e os existentes ainda podem ser lidos, para que ninguém seja bloqueado de sua própria conta no meio da rotação. Remova-a quando todos os segredos tiverem sido recriptografados. | — |
| `ALLOW_ANONYMOUS` | Habilita login anônimo (`POST /api/auth/anonymous`). Opcional (opt-in) e deliberadamente não condicionado a `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticação para a API de dados. Defina como `false` para uma superfície de leitura totalmente pública — o RLS ainda se aplica. | `true` |
| `AUTH_DEFAULT_ROLE` | Role atribuída a um usuário recém-registrado quando nenhuma for informada. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta `POST /api/auth/find-user`, que resolve um e-mail para um perfil público mínimo (`uid`, `displayName`, `photoURL`) para fluxos de convite por e-mail. Apenas para chamadores autenticados, e nunca retorna o e-mail, roles ou metadados do usuário encontrado. Desativado por padrão: é uma superfície de enumeração. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` no cookie de refresh: `Strict`, `Lax` ou `None`. `None` requer HTTPS e serve apenas para um frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` no cookie de refresh. Seguro por padrão; `AUTH_COOKIE_SECURE=false` para HTTP simples — uma implantação em um endereço de LAN onde o navegador de outra forma descartaria o cookie e a sessão morreria na expiração do token de acesso sem nenhum erro. Isso emite aviso na inicialização. `http://localhost` não precisa disso. | `true` |
| `GOOGLE_CLIENT_ID` | ID de cliente Google OAuth (validação no backend) | — |
| `GOOGLE_CLIENT_SECRET` | Client secret do Google OAuth | — |
| `GITHUB_CLIENT_ID` | ID de cliente GitHub OAuth | — |
| `GITHUB_CLIENT_SECRET` | Client secret do GitHub OAuth | — |
| `MICROSOFT_CLIENT_ID` | ID de cliente Microsoft OAuth | — |
| `MICROSOFT_CLIENT_SECRET` | Client secret do Microsoft OAuth | — |
| `LINKEDIN_CLIENT_ID` | ID de cliente LinkedIn OAuth | — |
| `LINKEDIN_CLIENT_SECRET` | Client secret do LinkedIn OAuth | — |
| `FACEBOOK_CLIENT_ID` | ID de cliente Facebook OAuth | — |
| `FACEBOOK_CLIENT_SECRET` | Client secret do Facebook OAuth | — |
| `TWITTER_CLIENT_ID` | ID de cliente X/Twitter OAuth | — |
| `TWITTER_CLIENT_SECRET` | Client secret do X/Twitter OAuth | — |
| `DISCORD_CLIENT_ID` | ID de cliente Discord OAuth | — |
| `DISCORD_CLIENT_SECRET` | Client secret do Discord OAuth | — |
| `GITLAB_CLIENT_ID` | ID de cliente GitLab OAuth. O `baseUrl` de uma instância auto-hospedada não possui representação por variável de ambiente — configure o GitLab no bloco `auth` para isso. | — |
| `GITLAB_CLIENT_SECRET` | Client secret do GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | ID de cliente Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret do Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | ID de cliente Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client secret do Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | ID de cliente Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret do Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Apple Services ID. A Apple não possui um client secret estático — o Rebase assina um JWT ES256 de curta duração por troca de token — portanto, precisa de todos os quatro valores `APPLE_*` e não configura nada sem eles. | — |
| `APPLE_TEAM_ID` | ID da Equipe de Desenvolvedor Apple (Apple Developer Team ID), o emissor do JWT. | — |
| `APPLE_KEY_ID` | Key ID da chave privada registrada na Apple. | — |
| `APPLE_PRIVATE_KEY` | Conteúdo do arquivo de chave privada `.p8`, incluindo quebras de linha (escapes `\n` são aceitos). | — |
| `REBASE_SERVICE_KEY` | Chave de API de administração estática. Ignora a autenticação JWT normal para chamadas servidor para servidor quando passada como `Authorization: Bearer <key>`. (Gerada automaticamente em desenvolvimento). | — |
| `REBASE_RATE_LIMIT_STORE` | Onde residem os contadores de limite de taxa (rate limit) de autenticação: `memory` (por processo) ou `sql` (compartilhado entre réplicas). Um processo não pode ver sua própria contagem de réplicas, portanto uma implantação com instâncias irmãs precisa especificar isso — três réplicas no padrão aplicam três vezes o limite. Qualquer outro valor **se recusa a inicializar** em vez de adotar um fallback, incluindo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monta o fluxo de link de login sem senha (magic link). Necessita de um serviço de e-mail configurado, senão o link não tem para onde ir. | `false` |
| `AUTH_EMAIL_OTP` | Monta o login sem senha com um código de seis dígitos enviado por e-mail. Mesma exigência de e-mail mencionada acima. | `false` |
| `CAPTCHA_PROVIDER` | Ativa a verificação de captcha nas rotas de autenticação: `turnstile` ou `hcaptcha`. Não configurado significa sem captcha. | — |
| `CAPTCHA_SECRET` | O segredo do provedor, usado no servidor para verificar o token enviado pelo navegador. Obrigatório assim que `CAPTCHA_PROVIDER` for definido. | — |
| `CAPTCHA_ROUTES` | Rotas de autenticação separadas por vírgula a serem protegidas (por exemplo, `register,login`). Não configurado protege o conjunto padrão do provedor. | — |

### Armazenamento

:::caution[O armazenamento não possui row-level security, portanto precisa de um modelo de acesso]
As coleções são protegidas pelo RLS do Postgres. O armazenamento de objetos (object storage) não tem equivalente —
as chaves compartilham um namespace único e plano — portanto, com um bucket configurado e nenhum modelo de acesso
o servidor **se recusa a inicializar em produção**. Satisfaça isso com exatamente um dos seguintes:
um hook `storageAuthorize` exportado de `config/index.ts` (o que o scaffold
inclui), `STORAGE_PUBLIC_READ` ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend de armazenamento: `local`, `s3` ou `gcs`. Em produção, `local` desativa o armazenamento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Caminho base para o armazenamento local | `./uploads` |
| `FORCE_LOCAL_STORAGE` | Permite armazenamento local em produção — apenas com um volume persistente montado em `STORAGE_PATH` | `false` |
| `S3_BUCKET` | Nome do bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Região AWS | — |
| `S3_ACCESS_KEY_ID` | Chave de acesso AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chave secreta AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Força URLs no formato path-style para o bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome do bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projeto GCP. Geralmente inferido a partir das credenciais. | — |
| `GCS_KEY_FILENAME` | Caminho para um arquivo de chave de conta de serviço. Omitir no GCP, onde o Workload Identity fornece credenciais. | — |
| `STORAGE_PUBLIC_READ` | Serve qualquer objeto para qualquer pessoa, sem token. Apenas para um bucket que seja genuinamente uma CDN pública. Uma das três maneiras de satisfazer a proteção de inicialização abaixo. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite que qualquer chamador autenticado leia, grave, liste e exclua todos os objetos. Nomeado como `INSECURE` no objeto de configuração por um motivo: é defensável apenas em uma aplicação single-tenant onde cada conta é confiável para acessar todos os arquivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Armazena em cache rendições de imagens geradas (redimensionamentos, conversões de formato) em vez de produzi-las por requisição. | `false` |

### E-mail (Opcional)

| Variável | Descrição |
|----------|-------------|
| `SMTP_HOST` | Host do servidor SMTP |
| `SMTP_PORT` | Porta do servidor SMTP |
| `SMTP_SECURE` | Habilita conexão segura (`true`/`false`) |
| `SMTP_USER` | Usuário SMTP |
| `SMTP_PASS` | Senha SMTP |
| `SMTP_FROM` | Endereço do remetente para e-mails do sistema |
| `SMTP_NAME` | Nome de exibição no endereço do remetente |
| `APP_NAME` | Nome do produto usado em assuntos e corpos de e-mail (padrão: `Rebase`) |
| `EMAIL_LOGO_URL` | Logotipo exibido no topo dos modelos de e-mail padrão. PNG ou JPG `http(s)` absoluto — clientes de e-mail removem SVG e bloqueiam URIs `data:`. Não configurado, uma aplicação ainda chamada `Rebase` recebe a marca do Rebase e uma renomeada não recebe nenhum |

### Pool de conexões do banco de dados

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `DB_POOL_MAX` | Máximo de conexões no pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milissegundos em que uma conexão ociosa é mantida | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milissegundos de espera por uma conexão | `10000` |
| `DATABASE_DIRECT_URL` | Conexão direta (sem pool). O [Realtime](/docs/backend/realtime) precisa de uma: `LISTEN`/`NOTIFY` não sobrevive a um pooler de transações como o PgBouncer e, sem isso, as notificações de alterações são desativadas com um aviso em vez de serem silenciosamente perdidas. | — |
| `DATABASE_READ_URL` | Réplica de leitura. Leituras vão para lá quando definida e diferente de `DATABASE_URL`; se a conexão falhar, tudo volta para a primária com um aviso. | — |
| `REBASE_DB_POOL_MAX` | Um teto para cada pool no processo, aplicado independentemente do que cada um solicitou. Apenas dígitos puros: um valor malformado é ignorado em vez de serializar silenciosamente o servidor. | — |

### Comportamento em tempo de execução

Lido pelo runtime — `rebase dev`, `rebase start` e a imagem de servidor
publicada. Um projeto que foi ejetado é responsável por essas decisões em seu próprio código.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | Executa a auditoria de row-level security na inicialização e monta seu endpoint, que reporta tabelas que são servidas sem políticas. | — |
| `REBASE_BASE_PATH` | Caminho base para todas as rotas da API. O cliente deve ser configurado com o mesmo valor — veja [Alterando o `basePath`](#alterando-o-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve os assets estáticos/admin do bundle a partir deste processo. Desative quando houver uma CDN à frente. | `true` |
| `REBASE_HISTORY` | Registra o [histórico de alterações de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respostas com compressão gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Tamanho máximo do corpo da requisição, **em bytes** (`10485760`, não `10MB` — um valor que não seja um número se recusa a inicializar em vez de remover silenciosamente o limite). | — |
| `REBASE_ENABLE_SWAGGER` | A superfície OpenAPI. Três estados: não definido significa ativado em desenvolvimento, desativado em produção; `false` desativa ambos em qualquer lugar. Observe que `true` em produção serve a **especificação** em `/api/docs`, mas não a **interface (UI)** do Swagger em `/api/swagger` — a UI é restrita pelo `NODE_ENV` separadamente. | — |
| `REBASE_METRICS` | Expõe métricas do Prometheus em `/metrics`. | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer que protege `/metrics`. Não definido deixa o endpoint aberto para qualquer um que possa alcançar a porta — aceitável em uma rede privada, mas não em uma pública, e os logs de inicialização alertam sobre isso. | — |
| `REBASE_MIGRATE_ON_BOOT` | O que o runtime pode fazer com o schema na inicialização. `ensure` (o padrão em qualquer lugar — produção inclusa) executa a etapa **aditiva**: cria tabelas, colunas e tipos enum ausentes, nunca remove ou reescreve um. `none` não toca em nada. A imagem publicada aceita apenas esses dois e **se recusa a inicializar em `push`**. Em uma [implantação dividida](/docs/deployment/split-processes), exatamente um processo pode provisionar, portanto qualquer outra função deve definir `none` ou se recusará a inicializar. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Recusa-se a inicializar quando o banco de dados foi provisionado pela última vez a partir de um conjunto de coleções diferente daquele a partir do qual este processo foi construído. Não definido (ou qualquer valor diferente de `true`/`1`) emite um aviso. | warn |
| `REALTIME_CDC` | Captura de alterações em nível de banco de dados: `auto` (habilita onde a conexão suportar, reverte silenciosamente caso contrário), `trigger` (força o uso, avisa se impossível), `wal` (degrada para `trigger` atualmente), `off`. Veja [Realtime](/docs/backend/realtime#database-level-change-capture-cdc). | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instâncias para canais de broadcast e presença: `memory` ou `postgres`. Ignorado quando `realtime.bus` receber um transporte construído. | `memory` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost`/loopback sob `NODE_ENV=production`. Desativado por padrão, para que uma inicialização de produção falhe ruidosamente em vez de conectar-se a um banco de dados inexistente. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | O que a inicialização faz com uma chave em suas coleções que esta versão não reconhece: `warn`, `error` (recusa-se a inicializar — vale a pena ativar no CI) ou `off`. Governa apenas chaves que ela não *reconhece*, que geralmente são erros de digitação e ocasionalmente metadados deliberados; uma chave que ela sabe que mudou de lugar é sempre fatal, pois o recurso que ela configurava estaria silenciosamente ausente de outra forma. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` executa a etapa de schema e encerra sem abrir um socket — o formato que um Job de migração precisa, a partir da mesma imagem e do mesmo bundle do servidor que o segue. Um valor vazio é considerado *não definido*, para que um `${SOMETHING}` não substituído em um arquivo compose não transforme uma implantação comum em uma que apenas migra e se recusa a servir requisições. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que uma máquina — um agente, um job de CI — *aplique* uma alteração de schema através de `/api/admin/schema`, não apenas planeje uma. Desativado a menos que solicitado: a credencial que faria tal alteração é a mais propensa a estar em uma variável de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Por quanto tempo uma custom function pode rodar antes que sua requisição seja abortada. O mesmo ajuste que a opção `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` faz com que uma rejeição de promise não tratada encerre o processo em vez de registrá-la em log. Ativado sob um orquestrador que irá reiniciar você; desativado onde uma reinicialização for pior do que um vazamento (leak). | `false` |
| `REBASE_CRON_ALWAYS_ON` | Mantém o agendador de cron em execução em uma plataforma que o runtime, de outra forma, detectaria como scale-to-zero, onde um timer que dispara em uma instância ociosa não dispara em nenhuma instância. | — |
| `TRUSTED_PROXY_HOPS` | Quantos proxies estão à frente deste servidor, para que o rate limiter possa extrair o endereço IP real do cliente de `X-Forwarded-For`. Padrão à prova de falhas `0`: sem proxy, confiar no cabeçalho permitiria que qualquer chamador forjasse uma identidade. | `0` |

:::note[O provisionamento na inicialização é aditivo e não é uma ferramenta de migração]
A etapa de inicialização é executada de forma autônoma sem que ninguém leia um diff, portanto nunca removerá uma
coluna, restringirá um tipo ou reescreverá uma tabela. É por isso também que a imagem recusa
`REBASE_MIGRATE_ON_BOOT=push`: um push completo calcula um diff e executará alegremente
`DROP COLUMN`, e o reinício de um contêiner nunca deve ser capaz de destruir uma
coluna de produção como efeito colateral de um reagendamento.

Alterações destrutivas ou de reestruturação permanecem onde podem ser revisadas: `rebase db
generate` + `rebase db migrate`, ou `rebase db push` a partir de um checkout ou CI,
que simula a alteração (dry-run), recusa as destrutivas sem confirmação e
pode criar um backup primeiro.
:::

### Implantações divididas

Uma imagem e um bundle podem ser inicializados várias vezes, cada um servindo uma
parte diferente do projeto. Uma linha para cada aqui, pois esta página tem a proposta de
listar todas as variáveis; o que cada combinação *monta e gerencia* — e quais
combinações se recusam a inicializar — está em
**[Processos Divididos](/docs/deployment/split-processes)**.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_ROLE` | Qual parte este processo atende: `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Substitui se *este* processo executa os agendadores cron. Não definido segue a role. | — |
| `REBASE_JOB_WORKERS` | Substitui se este processo executa os workers da fila de jobs. Não definido segue a role. | — |
| `REBASE_FUNCTIONS_ONLY` | Atende apenas as custom functions especificadas neste processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Atende todas as custom functions, exceto as especificadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Para onde o processo de API encaminha uma requisição de função que ele mesmo não atende. | — |

### Superfície MCP

Um endpoint opcional (opt-in) do Model Context Protocol em `/mcp`, para que um cliente de IA possa ler
e gravar neste projeto **como o usuário autenticado**. Desativado a menos que configurado e — ao
contrário de qualquer outra superfície — nenhum `REBASE_ROLE` o ativa: os outros descrevem o
formato de um processo, enquanto este é uma decisão de entregar credenciais a um software
de terceiros, e deve ser tomada por uma pessoa em vez de herdada da função de um contêiner.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Monta a superfície MCP. Requer `REBASE_PUBLIC_URL`; sem ela, a superfície se recusa a montar e avisa no log de inicialização. | `false` |
| `REBASE_PUBLIC_URL` | A origem externamente acessível desta implantação, por exemplo `https://app.example.com`. A superfície MCP não pode derivá-la — obter a origem do cabeçalho `Host` faria com que a identidade do emissor e a audiência contra a qual seus próprios tokens são verificados fossem valores fornecidos pelo chamador. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite o registro dinâmico de clientes OAuth (RFC 7591), para que um cliente possa se registrar por conta própria. Defina como `false` para exigir que os clientes sejam registrados previamente. | `true` |

### Backups

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Expressão cron para backups agendados. Não definido significa que os backups agendados estão desativados. | — |
| `BACKUP_DESTINATION` | Caminho local ou uma URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Exclui backups com mais de N dias. Não definido ou `0` mantém tudo. | — |
| `BACKUP_KEEP_MINIMUM` | Sempre mantém pelo menos N dos backups mais recentes, independentemente da retenção. | — |
| `PG_DUMP_PATH` | Substitui o binário `pg_dump` — ele deve corresponder à versão principal do servidor. | — |
| `PG_RESTORE_PATH` | Substitui o binário `pg_restore`. | — |

Backups contêm segredos e dados pessoais (PII). Use um destino privado com
criptografia em repouso.
| `PG_DUMPALL_PATH` | Onde o `pg_dumpall` reside, quando não está no `PATH`. Sem ele — e sem as ferramentas de cliente PostgreSQL instaladas —, um backup de globals falha com um erro indicando esta variável. | — |

### Entrega de bundle

Uma implantação gerenciada não carrega seu código na imagem: o runtime busca um
bundle na inicialização. Estas variáveis decidem qual e como.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Caminho para um diretório de bundle já extraído. O que `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | De onde buscar o arquivo do bundle quando não houver um local. | — |
| `REBASE_BUNDLE_TOKEN` | A credencial Bearer para essa busca. Trate-a como um segredo: é o que autoriza um locatário a baixar seu próprio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Onde um bundle baixado é extraído. Deve ter permissão de escrita e persistir entre o download e a inicialização. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionais que a imagem do runtime fornece ao bundle, além daqueles que ele próprio declara. | — |

### Vinculações de recursos

Cada banco de dados, bucket e tópico que um projeto declara em `config/resources.ts` é
vinculado por variáveis de ambiente nomeadas a partir dele. Os nomes base estão abaixo; um
recurso não padrão anexa `__` e sua chave em letras maiúsculas, portanto um bucket chamado
`media` lê `S3_BUCKET__MEDIA`. O comando `rebase status`
exibe, por recurso,
a variável exata que ele está lendo e se ela está definida.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_DRIVER` | O pacote npm que implementa o driver de uma fonte de dados, quando não for o driver padrão do Postgres. Sufixado por fonte: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | A string de conexão para um tópico declarado. Sufixado por tópico. | — |

### O próprio ambiente da CLI

Lido pelo `rebase`, não pelo servidor. Nada aqui afeta uma implantação.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_BASE_URL` | O backend com o qual `rebase auth` e `rebase api-keys` se comunicam, em vez de derivá-lo do projeto. | — |
| `REBASE_PORT` | A porta que esses comandos assumem ao derivar essa URL. | — |
| `SERVICE_KEY` | A service key com a qual eles se autenticam, em vez de solicitar interativamente. | — |
| `REBASE_ENV_FILE_PATH` | Qual arquivo `.env` a CLI lê e grava, quando não for o do projeto. | — |
| `REBASE_CLOUD_URL` | O plano de controle com o qual o `rebase cloud` se comunica. | — |
| `REBASE_CLOUD_EMAIL` | A conta com a qual o `rebase cloud login` se autentica, em vez de solicitar interativamente. | — |
| `REBASE_CLOUD_PASSWORD` | Sua senha, para que um gerenciador de segredos possa fornecê-la sem que ela vá para o histórico do shell. | — |
| `REBASE_DEBUG` | `1` exibe o erro subjacente e detalhes da requisição em vez da mensagem curta. A primeira coisa a configurar quando um comando `rebase cloud` falhar sem detalhes úteis. | — |
| `REBASE_DEV_NO_DB` | `rebase dev` não inicia nenhum banco de dados e não provisiona nada — você fornece o seu próprio. O mesmo que `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixa a porta do servidor de desenvolvimento frontend, que de outra forma o `rebase dev` deriva do caminho do projeto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Quanto tempo o `rebase dev` espera pelo backend se anunciar antes de informar que ele não iniciou. `0` desativa o relatório. | `30000` |
| `DATABASE_PASSWORD` | A senha que o `rebase dev --docker` insere na string de conexão que ele deriva de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | A convenção entre ferramentas. Defina com qualquer valor diferente de `0` e a CLI não enviará telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | O mesmo, especificamente para o Rebase. Não requer arquivo, motivo pelo qual é a variável ideal para usar no CI e em uma imagem. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Para onde a telemetria é enviada, para um coletor auto-hospedado. | — |

## Segredos em desenvolvimento

`JWT_SECRET` e `REBASE_SERVICE_KEY` são obrigatórios em produção e gerados
para você fora dela, para que você possa começar sem configurar nada.

Esses valores gerados são armazenados em cache em `.rebase-dev-secrets.json`, ao lado de
`.rebase-dev-port` e `.rebase-dev-url` e adicionados ao gitignore com eles. Antes, eles
eram regenerados a cada inicialização — portanto, reiniciar o servidor de desenvolvimento desconectava você
da sua própria aplicação e invalidava qualquer chave de API que você tivesse acabado de criar.

- Defina qualquer uma das variáveis explicitamente e a sua será usada; nada é armazenado em cache ou lido.
- Aponte o cache para outro lugar com `REBASE_DEV_SECRETS_FILE` — um caminho, e a
  única variável nesta seção que você configuraria deliberadamente.
- Exclua o arquivo para renovar ambos os segredos. A próxima inicialização gravará um novo.
- Se o arquivo não puder ser gravado — por exemplo, em um contêiner somente leitura —, o servidor iniciará
  mesmo assim com um segredo efêmero, exatamente como fazia antes.

Nada é armazenado em cache em produção, nem sob um executor de testes. Em produção, uma inicialização
que precisasse gerar qualquer um dos segredos ainda falha, indicando a variável, e isso
permanece inalterado:

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

### Alterando o `basePath`

O `basePath` move todas as rotas da API, portanto o cliente deve ser configurado com o mesmo valor —
caso contrário, ele continuará requisitando `/api/...` e receberá um 404 para tudo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

O painel administrativo obtém isso do cliente fornecido; nada mais precisa ser
configurado. Se você construir uma URL de requisição manualmente, concatene-a a partir do cliente em vez
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

* **Sintomas:** Consultas personalizadas executadas no editor SQL do Rebase Studio falham com `cause: error: permission denied for table <name>`, mesmo que a visualização em planilha do CMS carregue os dados com sucesso.
* **Causa:** Por padrão, o Rebase tenta executar consultas do SQL Editor alternando temporariamente as roles do banco de dados para corresponder à role de aplicação do usuário ativo (por exemplo, `SET LOCAL ROLE "admin"`). Se você estiver usando autenticação personalizada em que as roles existem apenas nas tabelas do banco de dados e não como roles reais do PostgreSQL, a troca de role falha ou os privilégios do banco de dados estão ausentes. A visualização em planilha do CMS é executada sob o usuário padrão proprietário da conexão e ignora isso.
* **Solução:** Adicione `DISABLE_DB_ROLE_SWITCHING=true` à configuração do seu `.env` no backend. Isso força o Rebase a executar consultas do SQL Editor usando os privilégios do proprietário da conexão (normalmente um superusuário/owner).

### Falha ao Carregar Schema no SQL Editor (`Cross-database execution requires adminConnectionString`)

* **Sintomas:** O Studio falha ao carregar a árvore de schemas, ou o SQL Editor lança `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** O Rebase requer privilégios administrativos para consultar catálogos de sistema do banco de dados e executar comandos administrativos. Se `adminConnectionString` não for fornecida ao bootstrapper, ou se `getAdmin()` for sobrescrito para retornar `undefined`, essas operações falham.
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
