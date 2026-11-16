---
sourceHash: cf61934167f91e79
title: Ambiente e Configuração
sidebar_label: Configuração
description: Todas as variáveis de ambiente e opções de configuração para projetos Rebase.
---

## Variáveis de Ambiente

Toda a configuração é feita por meio de variáveis de ambiente no seu arquivo `.env` na raiz do projeto.

> **Importante**: O Rebase valida variáveis de ambiente com o **Zod** na inicialização. Se
> qualquer item obrigatório estiver faltando ou malformado (uma URL que não é uma URL, uma porta que
> não é um número), o servidor se recusa a iniciar e indica a variável.
>
> O local onde o esquema reside depende de como você executa o backend. Um projeto inicializado pelo
> runtime — `rebase dev`, `rebase start`, a imagem publicada — usa o
> esquema que pertence ao runtime (`loadBootEnv` em `@rebasepro/server`), que é a
> união de cada tabela abaixo. Um projeto que executou [`rebase eject`](/docs/cli)
> possui um `backend/src/env.ts` chamando `loadEnv({ extend })`, e pode adicionar suas próprias
> variáveis tipadas ali.

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `DATABASE_URL` | String de conexão do PostgreSQL. **Opcional em desenvolvimento** — se não definida, o `rebase dev` executa um PostgreSQL gerenciado para o projeto, com seus dados sob `.rebase/`. Obrigatória em todos os outros ambientes. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chave secreta para assinar tokens JWT. Use uma string aleatória forte (mínimo de 32 caracteres). **Obrigatória em produção** (gerada automaticamente em desenvolvimento). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` é uma grafia do node-postgres, não do libpq.**
>
> O Rebase e o driver Node a aceitam — criptografa, mas não verifica o
> certificado. O `psql`, `pg_dump`, `pg_restore` e Atlas não aceitam, e eles não
> degradam graciosamente: recusam-se a iniciar com `invalid sslmode value: "no-verify"`.
>
> Os comandos próprios do Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) reescrevem isso para o equivalente `sslmode=require` antes de invocar o shell,
> para que funcionem com a URL conforme configurada. Recorrer ao `psql` manualmente não
> faz isso — substitua por `sslmode=require` lá, o que criptografa sem verificar exatamente
> da mesma maneira.

### Frontend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `VITE_API_URL` | URL da API do backend para o SDK tipado. **Defina isso apenas em desenvolvimento** — veja abaixo. | origem da página |
| `VITE_GOOGLE_CLIENT_ID` | Client ID do Google OAuth. Habilita "Fazer login com o Google". | — |

> **Deixe `VITE_API_URL` não definido em builds de produção.**
>
> Em desenvolvimento, o frontend e o backend ficam em origens separadas, portanto o servidor
> de desenvolvimento injeta isso. Em produção, o backend do Rebase serve o SPA, portanto a
> API é a própria origem da página e o cliente a resolve dessa forma por conta própria.
>
> Embutir uma URL absoluta em um bundle de produção funciona até que um segundo
> hostname aponte para a mesma aplicação: um domínio customizado então carrega a página a partir de
> `example.com` e chama a API em `example.rebase.website`, o que é cross-origin,
> fazendo com que toda requisição falhe no preflight. Permitir a origem no CORS
> **não** resolve isso — o cookie de atualização é `SameSite=Lax` e não é
> enviado cross-site, portanto você eliminaria os erros do console e ainda assim teria a
> autenticação quebrada. Sem definir, qualquer domínio apontando para a aplicação funciona sem
> nenhuma configuração de CORS.

### Backend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta para o servidor HTTP do backend. Lida por `rebase start`. O `rebase dev` a lê **apenas do ambiente do shell** — um `PORT` no `.env` não é lido lá, pois a porta é resolvida antes desse arquivo ser carregado — e, caso contrário, vincula uma porta derivada do caminho do projeto, permitindo que vários projetos rodem ao mesmo tempo. `rebase dev --port` tem precedência sobre ambos, e o banner de inicialização informa qual foi utilizado. | `3001` |
| `LOG_LEVEL` | Nível de detalhamento dos logs: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Exibe o SQL por trás de uma linha `Failed query: [redacted]`. Toda instrução que falha é ocultada por padrão, porque uma consulta com falha carrega seus parâmetros vinculados — um e-mail, um hash de senha. Defina como `true` ao diagnosticar uma falha de DDL, RLS ou captura de alterações. Ignorado quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Lista separada por vírgulas de origens permitidas. **Obrigatória em produção**, a menos que `FRONTEND_URL` esteja definida: uma inicialização de produção sem nenhuma das duas recusa-se a iniciar. Em desenvolvimento, ela é *adicionada ao* localhost — veja abaixo. | — |
| `FRONTEND_URL` | URL da aplicação frontend. Usada como alternativa a `CORS_ORIGINS`, em ambos os ambientes. | — |
| `ADMIN_CONNECTION_STRING` | String de conexão do banco de dados com nível de admin (usada para introspecção de esquema e operações administrativas). O banco que ela nomeia não é aquele que o console SQL chama de atual, nem o que uma nova branch copia por padrão: ambos são o banco de dados no qual a própria conexão da aplicação está (veja `REBASE_BRANCH_PARENT_DATABASE` para um servidor em uma branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desativa a troca de papéis (role-switching) do PostgreSQL no Editor SQL (útil para autenticação customizada onde as roles do banco não estão mapeadas). O console SQL do Studio então informa que as linhas foram lidas como o proprietário da conexão, nomeia-o e desativa seu seletor de papéis. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | O banco de dados a partir do qual a branch em que este servidor roda foi copiada. `rebase dev` o define em um checkout [alternado para uma branch](/docs/backend/branching/#cli-integration). Um servidor com ela mantém o registro de branches naquele banco de dados e copia novas branches a partir dele por padrão, de modo que o painel Branches do Studio mostra as branches do banco principal. | — |

#### CORS em desenvolvimento

O desenvolvimento permite **o localhost, mais o que `CORS_ORIGINS` (ou `FRONTEND_URL`)
especificar** — a mesma lista que a produção utiliza, com o localhost adicionado em vez de
substituído. Assim, a variável funciona da mesma forma em ambos os ambientes, e os
casos que precisam dela em desenvolvimento são os comuns:

```bash
# Um telefone na LAN, a máquina de um colega, um túnel ngrok,
# uma porta encaminhada do Codespaces — todas origens diferentes de localhost.
CORS_ORIGINS=http://192.168.1.5:5173
```

Uma origem que não seja localhost nem esteja listada é recusada, e a recusa é
registrada em log **uma vez por origem** com a linha exata que a permitiria. Recusar não
é precaução por si só: a API envia credenciais, portanto refletir um `Origin`
arbitrário permitiria que qualquer site que o desenvolvedor visitasse fizesse
requisições autenticadas contra o servidor de desenvolvimento com sua sessão e lesse as
respostas.

### Autenticação

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `JWT_SECRET` | Segredo para assinatura de JWT (obrigatório em produção, gerado automaticamente em desenvolvimento) | — |
| `JWT_PRIVATE_KEY` | Chave privada PEM para assinar tokens de acesso assimetricamente (RS256), para que qualquer serviço que possua o JWKS possa verificar uma sessão sem poder emitir uma. Aceita um PEM com quebras de linha reais, um PEM com escapes `\n` ou base64 do PEM inteiro. Sem ela, os tokens permanecem em HS256. | — |
| `JWT_KEY_ID` | Identifica a `JWT_PRIVATE_KEY` no cabeçalho do token e no JWKS. Altere-a sempre que a chave mudar — a rotação depende de ser possível distinguir a antiga da nova. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tempo de vida do token de acesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tempo de vida do token de atualização. Deslizante — cada rotação o renova, portanto isso governa quanto tempo uma sessão sobrevive à **inatividade**. Defina `400d` para sessões que sobrevivem a uma longa ausência; os navegadores limitam o cookie de atualização a esse período. | `30d` |
| `ALLOW_REGISTRATION` | Permitir o registro de novos usuários (`true`/`false`). Fora de produção, o **primeiro** usuário sempre pode se registrar, independentemente do que estiver aqui — uma tabela de usuários vazia precisa aceitar alguém, e esse alguém se torna o administrador. Em produção (`NODE_ENV=production`), essa janela é fechada: uma tabela vazia recusa o registro de bootstrap com `SETUP_REQUIRED`, uma primeira conta criada através de registro aberto é uma conta comum, e o administrador é definido com `REBASE_ADMIN_EMAIL` abaixo ou atribuído com a service key. O `.env.example` do scaffold define como `true`; o padrão do framework é desativado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Botão de desligamento emergencial. Fecha a janela de bootstrap do primeiro usuário que `ALLOW_REGISTRATION=false` deliberadamente deixa aberta fora de produção, de modo que o registro fica fechado mesmo contra um banco de dados vazio. Combine com `REBASE_ADMIN_EMAIL` abaixo, ou a implantação não terá como produzir seu primeiro usuário autenticado. Todo artefato de implantação distribuído define isso. | — |
| `REBASE_ADMIN_EMAIL` | E-mail da primeira conta de admin, criada na inicialização **enquanto a tabela de usuários ainda estiver vazia** e nunca depois. É assim que uma implantação de produção obtém seu admin: o operador define a primeira conta em vez de disputá-la na internet aberta. A inicialização avisa quando a tabela estiver vazia em produção e isso não estiver configurado. | — |
| `REBASE_ADMIN_PASSWORD` | Senha para essa conta. Pelo menos 12 caracteres, caso contrário é recusada e a conta não é criada. Altere-a após o primeiro login. | — |
| `MFA_ENCRYPTION_KEY` | Criptografa cada segredo TOTP armazenado. Se não configurada, os segredos são criptografados com `JWT_SECRET` e a inicialização emite um aviso — logo, rotacionar `JWT_SECRET` desconecta todos *e* torna qualquer autenticador registrado indecifrável. Defina uma chave dedicada (32+ caracteres aleatórios) antes que alguém se registre. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | A chave da qual se está rotacionando *para longe*. Defina ambas durante uma rotação: novos segredos são gravados com `MFA_ENCRYPTION_KEY` e os existentes ainda podem ser lidos, para que ninguém seja bloqueado de sua própria conta no meio da rotação. Remova-a quando todos os segredos tiverem sido recriptografados. | — |
| `ALLOW_ANONYMOUS` | Habilita login anônimo (`POST /api/auth/anonymous`). Opcional (opt-in) e deliberadamente não controlado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticação para a API de dados. Defina como `false` para uma superfície de leitura totalmente pública — o RLS ainda se aplica. | `true` |
| `AUTH_DEFAULT_ROLE` | Papel (role) atribuído a um usuário recém-registrado quando nenhum for especificado. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Disponibiliza `POST /api/auth/find-user`, que resolve um e-mail para um perfil público mínimo (`uid`, `displayName`, `photoURL`) para fluxos de convite por e-mail. Apenas chamadores autenticados, e nunca retorna o e-mail, papéis ou metadados do usuário encontrado. Desativado por padrão: é uma superfície de enumeração. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` no cookie de atualização: `Strict`, `Lax` ou `None`. `None` requer HTTPS e é apenas para um frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` no cookie de atualização. Seguro por padrão; `AUTH_COOKIE_SECURE=false` para HTTP comum — uma implantação em um endereço de LAN onde o navegador descartaria o cookie e a sessão morreria na expiração do token de acesso sem erro. Um aviso é emitido na inicialização. `http://localhost` não precisa disso. | `true` |
| `GOOGLE_CLIENT_ID` | Client ID do Google OAuth (validação no backend) | — |
| `GOOGLE_CLIENT_SECRET` | Client Secret do Google OAuth | — |
| `GITHUB_CLIENT_ID` | Client ID do GitHub OAuth | — |
| `GITHUB_CLIENT_SECRET` | Client Secret do GitHub OAuth | — |
| `MICROSOFT_CLIENT_ID` | Client ID da Microsoft OAuth | — |
| `MICROSOFT_CLIENT_SECRET` | Client Secret da Microsoft OAuth | — |
| `LINKEDIN_CLIENT_ID` | Client ID do LinkedIn OAuth | — |
| `LINKEDIN_CLIENT_SECRET` | Client Secret do LinkedIn OAuth | — |
| `FACEBOOK_CLIENT_ID` | Client ID do Facebook OAuth | — |
| `FACEBOOK_CLIENT_SECRET` | Client Secret do Facebook OAuth | — |
| `TWITTER_CLIENT_ID` | Client ID do X/Twitter OAuth | — |
| `TWITTER_CLIENT_SECRET` | Client Secret do X/Twitter OAuth | — |
| `DISCORD_CLIENT_ID` | Client ID do Discord OAuth | — |
| `DISCORD_CLIENT_SECRET` | Client Secret do Discord OAuth | — |
| `GITLAB_CLIENT_ID` | Client ID do GitLab OAuth. O `baseUrl` de uma instância auto-hospedada não possui definição por variável de ambiente — configure o GitLab no bloco `auth` para isso. | — |
| `GITLAB_CLIENT_SECRET` | Client Secret do GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Client ID do Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client Secret do Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Client ID do Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client Secret do Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Client ID do Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client Secret do Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Apple Services ID, para login na web. É público e é publicado em `GET /auth/config`. A Apple não tem um client secret estático, porque o Rebase assina um JWT ES256 de curta duração para cada troca de token. Portanto, a Apple precisa de `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, além deste ou de `APPLE_BUNDLE_IDS`, e não configura nada sem eles. | — |
| `APPLE_BUNDLE_IDS` | IDs de bundle separados por vírgula dos apps nativos de iOS/macOS cujos códigos do Sign in with Apple são aceitos. | — |
| `APPLE_TEAM_ID` | Team ID de Desenvolvedor Apple, o emissor do JWT. | — |
| `APPLE_KEY_ID` | Key ID da chave privada registrada na Apple. | — |
| `APPLE_PRIVATE_KEY` | Conteúdo do arquivo de chave privada `.p8`, incluindo quebras de linha (escapes `\n` são aceitos). | — |
| `REBASE_SERVICE_KEY` | Chave de API de admin estática. Ignora a autenticação JWT normal para chamadas servidor-a-servidor quando enviada como `Authorization: Bearer <key>`. (Gerada automaticamente em desenvolvimento). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | A chave pública da plataforma de hospedagem (PEM, EC P-256) contra a qual os tokens de plataforma `rpt_` são verificados; múltiplos blocos PEM durante uma rotação de chaves. A plataforma define isso no deploy e não contém nada secreto. Junto com `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que a proteção de admin aceite um token de plataforma para `cron:read`, e para nada mais. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | O ID do projeto que o `aud` de um token de plataforma deve ser igual, para que um token emitido para outro projeto seja recusado. Com apenas uma das duas variáveis definidas, o servidor inicia, registra um aviso no log e responde a todo token `rpt_` com `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Onde os contadores de limite de taxa residem, para as rotas de autenticação e para `rateLimit` em funções customizadas: `memory` (por processo) ou `sql` (compartilhado entre réplicas). Um processo não pode ver a contagem de suas próprias réplicas, então uma implantação com instâncias paralelas precisa especificar — três réplicas no padrão aplicam três vezes o limite. Qualquer outro valor **recusa a inicialização** em vez de adotar um fallback, inclusive `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Disponibiliza o fluxo de link de login sem senha (magic link). Requer um serviço de e-mail configurado, caso contrário o link não tem para onde ir. | `false` |
| `AUTH_EMAIL_OTP` | Disponibiliza login sem senha com um código de seis dígitos enviado por e-mail. Mesma exigência de e-mail acima. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Cadastro sem senha: uma requisição de magic-link ou código por e-mail para um endereço desconhecido cria a conta, enquanto o registro estiver aberto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | O que acontece quando um token de atualização é reutilizado após sua janela de reutilização: `reject` (recusa, mantém a sessão) ou `revoke-session` (encerra a sessão). Qualquer outro valor causa falha na inicialização. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro com confirmação prévia: nenhum login por senha até que o endereço seja verificado. Requer e-mail; a inicialização recusa sem ele. | `false` |
| `CAPTCHA_PROVIDER` | Ativa a verificação de captcha nas rotas de autenticação: `turnstile` ou `hcaptcha`. Não definido significa sem captcha. | — |
| `CAPTCHA_SECRET` | O segredo do provedor, usado no servidor para verificar o token que o navegador envia. Obrigatório assim que `CAPTCHA_PROVIDER` for definido. | — |
| `CAPTCHA_ROUTES` | Rotas de autenticação separadas por vírgula para proteger (por exemplo `register,login`). Não definido protege o conjunto padrão do provedor. | — |

### Storage

:::caution[O storage não possui row-level security, portanto precisa de um modelo de acesso]
As tabelas são protegidas pelo RLS do Postgres. O armazenamento de objetos não tem equivalente —
as chaves compartilham um namespace único e plano — portanto, com um bucket configurado e nenhum modelo de acesso,
o servidor **se recusa a iniciar em produção**. Satisfaça isso com exatamente um dos seguintes:
um hook `storageAuthorize` exportado de `backend/storage.ts` (o que o scaffold
já inclui), `STORAGE_PUBLIC_READ` ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `STORAGE_TYPE` | Backend de armazenamento: `local`, `s3` ou `gcs`. Em produção, `local` desativa o storage a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Caminho base para o storage local. Um caminho relativo é lido a partir do diretório em que o servidor executa: a raiz do projeto em `rebase dev`, `backend/` em um servidor gerado por `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite storage local em produção — apenas com um volume persistente mantendo o `STORAGE_PATH` e os diretórios `<STORAGE_PATH>__<key>` dos buckets locais nomeados ao lado dele | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante os quais a URL de download de um arquivo privado funciona — o token que `getSignedUrl()` coloca nele. No máximo `604800` (uma semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Maior arquivo que a fonte aceita, em bytes, em cada caminho de upload — `__<KEY>` para uma fonte nomeada. Um valor que não seja um número inteiro de bytes recusa a inicialização | `52428800` (50 MB) |
| `S3_BUCKET` | Nome do bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Região da AWS | — |
| `S3_ACCESS_KEY_ID` | Access key da AWS | — |
| `S3_SECRET_ACCESS_KEY` | Secret key da AWS | — |
| `S3_ENDPOINT` | Endpoint S3 customizado (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forçar URLs no formato path-style para o bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome do bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projeto do GCP. Geralmente inferido a partir das credenciais. | — |
| `GCS_KEY_FILENAME` | Caminho para um arquivo de chave de service-account. Omita no GCP, onde o Workload Identity fornece as credenciais. | — |
| `STORAGE_PUBLIC_READ` | Serve cada objeto para qualquer pessoa, sem token. Apenas para um bucket que é genuinamente uma CDN pública. Uma das três maneiras de satisfazer a trava de inicialização abaixo. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite que qualquer chamador autenticado leia, grave, liste e exclua qualquer objeto. Chamado de `INSECURE` no objeto de configuração por um motivo: só é defensável em uma aplicação single-tenant onde toda conta é confiável com todos os arquivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Armazena em cache rendições geradas de imagens (redimensionamentos, conversões de formato) em vez de gerá-las por requisição. | `false` |

### E-mail (Opcional)

| Variável | Descrição |
|----------|-----------|
| `SMTP_HOST` | Host do servidor SMTP |
| `SMTP_PORT` | Porta do servidor SMTP |
| `SMTP_SECURE` | Habilitar conexão segura (`true`/`false`) |
| `SMTP_USER` | Usuário do SMTP |
| `SMTP_PASS` | Senha do SMTP |
| `SMTP_FROM` | Endereço de remetente para e-mails do sistema |
| `SMTP_NAME` | Nome de exibição no endereço do remetente |
| `APP_NAME` | Nome do produto usado nos assuntos e corpos dos e-mails (padrão: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo exibido no topo dos modelos de e-mail padrão. PNG ou JPG absoluto `http(s)` — os clientes de e-mail removem SVG e bloqueiam URIs `data:`. Não definido, uma aplicação ainda chamada `Rebase` recebe a marca do Rebase e uma aplicação renomeada não recebe nenhum |

### Pool de conexões do banco de dados

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `DB_POOL_MAX` | Máximo de conexões no pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milissegundos em que uma conexão ociosa é mantida | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milissegundos de espera por uma conexão | `10000` |
| `DATABASE_DIRECT_URL` | Conexão direta (sem pool). O [Realtime](/docs/backend/realtime) precisa de uma: `LISTEN`/`NOTIFY` não sobrevive a um pooler de transação como o PgBouncer e, sem ela, as notificações de mudança são desativadas com um aviso em vez de serem silenciosamente perdidas. O [job worker](/docs/backend/jobs) mantém seu `LISTEN` de despertar nela também. Preenche o `directConnectionString` do adaptador do Postgres quando não definido. | — |
| `DATABASE_READ_URL` | Réplica de leitura, como um hot standby. Quando aponta para outro servidor, leituras autenticadas (listagens, linhas únicas, contagens, agregações) são atendidas lá sob o mesmo row-level security; gravações, login, realtime, crons, jobs, o console SQL e `rebase.sql` permanecem no primário. Um leitor que acabou de gravar lê do primário por `REBASE_READ_STICKY_MS`, e todos leem do primário enquanto a réplica estiver com atraso superior a `REBASE_READ_MAX_LAG_MS` ou falhando. Preenche o `readConnectionString` do adaptador do Postgres quando não definido; até o 0.28 inclusive, o pool da réplica era aberto e nunca lido. | — |
| `REBASE_READ_STICKY_MS` | Após uma gravação, quanto tempo as leituras do mesmo usuário vão para o primário, para que um salvamento seguido por uma listagem exiba o dado salvo. Por instância do servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Lag da réplica a partir do qual todas as leituras vão para o primário. | `1000` |
| `DATABASE_POOLED` | `true` quando `DATABASE_URL` passa por um pooler em modo de transação como o PgBouncer. O pool então não envia `search_path` ou `statement_timeout` na conexão (o pooler os recusaria ou descartaria) e define ambos em cada transação; a inicialização define o `search_path` padrão da role do banco como `public` para instruções fora de uma transação. `DATABASE_DIRECT_URL` torna-se obrigatória, e o realtime, o despertar do worker de jobs, compilações de índice, branching e o console SQL usam-na. A URL da réplica também é considerada com pool. `DATABASE_POOLED__<KEY>` para outra fonte de dados. | — |
| `REBASE_DB_POOL_MAX` | Um teto para cada pool no processo, aplicado independentemente do que cada um solicitou. Apenas dígitos puros: um valor malformado é ignorado em vez de serializar o servidor silenciosamente. | — |

### Comportamento em tempo de execução

Lido pelo runtime — `rebase dev`, `rebase start` e a imagem de servidor
publicada. Um projeto que executou eject assume essas decisões em seu próprio código.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_RLS_AUDIT` | `true` executa a [auditoria agendada de row-level security](/docs/rls-check#running-it-on-a-schedule), que relata tabelas que estão sendo servidas sem políticas. O projeto deve declarar `@rebasepro/rls-check` entre suas dependências: o runtime não inclui nenhuma cópia e, sem o pacote, a inicialização é recusada, indicando-o. `false` mantém a varredura desativada neste processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | O papel do Postgres sob o qual requisições autenticadas e anônimas executam. Atribua a cada projeto em um cluster compartilhado o seu próprio. Um banco de dados registra o papel em que opera, e uma inicialização configurada para outro se recusa a iniciar até que `rebase db request-role migrate` o migre. Veja [Executando em um banco de dados existente ou compartilhado](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` cria o papel de requisição e permite que a conexão alterne para ele; `never` deixa ambos a seu encargo e apenas os verifica. | `auto` |
| `REBASE_RLS_GRANTS` | O que o Rebase concede ao papel de requisição: `schema` (todas as tabelas nos esquemas que ele serve, mais privilégios padrão), `managed` (apenas as tabelas que ele serve) ou `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe as políticas permissivas do Rebase ao(s) papel(is) de requisição, para que outros papéis lendo as mesmas tabelas não recebam nada delas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` grava as políticas que apenas o contexto do servidor ou um admin pode passar `TO public`, e executa administradores como o papel de requisição. Por padrão, elas são `TO rebase_admin`, para que leituras no escopo do proprietário por usuários autenticados possam usar o índice do proprietário. Veja [Requisições de admin e `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` remove a política de linha de base do servidor ou admin de todas as tabelas. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` também define `request.jwt.claims` e `request.jwt.claim.*`, para que políticas escritas com `auth.uid()` vejam o chamador. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | O que a inicialização faz quando outro login pode alternar para o papel de requisição: `warn`, `refuse` ou `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Caminho base para todas as rotas de API. O cliente deve ser configurado com o mesmo valor — veja [Alterando `basePath`](#alterando-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve os assets estáticos/admin do bundle a partir deste processo. Desative quando houver uma CDN à frente. | `true` |
| `REBASE_HISTORY` | Registra o [histórico de alterações de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respostas com compressão gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` ativa as [notificações push](/docs/backend/push-notifications/): as rotas `/api/push`, a tabela `rebase.push_subscriptions` e `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | O par de chaves VAPID com o qual as mensagens push são assinadas. Fora de produção, um par é gerado e mantido em `.rebase-dev-secrets.json` quando não definido; em produção, o push permanece desativado sem elas. | — |
| `REBASE_VAPID_SUBJECT` | Um endereço `mailto:` ou URL `https://` que os serviços de push possam contatar. O padrão é a origem de um `REBASE_PUBLIC_URL` em `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Corpo máximo da requisição, **em bytes** (`10485760`, não `10MB` — um valor que não seja um número recusa a inicialização em vez de remover silenciosamente o limite). `0` desativa o limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | A superfície OpenAPI. Possui três estados. Não definido, em qualquer ambiente: `/api/docs` é servido aos chamadores para os quais `GET /api/schema/tables` descreve tabelas, cada um recebendo o documento das tabelas descritas, e não há Swagger UI. `true` publica o documento inteiro para todos, com a **UI** do Swagger em `/api/swagger` fora de produção (nunca em produção). `false` mantém o documento protegido pelo gate de admin. | — |
| `REBASE_METRICS` | Expõe métricas do Prometheus em `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Adiciona `includeSubDomains` ao cabeçalho `Strict-Transport-Security`, para que os navegadores recusem HTTP comum em qualquer subdomínio do host por seis meses — incluindo hosts que este processo não atende. Ative apenas quando todos os subdomínios do domínio forem exclusivamente HTTPS. Qualquer valor diferente de `true`/`false` recusa a inicialização. Veja [Cabeçalhos de segurança](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer protegendo `/metrics`. Não definido deixa o endpoint aberto para qualquer um que possa alcançar a porta — aceitável em uma rede privada, mas não em uma pública, e os logs de inicialização alertam sobre isso. | — |
| `REBASE_MIGRATE_ON_BOOT` | O que o runtime pode fazer com o esquema das tabelas na inicialização. `ensure` (o padrão em todos os lugares — incluindo produção) executa a passagem **aditiva**: cria tabelas, colunas e tipos enum ausentes, nunca descartando ou reescrevendo nada. `none` deixa o esquema das tabelas declaradas intocado, mas as tabelas do próprio framework (auth, chaves de API, jobs, cron) ainda são criadas e mantidas atualizadas; `REBASE_PROVISION=false` desativa essas também. A imagem publicada aceita apenas essas duas opções e **se recusa a iniciar com `push`**. Em uma [implantação dividida](/docs/deployment/split-processes), exatamente um processo pode provisionar, então qualquer outro papel deve definir `none` ou falhará ao iniciar. | `ensure` |
| `REBASE_PROVISION` | `false` faz com que o runtime não altere nada em seu banco de dados: nenhuma tabela, coluna, índice, função, trigger, política, papel ou concessão, na inicialização ou depois, inclusive as do próprio framework. Ele reporta o que está faltando por nome. Para um banco de dados que apenas seu processo de mudanças pode alterar. Veja [Quando apenas seu processo de mudanças pode alterar o banco de dados](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Apenas `true` e `false` são aceitos. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Recusa a inicialização quando o banco de dados foi provisionado pela última vez a partir de um conjunto de tabelas diferente do qual este processo foi construído. Não definido (ou qualquer valor diferente de `true`/`1`) apenas emite um aviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Recusa a inicialização quando um arquivo de função ou cron lança um erro ou não faz o parse durante a importação, indicando cada arquivo e o motivo, para que um deploy gradual (rolling deploy) mantenha a versão antiga servindo. Uma reinicialização também é submetida a isso. Não definido (ou qualquer valor diferente de `true`) ignora o arquivo e serve o restante. Um arquivo que importa sem erros e não exporta nenhuma função ou job é sempre ignorado, não recusado. | skip |
| `REALTIME_CDC` | Captura de alterações a nível de banco de dados: `auto` (lê alterações do WAL onde o banco de dados permitir, senão usa triggers, senão recorre ao nível de aplicação, registrando cada fallback como info), `trigger` (força o uso de triggers, avisa se impossível), `wal` (lê alterações do log write-ahead em vez de triggers; necessita de `wal_level=logical` e um papel que possa replicar, recorre a `trigger` caso contrário), `off`. Veja [Realtime](/docs/backend/realtime-cdc/). Tem precedência sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instâncias para canais de broadcast e presença: `memory` ou `postgres`. Ignorado quando `realtime.bus` recebeu um transporte construído manualmente. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Quantas inscrições um socket de realtime pode manter; a próxima é recusada com `TOO_MANY_SUBSCRIPTIONS`. Um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSubscriptionsPerSocket`. Veja [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Quantos sockets de realtime um usuário, ou uma chave de API, pode manter abertos em uma instância do servidor. Sockets de personificação de um administrador contam contra o administrador. O login do próximo socket é recusado com `TOO_MANY_SOCKETS` e o socket é fechado (4002); o SDK continua tentando novamente, para que entre quando outro for fechado. Um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSocketsPerUser`. | Sem limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | O tempo máximo que uma alteração aguarda pela nova busca (refetch) que a entrega aos assinantes ativos, em ms. Uma nova busca aguarda 300 ms sem nenhuma alteração, e no máximo este período sob um fluxo constante de gravações. Um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Por quanto tempo o total de uma inscrição de lista grande pode ser reutilizado antes de ser contado novamente, em ms; frames que o reutilizam carregam `meta.totalAsOf`. Não definido, todo frame faz a contagem. Tem precedência sobre `realtime.recountIntervalMs`. | Não definido |
| `REALTIME_RECOUNT_MIN_ROWS` | O menor total anterior ao qual `REALTIME_RECOUNT_INTERVAL_MS` se aplica; listas menores são contadas a cada frame. Tem precedência sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost`/loopback sob `NODE_ENV=production`. Desativado por padrão, para que uma inicialização em produção falhe expressamente em vez de conectar a um banco de dados que não existe ali. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` executa a etapa de esquema e encerra sem abrir um socket — o formato ideal para um Job de migração, a partir da mesma imagem e do mesmo bundle do servidor que o sucede. Também cria as tabelas que um processo de atendimento criaria no primeiro uso, e não inicia nenhum cron ou fila de jobs. Um valor vazio é considerado *não definido*, para que um `${SOMETHING}` não substituído em um arquivo compose não transforme uma implantação comum em uma que apenas migra e se recusa a servir. Recusado em conjunto com `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Um caminho de arquivo. Uma execução de provisionamento (`REBASE_PROVISION_ONLY=true`) grava nela todas as alterações de esquema realizadas, em ordem, como um script SQL para revisão e aplicação com `psql`. As linhas gravadas não são incluídas. Recusado em um processo que atende requisições. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que uma máquina — um agente, um job de CI — *aplique* uma alteração de esquema através de `/api/admin/schema`, não apenas a planeje. Desativado a menos que solicitado: a credencial que faria tal alteração é a mais propensa a estar armazenada em uma variável de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Quanto tempo uma função customizada pode executar antes que sua requisição seja abortada. O mesmo controle da opção `functionsTimeoutMs`. `0` desativa o limite. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` faz com que uma rejeição de promise não tratada encerre o processo em vez de apenas registrá-la em log. Ativado sob um orquestrador que irá reiniciar a aplicação; desativado onde uma reinicialização for pior do que um vazamento. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silencia o aviso de inicialização em uma plataforma que o runtime detecta como "scale-to-zero", onde um timer que dispara em uma instância ociosa dispara em nenhuma instância. Não altera mais nada: ative quando mantiver pelo menos uma instância em execução contínua. | — |
| `TRUSTED_PROXY_HOPS` | Quantos proxies estão à frente deste servidor, para que o limitador de taxa possa extrair o endereço real do cliente a partir de `X-Forwarded-For`. Padrão seguro contra falhas `0`: sem proxy, confiar no cabeçalho permitiria que qualquer chamador forjasse uma identidade. | `0` |

:::note[O provisionamento na inicialização é aditivo e não é uma ferramenta de migração]
A etapa de inicialização executa de forma desacompanhada sem ninguém lendo um diff, portanto nunca removerá
uma coluna, estreitará um tipo ou reescreverá uma tabela. É também por isso que a imagem recusa
`REBASE_MIGRATE_ON_BOOT=push`: um push completo calcula um diff e executará alegremente
`DROP COLUMN`, e o reinício de um container nunca deve ser capaz de destruir uma
coluna de produção como efeito colateral de um reagendamento.

Mudanças destrutivas ou de reformulação permanecem onde possam ser revisadas: `rebase db
generate` + `rebase db migrate`, ou `rebase db push` a partir de um checkout ou CI,
que simula a alteração (dry-run), recusa alterações destrutivas sem confirmação e
pode realizar um backup antes.
:::

### Implantações divididas (Split deployments)

Uma mesma imagem e um mesmo bundle podem ser inicializados várias vezes, cada um atendendo a uma
parte diferente do projeto. Apenas uma linha para cada aqui, pois esta página lista
todas as variáveis; o que cada combinação *disponibiliza e gerencia* — e quais
combinações recusam a inicialização — está documentado em
**[Processos Divididos](/docs/deployment/split-processes)**.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_ROLE` | Qual parte este processo atende: `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescreve se *este* processo executa os timers de cron. Não definido segue o papel. | — |
| `REBASE_JOB_WORKERS` | Sobrescreve se este processo executa os workers da fila de jobs. Não definido segue o papel. | — |
| `REBASE_FUNCTIONS_ONLY` | Atende apenas as funções customizadas especificadas neste processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Atende todas as funções customizadas, exceto as especificadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Para onde o processo de API encaminha uma requisição de função que ele próprio não atende. Em um `worker`, para onde suas próprias chamadas `rebase.functions` são enviadas. Uma URL `http(s)`. | — |

### Superfície MCP

Um endpoint opcional do Model Context Protocol em `/mcp`, para que um cliente de IA possa ler
e gravar neste projeto **como o usuário autenticado**. Desativado a menos que configurado, e — ao contrário
de todas as outras superfícies — nenhum `REBASE_ROLE` o ativa: os outros descrevem o
formato de um processo, enquanto este é uma decisão de conceder credenciais a um software
de terceiros, devendo ser tomada por uma pessoa em vez de herdada da função de um container.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_MCP_ENABLED` | Disponibiliza a superfície MCP. Requer `REBASE_PUBLIC_URL`; sem ela, a superfície recusa a montagem e informa isso no log de inicialização. | `false` |
| `REBASE_PUBLIC_URL` | A origem externamente acessível desta implantação, por exemplo `https://app.example.com`. A superfície MCP não pode derivá-la — extrair a origem do cabeçalho `Host` tornaria a identidade do emissor, e a audiência contra a qual seus próprios tokens são validados, um valor fornecido pelo chamador. | — |
| `REBASE_MCP_VIEW` | Caminho para a visualização MCP App própria do projeto (`rebase-view.html`, gerada por `rebaseMcpViewPlugin()`), servida ao Claude em vez da visualização genérica, para que suas views, campos e ações customizadas sejam o que ele renderiza. Sem ela, o backend busca ao lado do frontend que ele serve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite o registro dinâmico de clientes OAuth (RFC 7591), para que um cliente possa se registrar sozinho. Defina como `false` para exigir que os clientes sejam registrados antecipadamente. | `true` |

### Edição de esquema ao vivo a partir de um bundle

Desativada a menos que `REBASE_LIVE_SCHEMA_REPOSITORY` esteja definida. Um bundle compilado não possui
o código-fonte de `backend/schema` para editar, então, com estas variáveis definidas, o editor de esquemas lê
o fonte do repositório, faz o commit de cada alteração de volta e executa seu DDL
neste banco de dados. Exclusivo para administradores e aplicado por uma pessoa, a menos que
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` determine o contrário. Um repositório definido sem
credenciais utilizáveis causa a recusa de inicialização. Veja
[Edição de esquema ao vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | O repositório do GitHub no qual commitar alterações de esquema, no formato `owner/name`. Defini-lo é o que ativa a funcionalidade. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | A branch na qual o commit é aplicado. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Onde `backend/schema` reside naquele repositório, relativo à raiz do repositório. Um caminho que saia do repositório recusa a inicialização, assim como a variável descontinuada `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Um token com permissões refinadas de leitura e gravação no conteúdo do repositório. Defina este ou as três variáveis `_GITHUB_APP_*`, não ambos. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | O ID de um GitHub App, para commitar como o aplicativo em vez de usar um token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | A instalação do app no repositório. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | A chave privada do app: PEM, PEM com quebras de linha escapadas ou base64. | — |

### Backups

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `BACKUP_SCHEDULE` | Expressão cron para backups agendados. Não definido significa que backups agendados estão desativados. | — |
| `BACKUP_DESTINATION` | Caminho local, ou uma URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obrigatório com `BACKUP_SCHEDULE`, que se recusa a rodar sem ele. `rebase db backup` adota `./backups` como fallback a partir de onde foi executado. | — |
| `BACKUP_RETENTION_DAYS` | Excluir backups com mais de N dias. Não definido ou `0` mantém tudo. | — |
| `BACKUP_KEEP_MINIMUM` | Sempre manter pelo menos N dos backups mais recentes, independentemente da retenção. | — |
| `PG_DUMP_PATH` | Sobrescreve o binário `pg_dump` — deve ser da versão principal do servidor ou mais recente. | — |
| `PG_RESTORE_PATH` | Sobrescreve o binário `pg_restore`. | — |
| `PSQL_PATH` | Sobrescreve o binário `psql` que `rebase db restore --clean` executa para tornar a restauração uma única transação. | — |
| `PG_DUMPALL_PATH` | Onde o `pg_dumpall` reside, quando não estiver no `PATH`. Sem ele — e sem as ferramentas de cliente do PostgreSQL instaladas — o backup de globais falha com um erro indicando esta variável. | — |

A imagem oficial de runtime (`rebasepro/server`) inclui as ferramentas de cliente
do PostgreSQL 18, de modo que um backup agendado executa dentro dela contra qualquer servidor até o Postgres 18.
Fora da imagem, instale-as você mesmo (`apt-get install postgresql-client-18`,
`brew install libpq`).

Os backups contêm segredos e dados pessoais (PII). Use um destino privado com
criptografia em repouso.

### Entrega de bundles

Uma implantação gerenciada não carrega seu código na imagem: o runtime busca um
bundle na inicialização. Estas variáveis definem qual bundle e como.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BUNDLE` | Caminho para um diretório de bundle já extraído. O que o `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | De onde baixar o arquivo compactado do bundle, quando não houver um local. | — |
| `REBASE_BUNDLE_TOKEN` | A credencial bearer para essa busca. Trate-a como um segredo: é o que autoriza um tenant a baixar seu próprio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Onde um bundle baixado é extraído. Deve ter permissão de escrita e deve persistir entre a busca e a inicialização. | — |
| `REBASE_RUNTIME_MODULES` | Módulos extras que a imagem do runtime disponibiliza para o bundle, além dos que ele próprio declara. | — |

### Vinculações de recursos (Resource bindings)

Todo banco de dados, bucket e tópico que um projeto declara em `backend/resources.ts` é
vinculado por variáveis de ambiente nomeadas a partir dele. Os nomes base estão abaixo; um
recurso não padrão anexa `__` e sua chave em maiúsculas, portanto um bucket chamado
`media` lê `S3_BUCKET__MEDIA`. O comando `rebase status` exibe, por recurso,
a variável exata que está sendo lida e se ela está definida.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_DRIVER` | O pacote npm que implementa o driver de uma fonte de dados, quando não for o padrão do Postgres. Com sufixo por fonte: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | A string de conexão para um tópico declarado. Com sufixo por tópico. | — |

### O ambiente da própria CLI

Lido por `rebase`, não pelo servidor. Nada aqui afeta uma implantação.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BASE_URL` | Onde `rebase api-keys`, `rebase storage` e `rebase auth reset-password` enviam a service key, no shell ou no `.env`. Defina-a quando o servidor rodar de outra forma que não seja `rebase dev` neste projeto: `rebase start`, um container, outro host. Não definida, eles usam o servidor que `rebase dev` registrou enquanto esse servidor estiver rodando, e não enviam nada quando não estiver. | — |
| `REBASE_SERVICE_KEY` | A chave de serviço com a qual esses comandos se autenticam, lida do `.env`: a mesma variável que o servidor lê (veja acima). | — |
| `SERVICE_KEY` | Um nome mais antigo para essa chave. Quando o `.env` a define, `rebase api-keys` e `rebase storage` a leem no lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qual arquivo `.env` a CLI lê e grava, quando não for o do próprio projeto. | — |
| `REBASE_ROOT_RULES` | `0` impede `rebase init` e `rebase skills install` de gravarem as regras do projeto nos arquivos `CLAUDE.md` e `AGENTS.md` na raiz do repositório, para raízes cujos arquivos de agentes você gerencia manualmente. | on |
| `REBASE_CLOUD_URL` | O plano de controle com o qual o `rebase cloud` se comunica. | — |
| `REBASE_CLOUD_EMAIL` | A conta com a qual `rebase cloud login` autentica, em vez de solicitar interativamente. | — |
| `REBASE_CLOUD_PASSWORD` | A senha dessa conta, para que um cofre de segredos possa fornecê-la sem que vá parar no histórico do shell. | — |
| `REBASE_TOKEN` | Um token gerado por `rebase cloud tokens create`. Quando definido, qualquer comando `rebase cloud` autentica-se com ele em vez da sessão de `rebase cloud login`, e nunca lê ou grava a sessão armazenada. Em um diretório vinculado por `rebase cloud init --claim`, ele é desconsiderado em favor do token do próprio projeto quando não possui escopo sobre o projeto. É a forma recomendada de executar `rebase cloud` em CI — veja [CI e agentes](/docs/deployment/cloud/#ci-and-agents). O [servidor MCP](/docs/ai/mcp/) o repassa para a CLI que suas ferramentas cloud inicializam, e nunca o envia para a aplicação: defina `REBASE_API_TOKEN` para isso. | — |
| `REBASE_DEBUG` | `1` imprime os detalhes do erro e da requisição subjacentes em vez da mensagem curta. A primeira coisa a definir quando um comando `rebase cloud` falhar sem informações claras. | — |
| `REBASE_ATLAS_DEV_URL` | O banco de dados vazio contra o qual `rebase db push`, `db generate` e `db migrate` planejam o diff, em vez do `<db>_dev_diff` que eles criam ao lado de `DATABASE_URL`. O Rebase nem cria nem remove um banco nomeado aqui, e recusa um que seja idêntico a `DATABASE_URL`. No banco de desenvolvimento gerenciado, a CLI define isso para um PGlite efêmero em memória próprio. Defina-o onde `CREATE DATABASE` não for permitido. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` não inicializa nenhum banco de dados e não provisiona nada — você fornece o seu próprio. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixa a porta do servidor de desenvolvimento do frontend, que caso contrário `rebase dev` deriva do caminho do projeto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Quanto tempo o `rebase dev` aguarda o backend se anunciar antes de informar que ele não iniciou. `0` desativa o relatório. | `30000` |
| `DATABASE_PASSWORD` | A senha que `rebase dev --docker` insere na string de conexão derivada do `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convenção comum entre ferramentas. Definido para qualquer valor diferente de `0`, a CLI não envia telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | O mesmo, especificamente para o Rebase. Não requer arquivo, motivo pelo qual é a variável ideal para usar em CI e em imagens. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Para onde a telemetria é enviada, no caso de um coletor auto-hospedado. | — |

## Segredos em desenvolvimento

O `JWT_SECRET` é obrigatório em produção. Ele e `REBASE_SERVICE_KEY` são
gerados automaticamente para você fora de produção, permitindo que você comece sem configurar nada.

Esses valores gerados ficam em cache em `.rebase-dev-secrets.json`, ao lado de
`.rebase-dev-port` e `.rebase-dev-url`, e são ignorados pelo git junto com eles. Anteriormente, eles
eram gerados a cada inicialização — portanto, reiniciar o servidor de desenvolvimento desconectava você da
sua própria aplicação e invalidava qualquer chave de API recém-criada.

- Defina qualquer uma das variáveis explicitamente e a sua será usada; nada é armazenado em cache ou lido do arquivo.
- Aponte o cache para outro lugar com `REBASE_DEV_SECRETS_FILE` — um caminho, e a
  única variável nesta seção que você definiria deliberadamente.
- Exclua o arquivo para renovar ambos os segredos. A próxima inicialização gravará um novo arquivo.
- Se o arquivo não puder ser gravado — em um container somente leitura, por exemplo —, o servidor inicia
  mesmo assim com um segredo efêmero, exatamente como costumava fazer.

Nada é colocado em cache em produção, ou sob um executor de testes. Em produção, nada
é gerado automaticamente: uma inicialização sem `JWT_SECRET` falha, indicando a variável, e
esse comportamento não muda:

```
The environment is not valid:
  JWT_SECRET: is required
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
    schemaDir: "./schema",     // The backend/schema directory: the tables, and what the schema editor writes
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

    enableSwagger: true,     // Publish the whole OpenAPI document at /api/docs to everyone

    logging: {
        level: "info"
    }
});
```

As mesmas opções,
sem `app`, `server` e `basePath` e com um `provision` obrigatório, criam um
backend que não serve nada até que você o monte: `createRebaseBackend`. Veja
[Integração com Servidor Customizado](/docs/backend/custom-server/).

### Alterando `basePath`

O `basePath` altera o caminho de todas as rotas da API, portanto o cliente deve ser informado da mesma coisa —
caso contrário, continuará requisitando `/api/...` e recebendo 404 para tudo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

O painel de administração obtém isso do cliente que lhe é fornecido; nada mais precisa
de configuração. Se você construir uma URL de requisição manualmente, concatene-a a partir do cliente em vez
de escrever `/api` diretamente:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solução de Problemas

### Permissão Negada no Editor SQL (`permission denied for table <name>`)

* **Sintomas:** Consultas customizadas executadas no editor SQL do Rebase Studio falham com `cause: error: permission denied for table <name>`, mesmo que a visualização de planilha do CMS carregue os dados com sucesso.
* **Causa:** Por padrão, o Rebase tenta executar consultas do Editor SQL alternando temporariamente os papéis do banco de dados para corresponder ao papel de aplicação do usuário ativo (por exemplo, `SET LOCAL ROLE "admin"`). Se você estiver usando autenticação customizada em que os papéis existem apenas em tabelas do banco de dados em vez de papéis reais do PostgreSQL, a troca de papel falha ou faltam privilégios no banco. A visualização de planilha do CMS executa sob o usuário proprietário da conexão padrão e contorna isso.
* **Solução:** Adicione `DISABLE_DB_ROLE_SWITCHING=true` à configuração do seu `.env` do backend. Isso força o Rebase a executar as consultas do Editor SQL usando os privilégios do proprietário da conexão (geralmente um superusuário/owner). O Editor SQL então informa, acima dos resultados, que eles foram lidos como o proprietário da conexão e desativa seu seletor de papéis.

### Falha ao Buscar Esquema no Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Sintomas:** O Studio não consegue carregar a árvore de esquema, ou o Editor SQL lança `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** O Rebase requer privilégios administrativos para consultar os catálogos do sistema do banco de dados e executar comandos administrativos. Se `adminConnectionString` não for fornecido ao bootstrapper, ou se `getAdmin()` for sobrescrito para retornar `undefined`, essas operações falham.
* **Solução:** Garanta que `adminConnectionString` esteja configurado durante a inicialização do bootstrapper do backend:
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
