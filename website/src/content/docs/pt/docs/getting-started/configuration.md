---
sourceHash: df5e0441849e5e57
title: Ambiente e Configuração
sidebar_label: Configuração
description: Todas as variáveis de ambiente e opções de configuração para projetos Rebase.
---

## Variáveis de Ambiente

Toda a configuração é feita via variáveis de ambiente no seu arquivo `.env` na raiz do projeto.

> **Importante**: O Rebase valida variáveis de ambiente com o **Zod** na inicialização. Se
> algo obrigatório estiver faltando ou malformado (uma URL que não é uma URL, uma porta que
> não é um número), o servidor se recusa a inicializar e informa o nome da variável.
>
> O local onde o esquema reside depende de como você executa o backend. Um projeto inicializado
> pelo runtime — `rebase dev`, `rebase start`, a imagem publicada — usa o esquema que o
> runtime possui (`loadBootEnv` em `@rebasepro/server`), que é a união de todas as
> tabelas abaixo. Um projeto que executou [`rebase eject`](/docs/cli) possui um
> `backend/src/env.ts` chamando `loadEnv({ extend })` e pode adicionar suas próprias
> variáveis tipadas lá.

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `DATABASE_URL` | String de conexão do PostgreSQL. **Opcional em desenvolvimento** — se não definida, o `rebase dev` executa um PostgreSQL gerenciado para o projeto, com seus dados sob `.rebase/`. Obrigatória em todos os outros ambientes. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chave secreta para assinar tokens JWT. Use uma string aleatória forte (mínimo de 32 caracteres). **Obrigatória em produção** (gerada automaticamente em desenvolvimento). | `a1b2c3d4e5...` |

> **Em um banco de dados gerenciado, `sslmode=require` pode não significar o que diz.**
>
> Para o `psql` e todas as ferramentas libpq, `require` significa "criptografado, certificado
> não verificado". O driver Node no qual o Rebase roda interpreta isso como `verify-full`,
> portanto, um banco de dados cujo certificado não foi assinado por nenhuma autoridade pública —
> comum em Postgres gerenciado — recusa o runtime com `self-signed certificate`, enquanto
> o `psql` conecta com a mesma URL. O runtime e os comandos `rebase db` são interrompidos
> com uma mensagem informando isso.
>
> Escolha uma opção:
>
> - **`sslmode=no-verify`** — criptografado, não verificado: o que `require` significa para
>   a libpq. É uma grafia do node-postgres que a libpq não possui, portanto `psql`, `pg_dump`
>   e Atlas a recusam com `invalid sslmode value: "no-verify"`. Os comandos próprios do Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) passam o valor como
>   `sslmode=require` para essas ferramentas, de modo que funcionam com a URL como configurada;
>   para usar o `psql` manualmente, substitua por `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — verificado contra o certificado
>   da AC do provedor. Igual para todas as ferramentas.
>
> `uselibpqcompat=true&sslmode=require`, sugerido pelo próprio aviso do driver Node,
> também funciona para o runtime; os comandos do Rebase removem `uselibpqcompat`
> antes de passar a URL para ferramentas libpq, que a rejeitariam.

### Frontend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `VITE_API_URL` | URL da API do backend para o SDK tipado. **Defina apenas em desenvolvimento** — veja abaixo. | origem da página |
| `VITE_GOOGLE_CLIENT_ID` | ID de cliente OAuth do Google. Habilita "Sign in with Google". | — |


> **Deixe `VITE_API_URL` indefinida em builds de produção.**
>
> Em desenvolvimento, o frontend e o backend possuem origens separadas, portanto o servidor
> de desenvolvimento injeta isso. Em produção, o backend do Rebase serve a SPA, então a
> API é a própria origem da página e o cliente a resolve dessa forma por conta própria.
>
> Fixar uma URL absoluta em um bundle de produção funciona até o momento em que um segundo
> hostname aponta para a mesma aplicação: um domínio customizado então carrega a página a
> partir de `example.com` e chama a API em `example.rebase.website`, o que é cross-origin,
> fazendo com que cada requisição falhe no preflight. Permitir a origem no CORS também
> **não** resolve — o cookie de atualização é `SameSite=Lax` e não é enviado cross-site,
> então você limparia os erros do console e continuaria com a autenticação quebrada.
> Se não definida, qualquer domínio que aponte para a aplicação funcionará sem nenhuma
> configuração de CORS.

### Backend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta para o servidor HTTP do backend. Lida pelo `rebase start`. O `rebase dev` a lê **apenas do ambiente do shell** — um `PORT` no `.env` não é lido lá, pois a porta é resolvida antes de esse arquivo ser carregado — e, caso contrário, vincula uma porta derivada do caminho do projeto, para que vários projetos possam rodar ao mesmo tempo. `rebase dev --port` tem precedência sobre ambos, e o banner de inicialização informa o nível utilizado. | `3001` |
| `LOG_LEVEL` | Verbosidade dos logs: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Exibe o SQL por trás de uma linha `Failed query: [redacted]`. Cada instrução com falha é ocultada por padrão, pois uma query que falhou carrega seus parâmetros vinculados — um e-mail, um hash de senha. Defina como `true` ao diagnosticar uma falha de DDL, RLS ou captura de alterações. Ignorado quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Lista de origens permitidas separadas por vírgula. **Obrigatória em produção**, a menos que `FRONTEND_URL` esteja definida: uma inicialização em produção sem nenhuma das duas se recusa a iniciar. Em desenvolvimento, ela é *adicionada ao* localhost — veja abaixo. | — |
| `FRONTEND_URL` | URL da aplicação frontend. Usada como alternativa ao CORS_ORIGINS em ambos os ambientes. | — |
| `ADMIN_CONNECTION_STRING` | String de conexão de nível administrativo com o banco de dados (usada para introspecção de esquema e operações administrativas). O banco de dados informado aqui não é aquele que o console SQL considera o atual, nem o que uma nova branch copia por padrão: ambos são o banco de dados no qual a própria conexão do app está (consulte `REBASE_BRANCH_PARENT_DATABASE` para um servidor em uma branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desativa a alternância de roles do PostgreSQL no SQL Editor (útil para autenticação customizada em que as roles do banco não são mapeadas). O console SQL do Studio então informa que as linhas foram lidas como o proprietário da conexão, exibe o nome dele e desabilita o seletor de roles. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | O banco de dados do qual a branch na qual este servidor roda foi copiada. O `rebase dev` o define em um checkout [alternado para uma branch](/docs/backend/branching/#cli-integration). Um servidor com esta variável mantém o registro de branches nesse banco de dados e copia novas branches a partir dele por padrão, de modo que o painel Branches do Studio exibe as branches do banco de dados principal. | — |

#### CORS em desenvolvimento

O ambiente de desenvolvimento permite **localhost mais o que estiver especificado em `CORS_ORIGINS` (ou `FRONTEND_URL`)**
— a mesma lista usada em produção, com o localhost adicionado em vez de substituído.
Portanto, a variável funciona da mesma forma em ambos os ambientes, e os casos que
precisam dela em desenvolvimento são os usuais:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Uma origem que não seja localhost nem esteja listada é recusada, e a recusa é
registrada nos logs **uma vez por origem** com a linha exata que permitiria o acesso.
A recusa não é apenas precaução: a API envia credenciais, portanto refletir um
`Origin` arbitrário permitiria que qualquer site visitado pelo desenvolvedor fizesse
requisições autenticadas contra o servidor de desenvolvimento usando sua sessão e
lesse as respostas.

### Autenticação

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `JWT_SECRET` | Segredo para assinatura de JWT (obrigatório em produção, gerado automaticamente em desenvolvimento) | — |
| `JWT_PRIVATE_KEY` | Chave privada PEM para assinar tokens de acesso assimetricamente (RS256), para que qualquer serviço com o JWKS possa verificar uma sessão sem conseguir emitir tokens. Aceita um PEM com quebras de linha reais, um PEM com escapes `\n` ou base64 do PEM completo. Sem ela, os tokens permanecem em HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` no cabeçalho do token e no JWKS. Altere-o sempre que a chave mudar — a rotação depende de a chave antiga e a nova serem distinguíveis. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tempo de vida do token de acesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tempo de vida do token de atualização (refresh token). Janela deslizante — cada rotação o renova, determinando quanto tempo uma sessão sobrevive à **inatividade**. Defina `400d` para sessões que devam durar após uma longa ausência; os navegadores limitam o cookie de atualização a esse período. | `30d` |
| `ALLOW_REGISTRATION` | Permite que novos usuários se registrem (`true`/`false`). Fora de produção, o **primeiro** usuário sempre pode se registrar, não importa o valor desta variável — uma tabela de usuários vazia precisa admitir alguém, e esse alguém se torna o administrador. Em produção (`NODE_ENV=production`), essa janela é fechada: uma tabela vazia recusa o registro de bootstrap com `SETUP_REQUIRED`, uma primeira conta criada através do registro aberto é uma conta comum, e o administrador é definido com `REBASE_ADMIN_EMAIL` abaixo ou atribuído via service key. O `.env.example` do scaffold define como `true`; o padrão do framework é desativado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Chave de desativação geral (kill switch). Fecha a janela de bootstrap do primeiro usuário que `ALLOW_REGISTRATION=false` deliberadamente mantém aberta fora de produção, bloqueando o registro mesmo contra um banco de dados vazio. Combine com `REBASE_ADMIN_EMAIL` abaixo, caso contrário o deploy não terá como gerar seu primeiro usuário autenticado. Todos os artefatos de deploy fornecidos a definem. | — |
| `REBASE_ADMIN_EMAIL` | E-mail da primeira conta de administrador, criada na inicialização **enquanto a tabela de usuários ainda estiver vazia** e nunca após isso. É assim que um deploy em produção obtém seu admin: o operador define a primeira conta em vez de disputar contra a internet pública. A inicialização emite um aviso se a tabela estiver vazia em produção e isso não estiver configurado. | — |
| `REBASE_ADMIN_PASSWORD` | Senha para essa conta. No mínimo 12 caracteres, caso contrário é recusada e a conta não é criada. Altere-a após o primeiro login. | — |
| `MFA_ENCRYPTION_KEY` | Criptografa todos os segredos TOTP armazenados. Se não configurada, os segredos são criptografados com `JWT_SECRET` e a inicialização emite um aviso único — logo, rotacionar `JWT_SECRET` desloga todos *e* torna indecifráveis todos os autenticadores cadastrados. Defina uma chave dedicada (32+ caracteres aleatórios) antes de qualquer pessoa se cadastrar. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | A chave da qual se está fazendo a rotação (*chave anterior*). Configure ambas durante uma rotação: novos segredos são gravados com `MFA_ENCRYPTION_KEY` e os existentes continuam legíveis, para que ninguém seja bloqueado da própria conta durante o processo. Remova-a quando todos os segredos tiverem sido recriptografados. | — |
| `ALLOW_ANONYMOUS` | Habilita o login anônimo (`POST /api/auth/anonymous`). Opcional (opt-in) e deliberadamente não limitado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticação para a API de dados. Defina como `false` para uma superfície de leitura totalmente pública — o RLS ainda se aplica. | `true` |
| `AUTH_DEFAULT_ROLE` | Role atribuída a um usuário recém-registrado quando nenhuma for informada. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta o endpoint `POST /api/auth/find-user`, que resolve um e-mail para um perfil público mínimo (`uid`, `displayName`, `photoURL`) para fluxos de convite por e-mail. Apenas chamadores autenticados, e nunca retorna o e-mail, roles ou metadados do usuário encontrado. Desativado por padrão: é uma superfície de enumeração. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` no cookie de atualização: `Strict`, `Lax` ou `None`. `None` requer HTTPS e serve apenas para um frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` no cookie de atualização. Seguro por padrão; `AUTH_COOKIE_SECURE=false` para http simples — um deploy em um endereço de LAN onde o navegador descartaria o cookie e a sessão expiraria junto com o token de acesso sem exibir erro. Emite aviso na inicialização. `http://localhost` não precisa disso. | `true` |
| `GOOGLE_CLIENT_ID` | ID de cliente OAuth do Google (validação de backend) | — |
| `GOOGLE_CLIENT_SECRET` | Segredo de cliente OAuth do Google | — |
| `GITHUB_CLIENT_ID` | ID de cliente OAuth do GitHub | — |
| `GITHUB_CLIENT_SECRET` | Segredo de cliente OAuth do GitHub | — |
| `MICROSOFT_CLIENT_ID` | ID de cliente OAuth da Microsoft | — |
| `MICROSOFT_CLIENT_SECRET` | Segredo de cliente OAuth da Microsoft | — |
| `LINKEDIN_CLIENT_ID` | ID de cliente OAuth do LinkedIn | — |
| `LINKEDIN_CLIENT_SECRET` | Segredo de cliente OAuth do LinkedIn | — |
| `FACEBOOK_CLIENT_ID` | ID de cliente OAuth do Facebook | — |
| `FACEBOOK_CLIENT_SECRET` | Segredo de cliente OAuth do Facebook | — |
| `TWITTER_CLIENT_ID` | ID de cliente OAuth do X/Twitter | — |
| `TWITTER_CLIENT_SECRET` | Segredo de cliente OAuth do X/Twitter | — |
| `DISCORD_CLIENT_ID` | ID de cliente OAuth do Discord | — |
| `DISCORD_CLIENT_SECRET` | Segredo de cliente OAuth do Discord | — |
| `GITLAB_CLIENT_ID` | ID de cliente OAuth do GitLab. A `baseUrl` de uma instância auto-hospedada não possui correspondente em variável de ambiente — configure o GitLab no bloco `auth` para isso. | — |
| `GITLAB_CLIENT_SECRET` | Segredo de cliente OAuth do GitLab | — |
| `BITBUCKET_CLIENT_ID` | ID de cliente OAuth do Bitbucket | — |
| `BITBUCKET_CLIENT_SECRET` | Segredo de cliente OAuth do Bitbucket | — |
| `SLACK_CLIENT_ID` | ID de cliente OAuth do Slack | — |
| `SLACK_CLIENT_SECRET` | Segredo de cliente OAuth do Slack | — |
| `SPOTIFY_CLIENT_ID` | ID de cliente OAuth do Spotify | — |
| `SPOTIFY_CLIENT_SECRET` | Segredo de cliente OAuth do Spotify | — |
| `APPLE_CLIENT_ID` | Apple Services ID para login na web. É público e disponibilizado em `GET /auth/config`. A Apple não possui segredo de cliente estático, pois o Rebase assina um JWT ES256 de curta duração para cada troca de token. Portanto, a Apple precisa de `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, além deste ou de `APPLE_BUNDLE_IDS`, e nada é configurado sem eles. | — |
| `APPLE_BUNDLE_IDS` | IDs de pacote (bundle ids) separados por vírgula dos aplicativos nativos de iOS/macOS cujos códigos do Sign in with Apple são aceitos. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, o emissor do JWT. | — |
| `APPLE_KEY_ID` | Key ID da chave privada registrada na Apple. | — |
| `APPLE_PRIVATE_KEY` | Conteúdo do arquivo de chave privada `.p8`, incluindo quebras de linha (escapes `\n` são aceitos). | — |
| `REBASE_SERVICE_KEY` | Chave de API de admin estática. Ignora a autenticação JWT padrão para chamadas server-to-server quando passada como `Authorization: Bearer <key>`. (Gerada automaticamente em desenvolvimento). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | A chave pública da plataforma de hospedagem (PEM, EC P-256) contra a qual os tokens de plataforma `rpt_` são verificados; múltiplos blocos PEM durante uma rotação de chaves. A plataforma a define no deploy e ela não contém nenhum segredo. Junto com `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que a validação de admin aceite um token de plataforma para `cron:read` e para nada mais. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | O ID do projeto ao qual o `aud` de um token de plataforma deve ser igual, garantindo que um token emitido para outro projeto seja recusado. Com apenas uma das duas variáveis configurada, o servidor inicializa, registra um aviso e responde a qualquer token `rpt_` com `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Para onde direciona o botão **Continue with Rebase Cloud** do painel de administração: a página do projeto no console da plataforma, que autentica os proprietários do projeto e retorna. A plataforma a define no deploy junto com as duas acima; com elas, `POST /api/auth/platform-signin` aceita o token de um minuto `auth:admin-signin` da plataforma e abre uma sessão de administrador. Sem ela, o acesso ainda funciona via **Open CMS** no console, e a tela de login apenas explica isso. | — |
| `REBASE_RATE_LIMIT_STORE` | Onde residem os contadores de rate limit, para as rotas de autenticação e para `rateLimit` em funções customizadas: `memory` (por processo) ou `sql` (compartilhado entre réplicas). Um processo não pode ver sua própria contagem de réplicas, então um deploy com múltiplas instâncias precisa declarar isso — três réplicas no padrão aplicam três vezes o limite. Qualquer outro valor **recusa a inicialização** em vez de usar fallback, incluindo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monta o fluxo de link de autenticação sem senha (passwordless). Requer um serviço de e-mail configurado, caso contrário o link não tem para onde ser enviado. | `false` |
| `AUTH_EMAIL_OTP` | Monta a autenticação sem senha com um código de seis dígitos enviado por e-mail. Mesma exigência de e-mail mencionada acima. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Cadastro sem senha: uma solicitação de magic link ou código por e-mail para um endereço desconhecido cria a conta, desde que o registro esteja aberto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Ação tomada quando um token de atualização é reutilizado após sua janela de reutilização: `reject` (recusa-o, mantendo a sessão) ou `revoke-session` (encerra a sessão). Qualquer outro valor falha a inicialização. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro com confirmação obrigatória prévia: login com senha bloqueado até o endereço ser verificado. Requer e-mail; a inicialização falha se não configurado. | `false` |
| `CAPTCHA_PROVIDER` | Ativa a verificação por captcha nas rotas de autenticação: `turnstile` ou `hcaptcha`. Se não definido, nenhum captcha será usado. | — |
| `CAPTCHA_SECRET` | O segredo do provedor, usado no servidor para verificar o token enviado pelo navegador. Obrigatório caso `CAPTCHA_PROVIDER` esteja configurado. | — |
| `CAPTCHA_ROUTES` | Rotas de autenticação separadas por vírgula a serem protegidas (por exemplo `register,login`). Se não definido, protege o conjunto padrão do provedor. | — |

### Storage

<span class="since-badge" data-since="0.35">Desde 0.35</span>

:::caution[O storage não possui row-level security, portanto precisa de um modelo de acesso]
Tabelas são protegidas pelo RLS do Postgres. O armazenamento de objetos não possui equivalente —
chaves compartilham um único namespace simples — portanto, com um bucket configurado e nenhum modelo de acesso,
o servidor **se recusa a inicializar em produção**. Atenda a esse requisito com exatamente um dos seguintes:
um hook `storageAuthorize` exportado de `backend/storage.ts` (o que vem por padrão no scaffold),
`STORAGE_POLICIES`, `STORAGE_PUBLIC_READ` ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `STORAGE_TYPE` | Backend de armazenamento: `local`, `s3`, `gcs` ou `platform` (arquivos em um prefixo de propriedade da plataforma de hospedagem, transferidos por URLs assinadas pelo seu intermediário de armazenamento; definido pela plataforma). Em produção, `local` desativa o armazenamento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Caminho base para armazenamento local. Um caminho relativo é lido a partir do diretório onde o servidor executa: a raiz do projeto no `rebase dev`, `backend/` em um servidor gerado pelo `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite armazenamento local em produção — somente com um volume durável contendo `STORAGE_PATH` e os diretórios `<STORAGE_PATH>__<key>` de buckets locais nomeados ao lado | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante os quais a URL de download de um arquivo privado funciona — o token que `getSignedUrl()` inclui nela. No máximo `604800` (uma semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Maior arquivo aceito pela fonte, em bytes, em todos os caminhos de upload — `__<KEY>` para uma fonte nomeada. Um valor que não seja um número inteiro de bytes recusa a inicialização | `52428800` (50 MB) |
| `S3_BUCKET` | Nome do bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Região da AWS | — |
| `S3_ACCESS_KEY_ID` | Chave de acesso da AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chave secreta da AWS | — |
| `S3_ENDPOINT` | Endpoint S3 customizado (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Força URLs em path-style para o bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome do bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projeto no GCP. Geralmente inferido a partir das credenciais. | — |
| `GCS_KEY_FILENAME` | Caminho para o arquivo de chave de service-account. Omita no GCP, onde o Workload Identity fornece credenciais. | — |
| `STORAGE_PUBLIC_READ` | Serve todos os objetos para qualquer pessoa, sem token. Apenas para um bucket que seja genuinamente uma CDN pública. Uma das maneiras de atender à validação de inicialização descrita acima. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite que qualquer chamador autenticado leia, grave, liste e exclua todos os objetos. Nomeado como `INSECURE` no objeto de configuração por um motivo: só é defensável em uma aplicação single-tenant onde todas as contas têm permissão irrestrita para acessar todos os arquivos. | `false` |
| `STORAGE_POLICIES` | Regras de acesso ao storage em formato JSON: `[{ "path", "operations"?, "allow" }]`, com `allow` sendo `"public"`, `"authenticated"`, `"owner"` ou `{ "roles": [...] }`. Bloqueia por padrão e atende à validação de inicialização. Uma lista inválida recusa a inicialização. Consulte [Storage authorization](/docs/backend/storage-authorization/#as-data-storage_policies). | — |
| `STORAGE_BROKER_URL` | O intermediário de armazenamento da plataforma, para `STORAGE_TYPE=platform`. Definido pela plataforma que executa o broker. | — |
| `STORAGE_BROKER_PROJECT` | O ID do projeto ao qual o broker restringe os arquivos deste deploy, para `STORAGE_TYPE=platform`. Definido pela plataforma. | — |
| `STORAGE_RENDITION_CACHE` | Armazena em cache renderizações de imagem geradas (redimensionamentos, conversões de formato) em vez de gerá-las a cada requisição. | `false` |

### E-mail (Opcional)
`MAGIC_LINK_URL`.

| Variável | Descrição |
|----------|-----------|
| `SMTP_HOST` | Host do servidor SMTP |
| `SMTP_PORT` | Porta do servidor SMTP |
| `SMTP_SECURE` | Habilita conexão segura (`true`/`false`) |
| `SMTP_USER` | Usuário SMTP |
| `SMTP_PASS` | Senha SMTP |
| `SMTP_FROM` | Endereço de remetente para e-mails do sistema |
| `SMTP_NAME` | Nome de exibição no endereço do remetente |
| `APP_NAME` | Nome do produto usado nos assuntos e corpos dos e-mails (padrão: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo exibido no topo dos templates de e-mail padrão. PNG ou JPG com `http(s)` absoluto — clientes de e-mail removem SVG e bloqueiam URIs `data:`. Se não definido, um app ainda nomeado como `Rebase` recebe a marca do Rebase e um renomeado não recebe nada |
| `MAGIC_LINK_URL` | Para onde aponta um magic link enviado por e-mail. Uma URL base recebe `/auth/magic-link?token=…` anexado; uma URL contendo `{token}` representa o link inteiro, para um frontend que não atende em `/auth/magic-link`. Coloque entre aspas no `.env`, onde um `#` sem aspas inicia um comentário: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Um valor com hash ou caminho de arquivo sem `{token}` gera um aviso na inicialização. Se não definido, a base é `FRONTEND_URL` |

### Pool de conexões do banco de dados

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `DB_POOL_MAX` | Máximo de conexões no pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milissegundos em que uma conexão inativa é mantida | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milissegundos para esperar por uma conexão | `10000` |
| `DATABASE_DIRECT_URL` | Conexão direta (sem pool). O recurso de [Realtime](/docs/backend/realtime) precisa de uma: `LISTEN`/`NOTIFY` não sobrevive a um pooler em modo de transação como o PgBouncer e, sem isso, as notificações de alterações são desativadas com um aviso em vez de serem perdidas silenciosamente. O [job worker](/docs/backend/jobs) também mantém seu `LISTEN` de ativação nela. Preenche o `directConnectionString` do adaptador Postgres quando não estiver definido. | — |
| `DATABASE_READ_URL` | Réplica de leitura, como um hot standby. Quando aponta para outro servidor, leituras autenticadas (listas, linhas individuais, contagens, agregações) são atendidas por ele sob o mesmo row-level security; gravações, login, realtime, crons, jobs, o console SQL e `rebase.sql` permanecem no primário. Um leitor que acabou de gravar lê do primário durante `REBASE_READ_STICKY_MS`, e todos o fazem enquanto a réplica estiver com atraso superior a `REBASE_READ_MAX_LAG_MS` ou falhando. Preenche o `readConnectionString` do adaptador Postgres quando não definido; até a versão 0.28 inclusive, o pool da réplica era aberto e nunca lido. | — |
| `REBASE_READ_STICKY_MS` | Após uma gravação, por quanto tempo as leituras do mesmo usuário vão para o primário, garantindo que salvar e em seguida listar exiba o registro salvo. Por instância de servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Atraso da réplica além do qual todas as leituras vão para o primário. | `1000` |
| `DATABASE_POOLED` | `true` quando `DATABASE_URL` passa por um pooler em modo de transação como o PgBouncer. O pool então não envia `search_path` nem `statement_timeout` na conexão (o pooler os recusaria ou descartaria) e define ambos em cada transação; a inicialização define para a role do banco um `search_path` padrão como `public` para instruções fora de uma transação. `DATABASE_DIRECT_URL` torna-se obrigatória, e realtime, a ativação do job worker, criação de índices, branching e o console SQL usam-na. A URL da réplica também é considerada como em pool. `DATABASE_POOLED__<KEY>` para outra fonte de dados. | — |
| `REBASE_DB_POOL_MAX` | Um teto para todos os pools no processo, aplicado independentemente do que cada um solicitou. Apenas dígitos puros: um valor malformado é ignorado em vez de serializar o servidor silenciosamente. | — |

### Comportamento em tempo de execução (Runtime)

Lido pelo runtime — `rebase dev`, `rebase start` e a imagem de servidor publicada.
Um projeto que executou eject assume o controle dessas decisões em seu próprio código.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_RLS_AUDIT` | `true` executa a [auditoria agendada de row-level-security](/docs/rls-check#running-it-on-a-schedule), que reporta tabelas servidas sem políticas. O projeto deve declarar `@rebasepro/rls-check` em suas dependências: o runtime não inclui uma cópia, e sem o pacote a inicialização recusa, informando seu nome. `false` mantém a varredura desativada neste processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | A role do Postgres sob a qual requisições autenticadas e anônimas são executadas. Em um cluster compartilhado, forneça uma para cada projeto. O banco de dados registra a role sob a qual opera, e uma inicialização configurada para outra se recusa a iniciar até que `rebase db request-role migrate` faça a migração. Consulte [Running on an existing or shared database](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` cria a request role e permite que a conexão alterne para ela; `never` deixa ambas sob sua responsabilidade e apenas as verifica. | `auto` |
| `REBASE_RLS_GRANTS` | O que o Rebase concede à request role: `schema` (todas as tabelas nos esquemas que serve, além de privilégios padrão), `managed` (apenas as tabelas que serve) ou `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe as políticas permissivas do Rebase à(s) request role(s), para que outras roles que leem as mesmas tabelas não tenham acesso por meio delas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` define as políticas que apenas o contexto do servidor ou um admin pode passar como `TO public`, e executa administradores sob a request role. Por padrão elas são `TO rebase_admin`, permitindo que leituras restritas ao proprietário por usuários autenticados usem o índice de proprietário. Consulte [Admin requests and `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` remove a política padrão de server-or-admin de todas as tabelas. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` também define `request.jwt.claims` e `request.jwt.claim.*`, permitindo que políticas escritas com `auth.uid()` identifiquem o chamador. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Comportamento na inicialização quando outro login pode alternar para a request role: `warn`, `refuse` ou `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Caminho base para todas as rotas de API. O cliente deve ser configurado com o mesmo valor — veja [Alterando `basePath`](#alterando-basepath-changing-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve os assets estáticos/de admin do bundle a partir deste processo. Desative quando houver uma CDN à frente. | `true` |
| `REBASE_STUDIO` | Serve o console integrado standalone do Rebase Studio em `/_studio` quando um bundle estático do Studio estiver disponível. Defina como `false` para desativar. | `true` |
| `REBASE_STUDIO_DIR` | Diretório contendo a SPA pré-compilada standalone do Rebase Studio servida em `/_studio`. O padrão é `/studio` na imagem de container. | `/studio` |
| `REBASE_HISTORY` | Registra o [histórico de alterações de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respostas compactadas com gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` ativa as [notificações push](/docs/backend/push-notifications/): as rotas `/api/push`, a tabela `rebase.push_subscriptions` e `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | O par de chaves VAPID com o qual as mensagens push são assinadas. Fora de produção, um par é gerado e mantido em `.rebase-dev-secrets.json` quando não definido; em produção, as notificações push permanecem desativadas sem elas. | — |
| `REBASE_VAPID_SUBJECT` | Um endereço `mailto:` ou URL `https://` que os serviços de push podem contatar. O padrão é a origem de uma `REBASE_PUBLIC_URL` em `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Tamanho máximo do corpo da requisição, **em bytes** (`10485760`, não `10MB` — um valor que não seja um número recusa a inicialização em vez de remover silenciosamente o limite). `0` desativa o limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | A superfície OpenAPI. Três estados possíveis. Se não definida, em qualquer ambiente: `/api/docs` é servido aos chamadores para os quais `GET /api/schema/tables` descreve tabelas, contendo para cada um o documento das tabelas descritas, e não há interface Swagger UI. `true` publica o documento completo para todos, com a **UI** do Swagger em `/api/swagger` fora de produção (nunca em produção). `false` mantém o documento restrito à validação de administrador. | — |
| `REBASE_METRICS` | Expõe métricas do Prometheus em `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Adiciona `includeSubDomains` ao cabeçalho `Strict-Transport-Security`, fazendo com que navegadores recusem HTTP simples em todos os subdomínios do host por seis meses — incluindo hosts não atendidos por este processo. Ative somente quando todos os subdomínios do domínio forem estritamente HTTPS. Qualquer valor diferente de `true`/`false` recusa a inicialização. Consulte [Security headers](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token protegendo `/metrics`. Se não definido, deixa o endpoint aberto para qualquer coisa que alcance a porta — aceitável em uma rede privada, mas não em uma pública, e os logs de inicialização alertam sobre isso. | — |
| `REBASE_MIGRATE_ON_BOOT` | O que o runtime pode fazer com o esquema das tabelas na inicialização. `ensure` (o padrão em todos os ambientes — inclusive produção) executa a passagem **aditiva**: cria tabelas, colunas e tipos enum ausentes, nunca descartando ou reescrevendo nenhum. `none` mantém intocado o esquema das tabelas declaradas, mas as próprias tabelas do framework (auth, API keys, jobs, cron) ainda são criadas e mantidas atualizadas; `REBASE_PROVISION=false` desativa essas também. A imagem publicada aceita apenas essas duas opções e **recusa a inicialização se configurada com `push`**. Em um [split deployment](/docs/deployment/split-processes), exatamente um processo pode provisionar; portanto, todas as outras roles devem definir `none` ou a inicialização será recusada. | `ensure` |
| `REBASE_PROVISION` | `false` faz com que o runtime não altere nada em seu banco de dados: nenhuma tabela, coluna, índice, função, trigger, política, role ou grant, seja na inicialização ou posteriormente, incluindo os do próprio framework. Em vez disso, reporta nominalmente o que estiver faltando. Indicado para bancos de dados em que apenas seu processo de mudanças pode fazer alterações. Consulte [When only your change process may change the database](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Apenas `true` e `false` são aceitos. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Recusa a inicialização se o banco de dados tiver sido provisionado pela última vez a partir de um conjunto de tabelas diferente daquele com o qual este processo foi construído. Se não definido (ou qualquer valor diferente de `true`/`1`), apenas emite um aviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Recusa a inicialização quando um arquivo de função ou cron lança erro ou falha no parse durante a importação, informando cada arquivo e o motivo, garantindo que um rolling deploy mantenha a versão antiga em execução. Um reinício também segue essa regra. Se não definido (ou qualquer valor diferente de `true`), ignora o arquivo e serve o restante. Um arquivo importado sem erros que não exporta nenhuma função ou job é sempre ignorado, e não recusado. | skip |
| `REALTIME_CDC` | Captura de alterações a nível de banco de dados: `auto` (lê alterações do WAL quando o banco permitir, senão usa triggers, senão faz fallback para nível de aplicação, registrando cada fallback como info), `trigger` (força o uso, avisa se impossível), `wal` (lê alterações do write-ahead log em vez de triggers; requer `wal_level=logical` e uma role com permissão de replicação, fazendo fallback para `trigger` caso contrário), `off`. Consulte [Realtime](/docs/backend/realtime-cdc/). Tem precedência sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instâncias para canais de broadcast e presence: `memory` ou `postgres`. Ignorado quando um transporte construído for fornecido a `realtime.bus`. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Quantas inscrições um socket de realtime pode manter; a seguinte é recusada com `TOO_MANY_SUBSCRIPTIONS`. Um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSubscriptionsPerSocket`. Consulte [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Quantos sockets de realtime um usuário, ou uma API key, pode manter abertos em uma instância de servidor. Sockets de personificação de um administrador contam contra o administrador. O login do próximo é recusado com `TOO_MANY_SOCKETS` e o socket é fechado (4002); o SDK continua tentando, conectando assim que outro for fechado. Um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSocketsPerUser`. | Sem limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tempo máximo que uma alteração aguarda pela nova busca (refetch) que a entrega aos assinantes ativos, em ms. Um refetch aguarda 300 ms sem alterações, e no máximo esse período sob um fluxo constante de gravações. Um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Por quanto tempo o total de uma inscrição de lista grande pode ser reutilizado antes de ser contado novamente, em ms; frames que o reutilizam trazem `meta.totalAsOf`. Se não definido, cada frame é contado. Tem precedência sobre `realtime.recountIntervalMs`. | Não definido |
| `REALTIME_RECOUNT_MIN_ROWS` | O menor total anterior ao qual `REALTIME_RECOUNT_INTERVAL_MS` se aplica; listas menores são contadas a cada frame. Tem precedência sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost`/loopback sob `NODE_ENV=production`. Desativado por padrão, para que uma inicialização em produção falhe explicitamente em vez de conectar a um banco de dados inexistente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` executa a verificação de esquema e encerra sem abrir um socket — o formato que um Job de migração precisa, a partir da mesma imagem e do mesmo bundle do servidor subsequente. Ele também cria as tabelas que um processo ativo de atendimento criaria no primeiro uso, e não inicia nenhum cron ou fila de jobs. Um valor vazio é considerado *não definido*, garantindo que um `${SOMETHING}` não substituído em um arquivo compose não transforme um deploy comum em um que migra e se recusa a atender requisições. Recusado em conjunto com `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Um caminho de arquivo. Uma execução de provisionamento (`REBASE_PROVISION_ONLY=true`) grava nela todas as alterações de esquema feitas, em ordem, como um script SQL para revisão e aplicação via `psql`. Linhas gravadas não são incluídas. Recusado em um processo ativo de atendimento. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que uma máquina — um agente, um job de CI — *aplique* uma alteração de esquema via `/api/admin/schema`, e não apenas planeje uma. Desativado a menos que solicitado: a credencial necessária para realizar tal alteração é a mais propensa a estar armazenada em uma variável de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo máximo que uma função customizada pode executar antes de sua requisição ser abortada. Mesmo ajuste da opção `functionsTimeoutMs`. `0` desativa. Uma função que declare seu próprio timeout (`defineFunction(…, { timeoutMs })`) usará seu respectivo valor. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | O timeout máximo que uma função pode declarar para si com `defineFunction(…, { timeoutMs })`, em ms; funções que solicitarem mais receberão este valor. Um número positivo; qualquer outro valor é interpretado como não definido. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` faz com que uma rejeição de promise não tratada encerre o processo em vez de apenas registrá-la em log. Recomendado sob um orquestrador que fará o reinício; desative onde um reinício for pior que um vazamento. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silencia o aviso de inicialização em plataformas que o runtime detecta como scale-to-zero, onde um timer acionado em uma instância ociosa não dispara em instância alguma. Não altera mais nada: defina quando você mantiver pelo menos uma instância em execução. | — |
| `TRUSTED_PROXY_HOPS` | Quantos proxies estão posicionados à frente deste servidor, para que o rate limiter possa ler o endereço real do cliente a partir de `X-Forwarded-For`. Padrão seguro `0`: sem proxy, confiar no cabeçalho permitiria que qualquer chamador forjasse uma identidade. | `0` |

:::note[O provisionamento na inicialização é aditivo e não é uma ferramenta de migração]
A passagem de inicialização é executada sem supervisão e sem ninguém analisando um diff,
portanto nunca removerá uma coluna, restringirá um tipo ou reescreverá uma tabela.
É também por isso que a imagem recusa `REBASE_MIGRATE_ON_BOOT=push`: um push completo
calcula um diff e executará alegremente `DROP COLUMN`, e o reinício de um container nunca
deve ter como efeito colateral destruir uma coluna em produção devido a um reagendamento.

Alterações destrutivas ou de reestruturação permanecem onde podem ser revisadas: `rebase db
generate` + `rebase db migrate`, ou `rebase db push` a partir de um checkout ou CI,
que executa uma simulação (dry-run) da alteração, recusa alterações destrutivas sem confirmação
e pode criar um backup previamente.
:::

### Split deployments

Uma única imagem e um único bundle podem ser inicializados diversas vezes, cada um atendendo a uma parte diferente do projeto. Apenas uma linha para cada aqui, pois esta página se propõe a listar todas as variáveis; o que cada combinação *monta e controla* — e quais combinações se recusam a inicializar — está em
**[Split Processes](/docs/deployment/split-processes)**.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_ROLE` | Qual parte este processo atende: `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescreve se *este* processo executa os timers de cron. Se não definido, segue a role. | — |
| `REBASE_JOB_WORKERS` | Sobrescreve se este processo executa os workers de fila de jobs. Se não definido, segue a role. | — |
| `REBASE_FUNCTIONS_ONLY` | Serve apenas as funções customizadas indicadas neste processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Serve todas as funções customizadas, exceto as indicadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Para onde o processo de API encaminha uma requisição de função que ele próprio não atende. Em um `worker`, para onde vão suas próprias chamadas `rebase.functions`. Uma URL `http(s)`. | — |

### Superfície MCP

Um endpoint opcional (opt-in) do Model Context Protocol em `/mcp`, para que um cliente de IA possa ler e gravar neste projeto **como o usuário autenticado**. Desativado a menos que configurado, e — ao contrário de qualquer outra superfície — nenhum `REBASE_ROLE` o ativa: as outras descrevem o formato de um processo, enquanto esta representa uma decisão de conceder credenciais a software de terceiros, devendo ser tomada por uma pessoa em vez de herdada da função de um container.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_MCP_ENABLED` | Monta a superfície MCP. Requer `REBASE_PUBLIC_URL`; sem ela, a superfície se recusa a ser montada e informa isso no log de inicialização. | `false` |
| `REBASE_PUBLIC_URL` | A origem acessível externamente deste deploy, por exemplo `https://app.example.com`. A superfície MCP não consegue derivá-la — obter a origem a partir do cabeçalho `Host` tornaria a identidade do emissor e a audiência contra a qual seus próprios tokens são validados valores fornecidos pelo chamador. | — |
| `REBASE_MCP_VIEW` | Caminho para a visualização MCP App própria do projeto (`rebase-view.html`, gerada por `rebaseMcpViewPlugin()`), servida ao Claude em vez da visualização genérica, garantindo que suas telas, campos e ações customizadas sejam o que ele renderiza. Sem isso, o backend procura ao lado do frontend que ele serve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite registro dinâmico de cliente OAuth (RFC 7591), para que um cliente possa se auto-registrar. Defina como `false` para exigir que os clientes sejam registrados com antecedência. | `true` |

### Edição de esquema ao vivo a partir de um bundle

Desativado a menos que `REBASE_LIVE_SCHEMA_REPOSITORY` esteja definido. Um bundle compilado não tem o código-fonte de `backend/schema` para editar; portanto, com essas variáveis configuradas, o editor de esquema lê o fonte do repositório, faz commit de cada alteração de volta e executa seu DDL neste banco de dados. Exclusivo para administradores e aplicado por uma pessoa, a menos que `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` determine o contrário. Um repositório informado sem credenciais utilizáveis recusa a inicialização. Consulte [Live schema editing](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | O repositório do GitHub para o qual fazer commit das alterações de esquema, no formato `owner/name`. Defini-lo é o que ativa o recurso. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | A branch onde o commit será inserido. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Onde `backend/schema` reside nesse repositório, relativo à raiz do repositório. Um caminho que saia do repositório recusa a inicialização, assim como o parâmetro descontinuado `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Um token granular (fine-grained token) com permissão de leitura e gravação no conteúdo do repositório. Defina este ou as três variáveis `_GITHUB_APP_*`, não ambos. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | O ID de um GitHub App, para fazer commit como o app em vez de usar um token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | A instalação do app no repositório. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | A chave privada do app: PEM, PEM com quebras de linha escapadas ou base64. | — |

### Backups

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `BACKUP_SCHEDULE` | Expressão cron para backups agendados. Não definido significa que backups agendados estão desativados. | — |
| `BACKUP_DESTINATION` | Caminho local ou uma URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obrigatório junto com `BACKUP_SCHEDULE`, que se recusa a executar sem isso. O comando `rebase db backup` faz fallback para `./backups` no diretório onde foi executado. | — |
| `BACKUP_RETENTION_DAYS` | Exclui backups com mais de N dias. Não definido ou `0` mantém tudo. | — |
| `BACKUP_KEEP_MINIMUM` | Sempre retém pelo menos N dos backups mais recentes, independentemente da retenção configurada. | — |
| `PG_DUMP_PATH` | Sobrescreve o binário do `pg_dump` — deve ser da mesma versão major do servidor ou mais recente. | — |
| `PG_RESTORE_PATH` | Sobrescreve o binário do `pg_restore`. | — |
| `PSQL_PATH` | Sobrescreve o binário do `psql` executado por `rebase db restore --clean` para fazer a restauração em uma única transação. | — |
| `PG_DUMPALL_PATH` | Onde o `pg_dumpall` reside, caso não esteja no `PATH`. Sem ele — e sem as ferramentas de cliente do PostgreSQL instaladas —, um backup de variáveis globais falha com um erro indicando esta variável. | — |

A imagem de runtime oficial (`rebasepro/server`) inclui as ferramentas de cliente
do PostgreSQL 18, de modo que um backup agendado pode ser executado nela contra qualquer
servidor até o Postgres 18. Fora da imagem, instale-as você mesmo (`apt-get install postgresql-client-18`,
`brew install libpq`).

Backups contêm segredos e dados pessoais identificáveis (PII). Use um destino privado
com criptografia em repouso (encryption-at-rest).

### Entrega de bundle (Bundle delivery)

Um deploy gerenciado não carrega seu código na imagem: o runtime busca um
bundle na inicialização. Estas variáveis definem qual bundle e como.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BUNDLE` | Caminho para um diretório de bundle já extraído. O que `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | De onde baixar o arquivo de bundle, quando não houver um local. | — |
| `REBASE_BUNDLE_TOKEN` | A credencial bearer para esse download. Trate-a como um segredo: é o que autoriza um tenant a baixar seu próprio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Onde um bundle baixado é extraído. Deve ter permissão de escrita e persistir entre o download e a inicialização. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionais que a imagem de runtime fornece ao bundle, além daqueles que ele próprio declara. | — |

### Vinculações de recursos (Resource bindings)

Cada banco de dados, bucket e tópico que um projeto declara em `backend/resources.ts` é
vinculado por variáveis de ambiente nomeadas a partir dele. Os nomes base estão abaixo; um
recurso não padrão anexa `__` e sua chave em letras maiúsculas, portanto um bucket chamado
`media` lê `S3_BUCKET__MEDIA`. O comando `rebase status` exibe, para cada recurso,
a variável exata que está sendo lida e se ela está configurada.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_DRIVER` | O pacote npm que implementa o driver de uma fonte de dados, quando não for o padrão do Postgres. Com sufixo por fonte: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | A string de conexão para um tópico declarado. Com sufixo por tópico. | — |

### O ambiente próprio da CLI

Lido pelo `rebase`, não pelo servidor. Nada aqui afeta um deploy.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BASE_URL` | Para onde `rebase api-keys`, `rebase storage` e `rebase auth reset-password` enviam a service key, no shell ou no `.env`. Defina quando o servidor rodar de outra forma que não `rebase dev` neste projeto: `rebase start`, um container, outro host. Se não definido, eles usam o servidor registrado pelo `rebase dev` enquanto ele estiver em execução, e não enviam nada quando não estiver. | — |
| `REBASE_SERVICE_KEY` | A service key com a qual esses comandos se autenticam, lida do `.env`: a mesma variável que o servidor lê (veja acima). | — |
| `SERVICE_KEY` | Um nome mais antigo para essa chave. Quando definida no `.env`, `rebase api-keys` e `rebase storage` a leem no lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qual arquivo `.env` a CLI lê e grava, quando não for o do projeto. | — |
| `REBASE_ROOT_RULES` | `0` impede que `rebase init` e `rebase skills install` escrevam as regras do projeto nos arquivos `CLAUDE.md` e `AGENTS.md` na raiz do repositório, útil para raízes cujos arquivos de agentes você mantém manualmente. | on |
| `REBASE_CLOUD_URL` | O control plane com o qual `rebase cloud` se comunica. | — |
| `REBASE_CLOUD_EMAIL` | A conta com a qual `rebase cloud login` se autentica, em vez de solicitar interação. | — |
| `REBASE_CLOUD_PASSWORD` | A senha correspondente, para que um cofre de segredos possa fornecê-la sem que ela fique registrada no histórico do shell. | — |
| `REBASE_TOKEN` | Um token obtido em `rebase cloud tokens create`. Quando configurado, todos os comandos do `rebase cloud` se autenticam com ele em vez da sessão de `rebase cloud login`, nunca lendo ou gravando a sessão armazenada. Em um diretório vinculado por `rebase cloud init --claim`, ele é colocado de lado em favor do token do próprio projeto quando não possuir escopo sobre o projeto. A forma correta de rodar `rebase cloud` em CI — veja [CI and agents](/docs/deployment/cloud/#ci-and-agents). O [MCP server](/docs/ai/mcp/) o repassa para a CLI invocada por suas ferramentas de cloud, e nunca o envia para o app: configure `REBASE_API_TOKEN` para isso. | — |
| `REBASE_DEBUG` | `1` exibe o erro subjacente e os detalhes da requisição em vez da mensagem curta. A primeira coisa a configurar quando um comando do `rebase cloud` falhar sem fornecer informações úteis. | — |
| `REBASE_ATLAS_DEV_URL` | O banco de dados vazio contra o qual `rebase db push`, `db generate` e `db migrate` fazem o planejamento, em vez do `<db>_dev_diff` que eles criam ao lado de `DATABASE_URL`. O Rebase não cria nem exclui um banco de dados indicado aqui, e recusa um que seja idêntico a `DATABASE_URL`. No banco de dados de desenvolvimento gerenciado, a CLI o define para um PGlite descartável em memória próprio. Configure-o quando permissões de `CREATE DATABASE` não forem concedidas. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` não inicializa nenhum banco de dados e não provisiona nada — você fornece o seu próprio. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixa a porta do servidor de desenvolvimento do frontend, que de outra forma o `rebase dev` deriva a partir do caminho do projeto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Quanto tempo o `rebase dev` aguarda o backend se anunciar antes de informar que ele não iniciou. `0` desativa o relatório. | `30000` |
| `DATABASE_PASSWORD` | A senha que `rebase dev --docker` insere na connection string derivada do `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | A convenção comum entre ferramentas. Defina como qualquer valor diferente de `0` e a CLI não enviará telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | O mesmo, especificamente para o Rebase. Não requer arquivo, por isso é a recomendada para uso em CI e em imagens. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Para onde a telemetria é enviada, no caso de um coletor auto-hospedado. | — |

## Segredos em desenvolvimento

`JWT_SECRET` é obrigatória em produção. Ela e `REBASE_SERVICE_KEY` são
geradas para você fora de produção, para que você possa começar sem configurar nada.

Esses valores gerados são armazenados em cache em `.rebase-dev-secrets.json`, ao lado
de `.rebase-dev-port` e `.rebase-dev-url` e ignorados pelo git juntamente com eles. Antes,
eles eram regerados a cada inicialização — portanto, reiniciar o servidor de desenvolvimento
deslogava você da sua própria aplicação e invalidava qualquer chave de API recém-criada.

- Defina qualquer uma das variáveis explicitamente e o seu valor será usado; nada será armazenado em cache ou lido.
- Aponte o cache para outro local com `REBASE_DEV_SECRETS_FILE` — um caminho, e a
  única variável nesta seção que você definiria deliberadamente.
- Exclua o arquivo para renovar ambos os segredos. A próxima inicialização gerará um novo arquivo.
- Se o arquivo não puder ser gravado — em um container somente leitura, por exemplo —, o servidor
  iniciará mesmo assim com um segredo efêmero, exatamente como fazia antes.

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

As mesmas opções, sem `app`, `server` e `basePath` e com `provision` obrigatório,
constroem um backend que não serve nada até que você o monte: `createRebaseBackend`. Consulte
[Custom Server Integration](/docs/backend/custom-server/).

### Alterando `basePath` {#changing-basepath}

`basePath` move todas as rotas da API, portanto o cliente deve ser informado da mesma alteração —
caso contrário, continuará requisitando `/api/...` e receberá 404 para tudo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

O painel de administração obtém isso a partir do cliente fornecido a ele; nada mais precisa
ser configurado. Se você construir uma URL de requisição manualmente, concatene-a a partir do cliente
em vez de escrever `/api` você mesmo:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solução de Problemas

### Permissão Negada no SQL Editor (`permission denied for table <name>`)

* **Sintomas:** Queries customizadas executadas no SQL editor do Rebase Studio falham com `cause: error: permission denied for table <name>`, embora a visualização de planilha do CMS carregue os dados com sucesso.
* **Causa:** Por padrão, o Rebase tenta executar queries do SQL Editor alternando temporariamente as roles do banco de dados para corresponder à role de aplicação do usuário ativo (por exemplo, `SET LOCAL ROLE "admin"`). Se você estiver usando autenticação customizada em que as roles existem apenas em tabelas do banco de dados e não como roles reais do PostgreSQL, a alternância de role falha ou faltam privilégios no banco. A visualização de planilha do CMS é executada sob o usuário proprietário da conexão padrão e ignora essa restrição.
* **Solução:** Adicione `DISABLE_DB_ROLE_SWITCHING=true` à configuração do seu `.env` do backend. Isso força o Rebase a executar queries do SQL Editor usando os privilégios do proprietário da conexão (geralmente um superuser/owner). O SQL Editor então informa, acima dos resultados, que eles foram lidos como o proprietário da conexão e desabilita seu seletor de roles.

### Falha na Busca do Esquema no SQL Editor (`Cross-database execution requires adminConnectionString`)

* **Sintomas:** O Studio falha ao carregar a árvore de esquema, ou o SQL Editor lança `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** O Rebase requer privilégios administrativos para consultar os catálogos do sistema do banco de dados e executar comandos administrativos. Se `adminConnectionString` não for fornecido ao inicializador (bootstrapper) ou `getAdmin()` for sobrescrito para retornar `undefined`, essas operações falham.
* **Solução:** Certifique-se de que `adminConnectionString` esteja configurado durante a inicialização do bootstrapper do backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Próximos Passos

- **[Deployment](/docs/getting-started/deployment)** — Guia de deploy em produção
- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
