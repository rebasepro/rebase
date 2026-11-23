---
sourceHash: 9acb2b3f441697d7
title: Ambiente e Configuração
sidebar_label: Configuração
description: Todas as variáveis de ambiente e opções de configuração para projetos Rebase.
---

## Variáveis de Ambiente

Toda a configuração é feita por meio de variáveis de ambiente no arquivo `.env` na raiz do projeto.

> **Importante**: O Rebase valida as variáveis de ambiente com o **Zod** na inicialização. Se
> algo obrigatório estiver ausente ou malformado (uma URL que não é uma URL, uma porta que
> não é um número), o servidor recusa a inicialização e informa o nome da variável.
>
> Onde o schema reside depende de como você executa o backend. Um projeto inicializado pelo
> runtime — `rebase dev`, `rebase start`, a imagem publicada — usa o
> schema do próprio runtime (`loadBootEnv` em `@rebasepro/server`), que é a
> união de todas as tabelas abaixo. Um projeto que executou [`rebase eject`](/docs/cli)
> possui um `backend/src/env.ts` chamando `loadEnv({ extend })`, podendo adicionar suas próprias
> variáveis tipadas lá.

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-------------|---------|
| `DATABASE_URL` | String de conexão do PostgreSQL. **Opcional em desenvolvimento** — se não definida, o `rebase dev` executa um PostgreSQL gerenciado para o projeto, com seus dados sob `.rebase/`. Obrigatória em todos os outros ambientes. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chave secreta para assinar tokens JWT. Use uma string aleatória forte (mínimo de 32 caracteres). **Obrigatória em produção** (gerada automaticamente em desenvolvimento). | `a1b2c3d4e5...` |

> **Em um banco de dados gerenciado, `sslmode=require` pode não significar o que parece.**
>
> Para o `psql` e todas as ferramentas libpq, `require` significa "criptografado, certificado não
> verificado". O driver Node no qual o Rebase é executado lê isso como `verify-full`, portanto, um
> banco de dados cujo certificado não foi assinado por nenhuma autoridade pública — comum em instâncias gerenciadas
> do Postgres — recusa o runtime com `self-signed certificate`, enquanto o `psql`
> se conecta usando a mesma URL. O runtime e os comandos `rebase db` são interrompidos com uma
> mensagem explicando isso.
>
> Escolha uma das opções:
>
> - **`sslmode=no-verify`** — criptografado, não verificado: o que `require` significa para a
>   libpq. É uma grafia do node-postgres que a libpq não possui, portanto `psql`, `pg_dump`
>   e Atlas a recusam com `invalid sslmode value: "no-verify"`. Os comandos próprios do Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) passam esse valor
>   para eles como `sslmode=require`, funcionando com a URL conforme configurada; para usar o
>   `psql` manualmente, substitua por `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — verificado em relação ao certificado
>   de CA do provedor. Igual para todas as ferramentas.
>
> `uselibpqcompat=true&sslmode=require`, sugerido pelo próprio aviso do driver Node,
> também funciona para o runtime; os comandos do Rebase removem `uselibpqcompat`
> antes de passar a URL para as ferramentas libpq, que o rejeitam.

### Frontend

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `VITE_API_URL` | URL da API do backend para o SDK tipado. **Defina apenas em desenvolvimento** — veja abaixo. | origem da página |
| `VITE_GOOGLE_CLIENT_ID` | Client ID do Google OAuth. Habilita "Entrar com o Google". | — |


> **Deixe `VITE_API_URL` não definida em compilações de produção.**
>
> Em desenvolvimento, o frontend e o backend possuem origens separadas, portanto o servidor
> de desenvolvimento injeta isso. Em produção, o backend do Rebase serve a SPA, logo a
> API fica na própria origem da página e o cliente a resolve dessa forma automaticamente.
>
> Embutir uma URL absoluta em um bundle de produção funciona até que um segundo
> hostname aponte para a mesma aplicação: um domínio customizado então carrega a página a partir de
> `example.com` e chama a API em `example.rebase.website`, o que é
> cross-origin, fazendo com que todas as requisições falhem no preflight. Permitir a origem no CORS
> também **não** resolve — o cookie de atualização é `SameSite=Lax` e não é
> enviado cross-site, portanto você eliminaria os erros no console mas continuaria com a
> autenticação quebrada. Sem ser definida, qualquer domínio que aponte para o app funciona sem
> necessidade de nenhuma configuração de CORS.

### Backend

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `PORT` | Porta para o servidor HTTP do backend. Lida por `rebase start`. O `rebase dev` a lê **apenas do ambiente do shell** — um `PORT` em `.env` não é lido lá, pois a porta é resolvida antes de o arquivo ser carregado — e, caso contrário, vincula uma porta derivada do caminho do projeto, permitindo que vários projetos sejam executados ao mesmo tempo. `rebase dev --port` tem prioridade sobre ambos, e o banner de inicialização informa o método utilizado. | `3001` |
| `LOG_LEVEL` | Nível de detalhamento dos logs: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra o SQL por trás de uma linha `Failed query: [redacted]`. Cada instrução com falha é ocultada por padrão, pois uma query que falhou carrega seus parâmetros vinculados — um e-mail, um hash de senha. Defina como `true` durante o diagnóstico de falhas de DDL, RLS ou captura de alterações. Ignorado quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Lista separada por vírgulas de origens permitidas. **Obrigatória em produção**, a menos que `FRONTEND_URL` esteja definida: uma inicialização em produção sem nenhuma das duas se recusa a iniciar. Em desenvolvimento, ela é *adicionada ao* localhost — veja abaixo. | — |
| `FRONTEND_URL` | URL da aplicação frontend. Usada como alternativa a CORS_ORIGINS em ambos os ambientes. | — |
| `ADMIN_CONNECTION_STRING` | String de conexão com o banco de dados em nível de administrador (usada para introspecção de schema e operações administrativas). O banco de dados especificado não é o que o console SQL considera atual, nem o que uma nova branch copia por padrão: ambos são o banco de dados no qual a própria conexão da aplicação está configurada (consulte `REBASE_BRANCH_PARENT_DATABASE` para um servidor em uma branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desativa a alternância de roles do PostgreSQL no SQL Editor (útil para autenticação personalizada onde as roles do banco não são mapeadas). O console SQL do Studio então informa que as linhas foram lidas como o proprietário da conexão, exibe seu nome e desativa o seletor de roles. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | O banco de dados a partir do qual a branch em que este servidor roda foi copiada. O `rebase dev` a define em um checkout [alternado para uma branch](/docs/backend/branching/#cli-integration). Um servidor com esta variável mantém o registro de branches nesse banco de dados e copia novas branches a partir dele por padrão, permitindo que o painel Branches do Studio exiba as branches do banco de dados principal. | — |

#### CORS em desenvolvimento

O desenvolvimento permite **localhost, além do que `CORS_ORIGINS` (ou `FRONTEND_URL`)
definir** — a mesma lista usada em produção, com localhost adicionado em vez de
substituído. Portanto, a variável funciona da mesma forma em ambos os ambientes, e os
casos que precisam dela em desenvolvimento são os usuais:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Uma origem que não seja localhost nem esteja listada é recusada, e a recusa é
registrada em log **uma vez por origem** com a linha exata necessária para permiti-la. A recusa
não é uma cautela sem propósito: a API envia credenciais, portanto refletir um
`Origin` arbitrário permitiria que qualquer site visitado pelo desenvolvedor fizesse
requisições autenticadas no servidor de desenvolvimento usando sua sessão e lesse as
respostas.

### Autenticação

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `JWT_SECRET` | Segredo para assinatura de JWT (obrigatório em produção, gerado automaticamente em desenvolvimento) | — |
| `JWT_PRIVATE_KEY` | Chave privada PEM para assinar tokens de acesso assimetricamente (RS256), permitindo que qualquer entidade que possua o JWKS verifique uma sessão sem poder emitir uma. Aceita um PEM com quebras de linha reais, um PEM com escapes `\n` ou base64 do PEM completo. Sem ela, os tokens permanecem em HS256. | — |
| `JWT_KEY_ID` | Nomeia `JWT_PRIVATE_KEY` no cabeçalho do token e no JWKS. Altere-o sempre que a chave for alterada — a rotação depende de ser possível distinguir entre a antiga e a nova. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tempo de vida do access token | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tempo de vida do refresh token. Deslizante — cada rotação o renova, determinando quanto tempo uma sessão sobrevive à **inatividade**. Defina `400d` para sessões que sobrevivem a uma longa ausência; os navegadores limitam o cookie de atualização a esse período. | `30d` |
| `ALLOW_REGISTRATION` | Permite o registro de novos usuários (`true`/`false`). Fora de produção, o **primeiro** usuário sempre pode se registrar, independentemente desta configuração — uma tabela de usuários vazia precisa admitir alguém, e esse alguém se torna o admin. Em produção (`NODE_ENV=production`), essa janela é fechada: uma tabela vazia recusa o registro de bootstrap com `SETUP_REQUIRED`, uma primeira conta criada via registro aberto é uma conta comum, e o admin é definido com `REBASE_ADMIN_EMAIL` abaixo ou atribuído via service key. O `.env.example` do scaffold o define como `true`; o padrão do framework é desativado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Kill switch. Fecha a janela de bootstrap do primeiro usuário que `ALLOW_REGISTRATION=false` deliberadamente mantém aberta fora de produção, bloqueando o registro mesmo em um banco de dados vazio. Combine com `REBASE_ADMIN_EMAIL` abaixo, ou a implantação não terá como produzir seu primeiro chamador autenticado. Todos os artefatos de deploy fornecidos a ativam. | — |
| `REBASE_ADMIN_EMAIL` | E-mail da primeira conta de admin, criada na inicialização **enquanto a tabela de usuários ainda estiver vazia** e nunca posteriormente. É assim que uma implantação em produção obtém seu admin: o operador define a primeira conta em vez de disputar contra a internet. A inicialização avisa quando a tabela está vazia em produção e essa variável não está definida. | — |
| `REBASE_ADMIN_PASSWORD` | Senha para essa conta. Mínimo de 12 caracteres, caso contrário é recusada e a conta não é criada. Altere-a após o primeiro login. | — |
| `MFA_ENCRYPTION_KEY` | Criptografa todos os segredos TOTP armazenados. Se não definida, os segredos são criptografados com `JWT_SECRET` e o boot emite um aviso — portanto, rotacionar `JWT_SECRET` desconectará todos *e* tornará todos os autenticadores cadastrados indecifráveis. Defina uma chave dedicada (32+ caracteres aleatórios) antes que alguém se cadastre. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | A chave da qual se está fazendo a rotação. Defina ambas durante uma rotação: novos segredos são gravados com `MFA_ENCRYPTION_KEY` e os existentes continuam legíveis, para que ninguém seja bloqueado de sua própria conta durante o processo. Remova-a após todos os segredos terem sido recriptografados. | — |
| `ALLOW_ANONYMOUS` | Habilita o login anônimo (`POST /api/auth/anonymous`). Opcional (opt-in) e deliberadamente não condicionado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticação para a API de dados. Defina como `false` para uma superfície de leitura totalmente pública — o RLS ainda se aplica. | `true` |
| `AUTH_DEFAULT_ROLE` | Role atribuída a um usuário recém-registrado quando nenhuma é fornecida. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta `POST /api/auth/find-user`, que resolve um e-mail em um perfil público mínimo (`uid`, `displayName`, `photoURL`) para fluxos de convite por e-mail. Apenas para chamadores autenticados, e nunca retorna o e-mail, roles ou metadados do usuário encontrado. Desativado por padrão: trata-se de uma superfície de enumeração. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` no cookie de atualização: `Strict`, `Lax` ou `None`. `None` requer HTTPS e serve apenas para um frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` no cookie de atualização. Seguro por padrão; `AUTH_COOKIE_SECURE=false` para http puro — uma implantação em endereço de LAN onde o navegador descartaria o cookie e a sessão morreria na expiração do access token sem erros. Emite aviso na inicialização. `http://localhost` não necessita disso. | `true` |
| `GOOGLE_CLIENT_ID` | Client ID do Google OAuth (validação no backend) | — |
| `GOOGLE_CLIENT_SECRET` | Client secret do Google OAuth | — |
| `GITHUB_CLIENT_ID` | Client ID do GitHub OAuth | — |
| `GITHUB_CLIENT_SECRET` | Client secret do GitHub OAuth | — |
| `MICROSOFT_CLIENT_ID` | Client ID da Microsoft OAuth | — |
| `MICROSOFT_CLIENT_SECRET` | Client secret da Microsoft OAuth | — |
| `LINKEDIN_CLIENT_ID` | Client ID do LinkedIn OAuth | — |
| `LINKEDIN_CLIENT_SECRET` | Client secret do LinkedIn OAuth | — |
| `FACEBOOK_CLIENT_ID` | Client ID do Facebook OAuth | — |
| `FACEBOOK_CLIENT_SECRET` | Client secret do Facebook OAuth | — |
| `TWITTER_CLIENT_ID` | Client ID do X/Twitter OAuth | — |
| `TWITTER_CLIENT_SECRET` | Client secret do X/Twitter OAuth | — |
| `DISCORD_CLIENT_ID` | Client ID do Discord OAuth | — |
| `DISCORD_CLIENT_SECRET` | Client secret do Discord OAuth | — |
| `GITLAB_CLIENT_ID` | Client ID do GitLab OAuth. O `baseUrl` de uma instância auto-hospedada não possui configuração por variável de ambiente — configure o GitLab no bloco `auth` para isso. | — |
| `GITLAB_CLIENT_SECRET` | Client secret do GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Client ID do Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret do Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Client ID do Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client secret do Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Client ID do Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret do Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID da Apple, para login via web. É público e publicado em `GET /auth/config`. A Apple não possui um client secret estático, pois o Rebase assina um JWT ES256 de curta duração para cada troca de token. Portanto, a Apple precisa de `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, além deste ou de `APPLE_BUNDLE_IDS`, não configurando nada sem eles. | — |
| `APPLE_BUNDLE_IDS` | IDs de bundle separados por vírgula dos aplicativos nativos para iOS/macOS cujos códigos do Sign in with Apple são aceitos. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, o emissor (issuer) do JWT. | — |
| `APPLE_KEY_ID` | Key ID da chave privada registrada na Apple. | — |
| `APPLE_PRIVATE_KEY` | Conteúdo do arquivo de chave privada `.p8`, com quebras de linha e tudo (escapes `\n` são aceitos). | — |
| `REBASE_SERVICE_KEY` | Chave de API estática de administrador. Ignora a autenticação JWT normal para chamadas servidor-a-servidor quando enviada como `Authorization: Bearer <key>`. (Gerada automaticamente em desenvolvimento). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | A chave pública da plataforma de hospedagem (PEM, EC P-256) contra a qual os tokens de plataforma `rpt_` são verificados; vários blocos PEM durante uma rotação de chave. A plataforma a define no deploy e ela não contém nada secreto. Juntamente com `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que a validação de admin aceite um token de plataforma para `cron:read` e para nada mais. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | O ID do projeto ao qual o `aud` de um token de plataforma deve ser igual, para que um token emitido para outro projeto seja recusado. Com apenas uma das duas variáveis configurada, o servidor inicializa, registra um aviso e responde a qualquer token `rpt_` com `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Para onde vai o **Continue with Rebase Cloud** do painel administrativo: a página do projeto no console da plataforma, que autentica os proprietários do projeto e retorna. A plataforma a define no deploy junto com as duas acima; com elas, `POST /api/auth/platform-signin` aceita o token `auth:admin-signin` de um minuto da plataforma e abre uma sessão de admin. Sem ela, o acesso ainda funciona via **Open CMS** do console, e a tela de login apenas explica isso. | — |
| `REBASE_RATE_LIMIT_STORE` | Onde residem os contadores de rate limit, para as rotas de auth e para `rateLimit` em funções customizadas: `memory` (por processo) ou `sql` (compartilhado entre réplicas). Um processo não pode ver sua própria contagem de réplicas, portanto uma implantação com réplicas deve explicitar isso — três réplicas no padrão impõem três vezes o limite. Qualquer outro valor **recusa a inicialização** em vez de aplicar fallback, incluindo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monta o fluxo de link de login sem senha (magic link). Requer um serviço de e-mail configurado, caso contrário o link não tem para onde ir. | `false` |
| `AUTH_EMAIL_OTP` | Monta o login sem senha com um código de seis dígitos enviado por e-mail. Mesma exigência de e-mail acima. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Cadastro sem senha: uma solicitação de magic link ou código por e-mail para um endereço desconhecido cria a conta, enquanto o registro estiver aberto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | O que faz um refresh token reutilizado após sua janela de reuso: `reject` (recusa-o, mantendo a sessão) ou `revoke-session` (encerra o login). Qualquer outro valor falha a inicialização. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro com confirmação prévia: nenhum login por senha até que o endereço seja verificado. Requer e-mail; a inicialização é recusada sem isso. | `false` |
| `CAPTCHA_PROVIDER` | Ativa a verificação de captcha nas rotas de autenticação: `turnstile` ou `hcaptcha`. Não definido significa sem captcha. | — |
| `CAPTCHA_SECRET` | O segredo do provedor, usado no lado do servidor para verificar o token enviado pelo navegador. Obrigatório assim que `CAPTCHA_PROVIDER` for definido. | — |
| `CAPTCHA_ROUTES` | Rotas de autenticação separadas por vírgula a serem protegidas (por exemplo, `register,login`). Não definido protege o conjunto padrão do provedor. | — |

### Storage

:::caution[O Storage não possui segurança em nível de linha, portanto precisa de um modelo de acesso]
As tabelas são protegidas pelo RLS do Postgres. O armazenamento de objetos não tem equivalente —
as chaves compartilham um único namespace simples —, portanto, com um bucket configurado e nenhum modelo de acesso,
o servidor **recusa a inicialização em produção**. Satisfaça essa exigência com exatamente um dos seguintes:
um hook `storageAuthorize` exportado de `backend/storage.ts` (o que vem por padrão no scaffold),
`STORAGE_POLICIES`, `STORAGE_PUBLIC_READ` ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend de storage: `local`, `s3`, `gcs` ou `platform` (arquivos em um prefixo pertencente à plataforma de hospedagem, transferidos por URLs assinadas pelo seu broker de storage; definido pela plataforma). Em produção, `local` desativa o storage a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Caminho base para o storage local. Um caminho relativo é lido a partir do diretório em que o servidor é executado: a raiz do projeto em `rebase dev`, `backend/` em um servidor gerado por `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite storage local em produção — apenas com um volume persistente contendo `STORAGE_PATH` e os diretórios `<STORAGE_PATH>__<key>` dos buckets locais nomeados ao lado dele | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante os quais a URL de download de um arquivo privado é válida — o token incluído por `getSignedUrl()`. No máximo `604800` (uma semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Maior arquivo que a fonte aceita, em bytes, em qualquer caminho de upload — `__<KEY>` para uma fonte nomeada. Um valor que não seja um número inteiro de bytes recusa a inicialização | `52428800` (50 MB) |
| `S3_BUCKET` | Nome do bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Região da AWS | — |
| `S3_ACCESS_KEY_ID` | Chave de acesso da AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chave secreta da AWS | — |
| `S3_ENDPOINT` | Endpoint S3 customizado (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Força URLs no estilo de caminho para o bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome do bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projeto do GCP. Geralmente inferido das credenciais. | — |
| `GCS_KEY_FILENAME` | Caminho para o arquivo de chave da service-account. Omita no GCP, onde o Workload Identity fornece credenciais. | — |
| `STORAGE_PUBLIC_READ` | Serve todos os objetos para qualquer pessoa, sem token. Apenas para um bucket que seja genuinamente uma CDN pública. Uma das maneiras de atender à validação de inicialização acima. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite que qualquer chamador autenticado leia, grave, liste e exclua todos os objetos. Nomeado como `INSECURE` no objeto de configuração por um motivo: só é defensável em uma aplicação single-tenant onde todas as contas têm acesso confiável a todos os arquivos. | `false` |
| `STORAGE_POLICIES` | Regras de acesso ao storage em JSON: `[{ "path", "operations"?, "allow" }]`, onde `allow` pode ser `"public"`, `"authenticated"`, `"owner"` ou `{ "roles": [...] }`. Negação por padrão e atende à validação de inicialização. Uma lista inválida recusa a inicialização. Consulte [Autorização de storage](/docs/backend/storage-authorization/#as-data-storage_policies). | — |
| `STORAGE_BROKER_URL` | O broker de storage da plataforma, para `STORAGE_TYPE=platform`. Definido pela plataforma que executa o broker. | — |
| `STORAGE_BROKER_PROJECT` | O ID do projeto ao qual o broker delimita os arquivos desta implantação, para `STORAGE_TYPE=platform`. Definido pela plataforma. | — |
| `STORAGE_RENDITION_CACHE` | Armazena em cache as renderizações de imagens geradas (redimensionamentos, conversões de formato) em vez de gerá-las a cada requisição. | `false` |

### E-mail (Opcional)
`MAGIC_LINK_URL`.

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
| `EMAIL_LOGO_URL` | Logotipo exibido no topo dos modelos de e-mail padrão. PNG ou JPG com `http(s)` absoluto — os clientes removem SVG e bloqueiam URIs `data:`. Se não definido, um app ainda chamado `Rebase` recebe a marca do Rebase e um renomeado não recebe nenhum |
| `MAGIC_LINK_URL` | Para onde um magic link enviado por e-mail aponta. Uma base recebe `/auth/magic-link?token=…` anexado; uma URL contendo `{token}` representa o link inteiro, para um frontend que não serve `/auth/magic-link`. Coloque entre aspas no `.env`, onde um `#` sem aspas inicia um comentário: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Um valor com hash ou caminho de arquivo e sem `{token}` gera um aviso na inicialização. Se não definido, a base é `FRONTEND_URL` |

### Pool de conexões com o banco de dados

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `DB_POOL_MAX` | Máximo de conexões no pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milissegundos em que uma conexão ociosa é mantida | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milissegundos de espera por uma conexão | `10000` |
| `DATABASE_DIRECT_URL` | Conexão direta (sem pool). O [Realtime](/docs/backend/realtime) precisa de uma: `LISTEN`/`NOTIFY` não sobrevive a um pooler em modo de transação como o PgBouncer, e sem ela as notificações de alteração são desativadas com um aviso em vez de serem perdidas silenciosamente. O [job worker](/docs/backend/jobs) também mantém seu `LISTEN` de ativação nela. Preenche o `directConnectionString` do adaptador Postgres quando não estiver definido. | — |
| `DATABASE_READ_URL` | Réplica de leitura, como um hot standby. Quando especifica outro servidor, leituras autenticadas (listagens, linhas individuais, contagens, agregações) são atendidas lá sob o mesmo row-level security; gravações, login, realtime, crons, jobs, o console SQL e `rebase.sql` permanecem no primário. Um leitor que acabou de gravar lê do primário durante `REBASE_READ_STICKY_MS`, e todos leem do primário enquanto a réplica estiver com atraso superior a `REBASE_READ_MAX_LAG_MS` ou com falha. Preenche o `readConnectionString` do adaptador Postgres quando não definido; até a versão 0.28 (inclusive), o pool da réplica era aberto e nunca lido. | — |
| `REBASE_READ_STICKY_MS` | Após uma gravação, por quanto tempo as leituras do mesmo usuário vão para o nó primário, garantindo que salvar e depois listar exiba o que foi salvo. Por instância de servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Limite de defasagem (lag) da réplica a partir do qual todas as leituras vão para o primário. | `1000` |
| `DATABASE_POOLED` | `true` quando `DATABASE_URL` passa por um pooler em modo de transação como o PgBouncer. O pool então não envia `search_path` ou `statement_timeout` na conexão (o pooler os recusaria ou descartaria) e define ambos em cada transação; a inicialização define para a role do banco um `search_path` padrão de `public` para instruções fora de uma transação. `DATABASE_DIRECT_URL` passa a ser obrigatória, e realtime, ativação do job worker, criação de índices, branching e o console SQL passam a usá-la. A URL da réplica também é considerada sob pool. `DATABASE_POOLED__<KEY>` para outra fonte de dados. | — |
| `REBASE_DB_POOL_MAX` | Um teto para todos os pools do processo, aplicado independentemente do solicitado por cada um. Apenas dígitos puros: um valor malformado é ignorado em vez de serializar o servidor silenciosamente. | — |

### Comportamento do runtime

Lido pelo runtime — `rebase dev`, `rebase start` e a imagem de servidor
publicada. Um projeto que executou o eject gerencia essas decisões diretamente em seu próprio código.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` executa a auditoria agendada de [row-level security](/docs/rls-check#running-it-on-a-schedule), que relata tabelas servidas sem políticas. O projeto deve declarar `@rebasepro/rls-check` entre suas dependências: o runtime não inclui nenhuma cópia e, sem o pacote, a inicialização é recusada, informando o nome dele. `false` mantém a varredura desativada neste processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | A role do Postgres sob a qual as requisições autenticadas e anônimas são executadas. Dê a cada projeto em um cluster compartilhado a sua própria role. Um banco de dados registra a role na qual executa, e uma inicialização configurada para outra se recusa a iniciar até que `rebase db request-role migrate` a transfira. Consulte [Executando em um banco de dados existente ou compartilhado](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` cria a request role e permite que a conexão alterne para ela; `never` deixa ambas a seu encargo e apenas as verifica. | `auto` |
| `REBASE_RLS_GRANTS` | O que o Rebase concede à request role: `schema` (todas as tabelas nos schemas que atende, além dos privilégios padrão), `managed` (apenas as tabelas que atende) ou `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe as políticas permissivas do Rebase à(s) request role(s), de modo que outras roles lendo as mesmas tabelas não recebam nada delas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` grava as políticas que apenas o contexto do servidor ou um administrador podem passar `TO public`, e executa administradores como a request role. Por padrão, elas são `TO rebase_admin`, para que leituras com escopo de proprietário feitas por usuários autenticados possam usar o índice de proprietário. Consulte [Requisições administrativas e `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` remove a política de base do servidor ou administrador de todas as tabelas. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` também define `request.jwt.claims` e `request.jwt.claim.*`, para que políticas escritas com `auth.uid()` identifiquem o chamador. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | O que a inicialização faz quando outro login pode alternar para a request role: `warn`, `refuse` ou `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Caminho base para todas as rotas de API. O cliente deve ser configurado com o mesmo valor — consulte [Alterando `basePath`](#alterando-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve os assets estáticos/admin do bundle a partir deste processo. Desative quando houver uma CDN à frente. | `true` |
| `REBASE_STUDIO` | Serve o console standalone integrado do Rebase Studio em `/_studio` quando um bundle estático do Studio estiver disponível. Defina como `false` para desativar. | `true` |
| `REBASE_STUDIO_DIR` | Diretório contendo a SPA standalone pré-compilada do Rebase Studio servida em `/_studio`. O padrão é `/studio` na imagem do container. | `/studio` |
| `REBASE_HISTORY` | Registra o [histórico de alterações de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respostas com gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` ativa as [notificações push](/docs/backend/push-notifications/): as rotas `/api/push`, a tabela `rebase.push_subscriptions` e `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | O par de chaves VAPID com o qual as mensagens push são assinadas. Fora de produção, um par é gerado e mantido em `.rebase-dev-secrets.json` quando não definido; em produção, o push permanece desativado sem elas. | — |
| `REBASE_VAPID_SUBJECT` | Um endereço `mailto:` ou URL `https://` que os serviços de push podem contatar. O padrão é a origem de uma `REBASE_PUBLIC_URL` em `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Corpo máximo da requisição, **em bytes** (`10485760`, não `10MB` — um valor que não seja um número recusa a inicialização em vez de remover silenciosamente o limite). `0` desativa o limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | A superfície OpenAPI. Tri-estado. Quando não definido, em qualquer ambiente: `/api/docs` é servido aos chamadores para os quais `GET /api/schema/tables` descreve tabelas, cada um recebendo o documento das tabelas descritas para si, e não há UI do Swagger. `true` publica todo o documento para todos, com a **UI** do Swagger em `/api/swagger` fora de produção (nunca em produção). `false` mantém o documento protegido pelo gate de admin. | — |
| `REBASE_METRICS` | Expõe métricas do Prometheus em `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Adiciona `includeSubDomains` ao cabeçalho `Strict-Transport-Security`, fazendo com que os navegadores recusem HTTP não criptografado em todos os subdomínios do host por seis meses — incluindo hosts não atendidos por este processo. Ative apenas quando todos os subdomínios do domínio forem exclusivos em HTTPS. Qualquer valor diferente de `true`/`false` recusa a inicialização. Consulte [Cabeçalhos de segurança](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token de proteção para `/metrics`. Se não definido, deixa o endpoint aberto para qualquer um que alcance a porta — adequado em uma rede privada, não em uma pública, e os logs de boot alertam sobre isso. | — |
| `REBASE_MIGRATE_ON_BOOT` | O que o runtime pode fazer com o schema das tabelas na inicialização. `ensure` (o padrão em todos os lugares, incluindo produção) executa a passagem **aditiva**: cria tabelas, colunas e tipos enum ausentes, nunca descartando ou reescrevendo nada. `none` mantém intacto o schema das tabelas declaradas, mas as tabelas do próprio framework (auth, API keys, jobs, cron) ainda são criadas e mantidas atualizadas; `REBASE_PROVISION=false` também as desativa. A imagem publicada aceita apenas esses dois e **recusa a inicialização com `push`**. Em um [deploy dividido (split deployment)](/docs/deployment/split-processes), exatamente um processo pode provisionar, portanto todos os outros papéis devem definir `none` ou recusarão a inicialização. | `ensure` |
| `REBASE_PROVISION` | `false` faz com que o runtime não altere nada no banco de dados: nenhuma tabela, coluna, índice, função, trigger, política, role ou grant, na inicialização ou posteriormente, incluindo os do próprio framework. Em vez disso, ele relata o que está ausente por nome. Para um banco de dados que só pode ser alterado pelo seu processo de mudanças. Consulte [Quando apenas seu processo de mudanças pode alterar o banco de dados](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Apenas `true` e `false` são aceitos. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Recusa a inicialização quando o banco de dados foi provisionado pela última vez a partir de um conjunto de tabelas diferente daquele para o qual este processo foi compilado. Não definido (ou qualquer valor diferente de `true`/`1`) apenas emite um aviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Recusa a inicialização quando um arquivo de função ou cron lança um erro ou falha no parse durante a importação, nomeando cada arquivo e o motivo, para que um deploy rolling mantenha a versão antiga em execução. Uma reinicialização também é submetida a isso. Não definido (ou qualquer valor diferente de `true`) ignora o arquivo e atende o restante. Um arquivo importado sem erros que não exporta nenhuma função ou job é sempre ignorado, e não recusado. | skip |
| `REALTIME_CDC` | Captura de alterações no nível do banco de dados: `auto` (lê alterações do WAL quando o banco permitir, senão usa triggers, senão faz fallback para o nível de aplicação, registrando cada fallback como info), `trigger` (força o uso de triggers, avisa se impossível), `wal` (lê alterações do write-ahead log em vez de triggers; requer `wal_level=logical` e uma role que possa replicar, caso contrário faz fallback para `trigger`), `off`. Consulte [Realtime](/docs/backend/realtime-cdc/). Tem precedência sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instâncias para canais de broadcast e presence: `memory` ou `postgres`. Ignorado quando `realtime.bus` recebe um transporte construído. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Quantas inscrições um único socket realtime pode manter; a seguinte é recusada com `TOO_MANY_SUBSCRIPTIONS`. Um número inteiro positivo — qualquer outra coisa interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSubscriptionsPerSocket`. Consulte [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Quantos sockets realtime um usuário, ou uma chave de API, pode manter abertos em uma instância de servidor. Sockets de impersonação de um administrador contam contra o administrador. O próximo login é recusado com `TOO_MANY_SOCKETS` e o socket é fechado (4002); o SDK continua tentando novamente, conectando-se quando outro for fechado. Um número inteiro positivo — qualquer outra coisa interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSocketsPerUser`. | Sem teto |
| `REALTIME_REFETCH_MAX_WAIT_MS` | O tempo máximo em ms que uma alteração aguarda pela nova busca (refetch) que a entrega aos inscritos ativos. Um refetch aguarda 300 ms sem alterações, e no máximo esse intervalo sob um fluxo contínuo de gravações. Um número inteiro positivo — qualquer outra coisa interrompe o servidor na inicialização. Tem precedência sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Quanto tempo o total de uma inscrição de lista grande pode ser reutilizado antes de ser contado novamente, em ms; frames que o reutilizam contêm `meta.totalAsOf`. Se não definido, cada frame realiza a contagem. Tem precedência sobre `realtime.recountIntervalMs`. | Não definido |
| `REALTIME_RECOUNT_MIN_ROWS` | O menor total anterior ao qual `REALTIME_RECOUNT_INTERVAL_MS` se aplica; listas menores são contadas em cada frame. Tem precedência sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost`/loopback sob `NODE_ENV=production`. Desativado por padrão, para que uma inicialização em produção falhe explicitamente em vez de conectar-se a um banco de dados que não está lá. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` executa a etapa de schema e sai sem abrir um socket — o formato exigido por um Job de migração, a partir da mesma imagem e do mesmo bundle que o servidor que o sucede. Também cria as tabelas que um processo de atendimento criaria no primeiro uso, e não inicia nenhum cron ou fila de jobs. Um valor vazio é considerado *não definido*, para que um `${SOMETHING}` não substituído em um arquivo compose não transforme uma implantação comum em uma que apenas migra e se recusa a atender. Recusado juntamente com `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Um caminho de arquivo. Uma execução de provisionamento (`REBASE_PROVISION_ONLY=true`) grava nela todas as alterações de schema realizadas, em ordem, como um script SQL para revisão e aplicação com `psql`. As linhas gravadas não são incluídas. Recusado em um processo que atende requisições. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que uma máquina — um agente, um job de CI — *aplique* uma alteração de schema via `/api/admin/schema`, não apenas a planeje. Desativado a menos que solicitado: a credencial que realizaria tal alteração é a mais propensa a estar em uma variável de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Por quanto tempo uma função customizada pode ser executada antes que sua requisição seja abortada. O mesmo ajuste que a opção `functionsTimeoutMs`. `0` desativa o tempo limite. Uma função que declare o seu próprio (`defineFunction(…, { timeoutMs })`) usa o valor declarado. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | O timeout mais longo que uma função pode declarar para si mesma com `defineFunction(…, { timeoutMs })`, em ms; uma função que solicite mais recebe esse limite. Um número positivo; qualquer outra coisa é interpretada como não definida. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` faz com que uma rejeição de promise não tratada encerre o processo em vez de registrá-la em log. Ativado sob um orquestrador que reiniciará o container; desativado onde uma reinicialização for pior que um vazamento. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silencia o aviso de inicialização em uma plataforma que o runtime detecta como scale-to-zero, onde um timer que dispara em uma instância ociosa não dispara em nenhuma instância. Não altera nada mais: defina quando mantiver pelo menos uma instância em execução. | — |
| `TRUSTED_PROXY_HOPS` | Quantos proxies estão à frente deste servidor, permitindo que o rate limiter leia o endereço IP real do cliente a partir de `X-Forwarded-For`. Padrão de segurança `0`: sem proxy, confiar no cabeçalho permitiria a qualquer chamador forjar uma identidade. | `0` |

:::note[O provisionamento de boot é aditivo e não é uma ferramenta de migração]
A etapa de inicialização é executada de forma autônoma sem ninguém inspecionando um diff, portanto nunca removerá uma coluna, restringirá um tipo ou reescreverá uma tabela. É também por isso que a imagem recusa `REBASE_MIGRATE_ON_BOOT=push`: um push completo calcula um diff e executará com prazer `DROP COLUMN`, e o reinício de um container nunca deve ser capaz de destruir uma coluna de produção como efeito colateral de um reagendamento.

Alterações destrutivas ou de reformulação permanecem onde possam ser revisadas: `rebase db generate` + `rebase db migrate`, ou `rebase db push` a partir de um checkout ou CI, que executa um dry-run da alteração, recusa alterações destrutivas sem confirmação e pode realizar um backup antes.
:::

### Implantações divididas (Split deployments)

Uma imagem e um bundle podem ser inicializados várias vezes, cada um atendendo a uma
parte diferente do projeto. Aqui há apenas uma linha para cada, já que esta página se
propõe a listar todas as variáveis; o que cada combinação *monta e gerencia* — e quais
combinações recusam a inicialização — está em
**[Processos Divididos](/docs/deployment/split-processes)**.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_ROLE` | Qual parte este processo atende: `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescreve se *este* processo executa os timers de cron. Não definido segue a role. | — |
| `REBASE_JOB_WORKERS` | Sobrescreve se este processo executa workers de fila de jobs. Não definido segue a role. | — |
| `REBASE_FUNCTIONS_ONLY` | Atende apenas as funções customizadas especificadas neste processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Atende todas as funções customizadas, exceto as especificadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Para onde o processo de API encaminha uma requisição de função que ele próprio não atende. Em um `worker`, para onde vão suas próprias chamadas `rebase.functions`. Uma URL `http(s)`. | — |

### Superfície MCP

Um endpoint opcional de Model Context Protocol em `/mcp`, permitindo que um cliente de IA leia
e escreva neste projeto **como o usuário autenticado**. Desativado a menos que configurado e — ao contrário de
qualquer outra superfície — nenhum `REBASE_ROLE` o ativa: os outros descrevem o
perfil de um processo, enquanto este representa a decisão de entregar credenciais a software de
terceiros, devendo ser tomada por uma pessoa em vez de herdada da função de um
container.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Monta a superfície MCP. Requer `REBASE_PUBLIC_URL`; sem ela, a superfície recusa a montagem e informa isso no log de inicialização. | `false` |
| `REBASE_PUBLIC_URL` | A origem externamente acessível desta implantação, por exemplo `https://app.example.com`. A superfície MCP não pode deduzi-la — obter a origem do cabeçalho `Host` tornaria a identidade do emissor, e a audiência contra a qual seus próprios tokens são validados, um valor fornecido pelo chamador. | — |
| `REBASE_MCP_VIEW` | Caminho para a visualização do próprio aplicativo MCP do projeto (`rebase-view.html`, gravado por `rebaseMcpViewPlugin()`), servido ao Claude em vez da visualização genérica, para que suas visualizações customizadas, campos e ações sejam o que ele renderiza. Sem ele, o backend procura ao lado do frontend que atende. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite o registro dinâmico de clientes OAuth (RFC 7591), para que um cliente possa se registrar sozinho. Defina como `false` para exigir que os clientes sejam registrados previamente. | `true` |

### Edição dinâmica de schema a partir de um bundle

Desativado a menos que `REBASE_LIVE_SCHEMA_REPOSITORY` esteja definido. Um bundle compilado não possui o
código-fonte de `backend/schema` para editar; portanto, com essas variáveis definidas, o editor de schema lê
o código-fonte do repositório, faz o commit de cada alteração de volta e executa o DDL correspondente
neste banco de dados. Exclusivo para administradores e aplicado por uma pessoa, a menos que
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` determine o contrário. Um repositório especificado sem
credenciais válidas recusa a inicialização. Consulte
[Edição dinâmica de schema](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | O repositório do GitHub no qual os commits de alterações de schema serão feitos, como `owner/name`. Defini-lo é o que ativa o recurso. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | A branch na qual o commit é aplicado. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Onde `backend/schema` reside nesse repositório, relativo à raiz do repositório. Um caminho que saia do repositório recusa a inicialização, assim como a variável removida `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Um token granular (fine-grained) com acesso de leitura e gravação ao conteúdo do repositório. Defina este ou as três variáveis `_GITHUB_APP_*`, não ambos. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | O ID de um GitHub App, para realizar commits como o aplicativo em vez de usar um token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | A instalação do app no repositório. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | A chave privada do app: PEM, PEM com quebras de linha escapadas ou base64. | — |

### Backups

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Expressão cron para backups agendados. Não definido significa que backups agendados estão desativados. | — |
| `BACKUP_DESTINATION` | Caminho local ou uma URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obrigatório com `BACKUP_SCHEDULE`, que se recusa a rodar sem ele. `rebase db backup` usa por padrão `./backups` no diretório onde foi executado. | — |
| `BACKUP_RETENTION_DAYS` | Exclui backups com mais de N dias. Não definido ou `0` mantém tudo. | — |
| `BACKUP_KEEP_MINIMUM` | Sempre retém pelo menos N dos backups mais recentes, independentemente da política de retenção. | — |
| `PG_DUMP_PATH` | Sobrescreve o binário do `pg_dump` — deve ser da versão principal do servidor ou mais recente. | — |
| `PG_RESTORE_PATH` | Sobrescreve o binário do `pg_restore`. | — |
| `PSQL_PATH` | Sobrescreve o binário do `psql` executado por `rebase db restore --clean` para fazer a restauração em uma única transação. | — |
| `PG_DUMPALL_PATH` | Onde o `pg_dumpall` reside, quando não estiver no `PATH`. Sem ele — e sem as ferramentas de cliente do PostgreSQL instaladas —, um backup de variáveis globais falha com um erro indicando esta variável. | — |

A imagem oficial do runtime (`rebasepro/server`) inclui as ferramentas de cliente
do PostgreSQL 18, portanto um backup agendado é executado nela contra qualquer servidor até o Postgres 18.
Fora da imagem, instale-as você mesmo (`apt-get install postgresql-client-18`,
`brew install libpq`).

Os backups contêm segredos e dados pessoais identificáveis (PII). Use um destino privado com
criptografia em repouso.

### Entrega de bundles

Uma implantação gerenciada não carrega seu código na imagem: o runtime busca um
bundle na inicialização. Estas variáveis decidem qual deles e como.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Caminho para um diretório de bundle já extraído. O que o `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | De onde buscar o arquivo de bundle, quando não houver um local. | — |
| `REBASE_BUNDLE_TOKEN` | A credencial bearer para essa busca. Trate-a como um segredo: é o que autoriza um tenant a baixar seu próprio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Onde um bundle buscado é extraído. Deve ser gravável e persistir entre a busca e a inicialização. | — |
| `REBASE_RUNTIME_MODULES` | Módulos extras que a imagem de runtime fornece ao bundle, além dos que ele próprio declara. | — |

### Vinculações de recursos

Todo banco de dados, bucket e tópico declarado por um projeto em `backend/resources.ts` é
vinculado por variáveis de ambiente nomeadas em sua homenagem. Os nomes base estão abaixo; um
recurso não padrão anexa `__` e sua chave em letras maiúsculas, de modo que um bucket chamado
`media` lê `S3_BUCKET__MEDIA`. O comando `rebase status`
exibe, para cada recurso,
a variável exata que está sendo lida e se ela está configurada.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_DRIVER` | O pacote npm que implementa o driver de uma fonte de dados, quando não for o driver padrão do Postgres. Sufixado por fonte: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | A string de conexão para um tópico declarado. Sufixada por tópico. | — |

### Ambiente próprio da CLI

Lido pelo `rebase`, não pelo servidor. Nada aqui afeta uma implantação.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Para onde `rebase api-keys`, `rebase storage` e `rebase auth reset-password` enviam a service key, no shell ou em `.env`. Defina quando o servidor rodar de outra forma que não seja `rebase dev` neste projeto: `rebase start`, um container, outro host. Se não definido, eles usam o servidor registrado pelo `rebase dev` enquanto esse servidor estiver rodando, e não enviam nada quando não estiver. | — |
| `REBASE_SERVICE_KEY` | A service key com a qual esses comandos se autenticam, lida do `.env`: a mesma variável que o servidor lê (veja acima). | — |
| `SERVICE_KEY` | Um nome mais antigo para essa chave. Quando o `.env` a define, `rebase api-keys` e `rebase storage` a leem no lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qual `.env` a CLI lê e grava, quando não for o do projeto. | — |
| `REBASE_ROOT_RULES` | `0` impede que `rebase init` e `rebase skills install` escrevam as regras do projeto nos arquivos `CLAUDE.md` e `AGENTS.md` na raiz do repositório, para uma raiz cujos arquivos de agentes você gerencia manualmente. | on |
| `REBASE_CLOUD_URL` | O control plane com o qual o `rebase cloud` se comunica. | — |
| `REBASE_CLOUD_EMAIL` | A conta na qual o `rebase cloud login` faz login, em vez de solicitar interativamente. | — |
| `REBASE_CLOUD_PASSWORD` | Sua senha, para que um cofre de segredos possa fornecê-la sem que chegue ao histórico do shell. | — |
| `REBASE_TOKEN` | Um token de `rebase cloud tokens create`. Quando definido, todos os comandos `rebase cloud` se autenticam com ele em vez da sessão de `rebase cloud login`, e nunca leem ou gravam a sessão armazenada. Em um diretório vinculado por `rebase cloud init --claim`, ele é reservado para o próprio token daquele projeto quando não possuir escopo no projeto. A forma de executar `rebase cloud` no CI — consulte [CI e agentes](/docs/deployment/cloud/#ci-and-agents). O [servidor MCP](/docs/ai/mcp/) o repassa para a CLI gerada por suas ferramentas na nuvem, e nunca o envia para o app: defina `REBASE_API_TOKEN` para isso. | — |
| `REBASE_DEBUG` | `1` imprime o erro subjacente e os detalhes da requisição em vez da mensagem curta. A primeira coisa a definir quando um comando `rebase cloud` falhar sem detalhes úteis. | — |
| `REBASE_ATLAS_DEV_URL` | O banco de dados vazio contra o qual `rebase db push`, `db generate` e `db migrate` fazem o planejamento, em vez do `<db>_dev_diff` criado ao lado de `DATABASE_URL`. O Rebase não cria nem exclui um banco de dados aqui indicado, e recusa um que seja igual a `DATABASE_URL`. No banco de dados de desenvolvimento gerenciado, a CLI o define para um PGlite temporário em memória próprio. Defina onde `CREATE DATABASE` não for concedido. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | O `rebase dev` não inicializa nenhum banco de dados e não provisiona nada — você fornece o seu próprio. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixa a porta do servidor de desenvolvimento do frontend, que caso contrário o `rebase dev` deduz a partir do caminho do projeto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Quanto tempo o `rebase dev` aguarda o backend se anunciar antes de indicar que não inicializou. `0` desativa o relatório. | `30000` |
| `DATABASE_PASSWORD` | A senha que `rebase dev --docker` coloca na string de conexão deduzida de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convenção entre ferramentas. Defina com qualquer valor diferente de `0` e a CLI não enviará telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | O mesmo, especificamente para o Rebase. Não necessita de arquivo, sendo o recomendado para uso em CI e em imagens. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Para onde a telemetria é enviada, no caso de um coletor auto-hospedado. | — |
| `REBASE_NO_UPDATE_CHECK` | `1` impede que a CLI consulte o registro do npm (ou `npm_config_registry`), uma vez ao dia em segundo plano, para obter as dist-tags de `@rebasepro/cli`, e oculta a linha "Rebase X is out; this CLI is Y" com a qual todos os comandos exceto `rebase upgrade` terminam no stderr. A resposta é mantida em `~/.rebase/release-check.json`, e a requisição não envia nada além disso. Já desativado em CI; `NO_UPDATE_NOTIFIER` faz o mesmo. | — |
| `REBASE_RELEASE_NOTICE_SHOWN` | Definido pela CLI para os processos que ela inicia, para que um comando que execute a CLI novamente imprima a linha "Rebase X is out" apenas uma vez. Defini-lo manualmente oculta a linha para esse processo, assim como `REBASE_NO_UPDATE_CHECK` faz. | — |

## Segredos em desenvolvimento

`JWT_SECRET` é obrigatório em produção. Ele e `REBASE_SERVICE_KEY` são
gerados para você fora dela, para que você possa começar sem precisar configurar nada.

Esses valores gerados ficam em cache em `.rebase-dev-secrets.json`, ao lado de
`.rebase-dev-port` e `.rebase-dev-url`, e ignorados no git junto com eles. Anteriormente, eles
eram gerados novamente a cada inicialização — fazendo com que reiniciar o servidor de desenvolvimento desconectasse você
do seu próprio app e invalidasse qualquer chave de API recém-criada.

- Defina qualquer uma das variáveis explicitamente e a sua será usada; nada é armazenado em cache ou lido.
- Aponte o cache para outro local com `REBASE_DEV_SECRETS_FILE` — um caminho, e a
  única variável nesta seção que você definiria deliberadamente.
- Exclua o arquivo para rotacionar ambos os segredos. A próxima inicialização gravará um novo.
- Se o arquivo não puder ser gravado — como em um container somente leitura —, o servidor inicializará
  de qualquer maneira com um segredo efêmero, exatamente como fazia antes.

Nada é armazenado em cache em produção ou sob um executor de testes. Em produção, nada
é gerado automaticamente: uma inicialização sem `JWT_SECRET` falha, indicando o nome da variável, e
isso permanece inalterado:

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
sem `app`, `server` e `basePath` e com um `provision` obrigatório, constroem um
backend que não serve nada até você montá-lo: `createRebaseBackend`. Consulte
[Integração de Servidor Customizado](/docs/backend/custom-server/).

### Alterando `basePath`

O `basePath` move todas as rotas da API, portanto o cliente deve ser informado da mesma alteração —
caso contrário, continuará requisitando `/api/...` e receberá 404 para tudo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

O painel administrativo obtém isso do cliente fornecido a ele; nada mais precisa ser
configurado. Se você construir uma URL de requisição manualmente, concatene-a a partir do cliente em
vez de escrever `/api` você mesmo:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solução de Problemas

### Permissão Negada no SQL Editor (`permission denied for table <name>`)

* **Sintomas:** Queries customizadas executadas no editor SQL do Rebase Studio falham com `cause: error: permission denied for table <name>`, mesmo que a visualização de planilha do CMS carregue os dados com sucesso.
* **Causa:** Por padrão, o Rebase tenta executar queries do SQL Editor alternando temporariamente as roles do banco de dados para corresponder à role da aplicação do usuário ativo (por exemplo, `SET LOCAL ROLE "admin"`). Se você estiver usando autenticação personalizada onde as roles existem apenas em tabelas do banco de dados em vez de roles reais do PostgreSQL, a alternância de role falha ou os privilégios do banco de dados ficam ausentes. A visualização em planilha do CMS executa sob o usuário proprietário da conexão padrão e ignora isso.
* **Solução:** Adicione `DISABLE_DB_ROLE_SWITCHING=true` à sua configuração `.env` do backend. Isso força o Rebase a executar queries do SQL Editor usando os privilégios do proprietário da conexão (geralmente um superuser/owner). O SQL Editor então indica, acima dos resultados, que eles foram lidos como o proprietário da conexão e desativa seu seletor de roles.

### Falha ao Buscar Schema no SQL Editor (`Cross-database execution requires adminConnectionString`)

* **Sintomas:** O Studio falha ao carregar a árvore de schema, ou o SQL Editor exibe `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
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
