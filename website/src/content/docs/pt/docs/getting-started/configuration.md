---
sourceHash: 0e81d6a2d1e7dc57
title: Ambiente e Configuração
sidebar_label: Configuração
description: Todas as variáveis de ambiente e opções de configuração para projetos Rebase.
---

## Variáveis de Ambiente

Toda a configuração é feita por meio de variáveis de ambiente no seu arquivo `.env` na raiz do projeto.

> **Importante**: O Rebase valida as variáveis de ambiente com o **Zod** na inicialização. Se
> qualquer item obrigatório estiver ausente ou malformado (uma URL que não é uma URL, uma porta que
> não é um número), o servidor se recusa a iniciar e indica o nome da variável.
>
> O local onde o esquema reside depende de como você executa o backend. Um projeto inicializado pelo
> runtime — `rebase dev`, `rebase start`, a imagem publicada — usa o
> esquema pertencente ao runtime (`loadBootEnv` em `@rebasepro/server`), que é a
> união de todas as tabelas abaixo. Um projeto que executou [`rebase eject`](/docs/cli)
> possui um `backend/src/env.ts` chamando `loadEnv({ extend })`, e pode adicionar suas próprias
> variáveis tipadas lá.

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-------------|---------|
| `DATABASE_URL` | String de conexão do PostgreSQL. **Opcional em desenvolvimento** — se não definida, `rebase dev` executa um PostgreSQL gerenciado para o projeto, com seus dados sob `.rebase/`. Obrigatória em todos os outros ambientes. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chave secreta para assinar tokens JWT. Use uma string aleatória forte (mínimo de 32 caracteres). **Obrigatória em produção** (gerada automaticamente em desenvolvimento). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` é uma grafia do node-postgres, não do libpq.**
>
> O Rebase e o driver do Node a aceitam — criptografam, mas não verificam o
> certificado. O `psql`, `pg_dump`, `pg_restore` e Atlas não aceitam, e não fazem
> fallback gracioso: eles recusam iniciar com `invalid sslmode value: "no-verify"`.
>
> Os comandos próprios do Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) reescrevem o valor para o equivalente `sslmode=require` antes de invocar o shell,
> funcionando perfeitamente com a URL conforme configurada. Executar o `psql` manualmente não faz
> isso — substitua por `sslmode=require` lá, que criptografa sem verificar exatamente da
> mesma maneira.

### Frontend

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `VITE_API_URL` | URL da API do backend para o SDK tipado. **Defina apenas em desenvolvimento** — veja abaixo. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | Client ID do Google OAuth. Habilita "Entrar com o Google". | — |


> **Deixe `VITE_API_URL` não definida em builds de produção.**
>
> Em desenvolvimento, o frontend e o backend são origens separadas, então o servidor
> de desenvolvimento injeta isso. Em produção, o backend do Rebase serve a SPA, portanto a
> API é a própria origem da página e o cliente a resolve dessa forma por conta própria.
>
> Embutir uma URL absoluta em um bundle de produção funciona perfeitamente até que um segundo
> hostname aponte para a mesma aplicação: um domínio personalizado então carrega a página de
> `example.com` e chama a API em `example.rebase.website`, o que é cross-origin,
> fazendo com que todas as requisições falhem no preflight. Permitir a origem no CORS
> **não** resolve o problema — o cookie de atualização é `SameSite=Lax` e não
> é enviado entre sites diferentes (cross-site), então você limparia os erros do console e ainda
> teria a autenticação quebrada. Não definida, qualquer domínio que aponte para a aplicação funciona sem
> necessidade de configuração de CORS.

### Backend

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `PORT` | Porta para o servidor HTTP do backend. Lida por `rebase start`. O `rebase dev` a lê **apenas do ambiente do shell** — um `PORT` no `.env` não é lido lá, pois a porta é resolvida antes desse arquivo ser carregado — e, caso contrário, vincula uma porta derivada do caminho do projeto, permitindo que vários projetos rodem ao mesmo tempo. `rebase dev --port` tem precedência sobre ambos, e o banner inicial informa a opção utilizada. | `3001` |
| `LOG_LEVEL` | Verbosidade dos logs: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Exibe o SQL por trás de uma linha `Failed query: [redacted]`. Cada instrução com falha é ocultada por padrão, pois uma consulta que falhou carrega seus parâmetros vinculados — um e-mail, um hash de senha. Defina como `true` durante o diagnóstico de falhas de DDL, RLS ou change-capture. Ignorado quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production`, ou `test` | `development` |
| `CORS_ORIGINS` | Lista separada por vírgulas de origens permitidas. **Obrigatória em produção**, a menos que `FRONTEND_URL` esteja definida: uma inicialização em produção sem nenhuma das duas se recusa a iniciar. Em desenvolvimento, ela é *adicionada ao* localhost — veja abaixo. | — |
| `FRONTEND_URL` | URL da aplicação frontend. Usada como alternativa ao CORS_ORIGINS, em ambos os ambientes. | — |
| `ADMIN_CONNECTION_STRING` | String de conexão com o banco de dados em nível de administrador (usada para introspecção de esquema e operações administrativas). O banco de dados especificado não é o que o console SQL considera atual, nem o que uma nova branch copia por padrão: ambos são o banco de dados no qual a própria conexão da aplicação está (veja `REBASE_BRANCH_PARENT_DATABASE` para um servidor em uma branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desativa a alternância de roles do PostgreSQL no Editor SQL (útil para autenticação personalizada onde as roles de banco não são mapeadas). O console SQL do Studio então informa que as linhas foram lidas como o proprietário da conexão, exibe o nome dele e desativa o seletor de roles. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | O banco de dados a partir do qual a branch na qual este servidor roda foi copiada. `rebase dev` a define em um checkout [alternado para uma branch](/docs/backend/branching/#cli-integration). Um servidor com ela mantém o registro de branches nesse banco de dados e copia novas branches a partir dele por padrão, permitindo que o painel Branches do Studio exiba as branches do banco de dados principal. | — |

#### CORS em desenvolvimento

O desenvolvimento permite **localhost, além de qualquer origem listada em `CORS_ORIGINS` (ou `FRONTEND_URL`)**
— a mesma lista que a produção utiliza, com o localhost adicionado em vez de
substituído. Assim, a variável opera da mesma forma em ambos os ambientes, e os
casos que precisam dela em desenvolvimento são os usuais:

```bash
# Um celular na LAN, a máquina de um colega, um túnel ngrok,
# uma porta encaminhada do Codespaces — todas origens diferentes de localhost.
CORS_ORIGINS=http://192.168.1.5:5173
```

Uma origem que não seja localhost nem esteja listada é recusada, e a recusa é
registrada em log **uma vez por origem** com a linha exata que permitiria o acesso. A recusa
não é mera cautela: a API envia credenciais, portanto refletir um
`Origin` arbitrário permitiria que qualquer site que o desenvolvedor visitasse fizesse
requisições autenticadas contra o servidor de desenvolvimento com a sessão dele e lesse as
respostas.

### Autenticação

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `JWT_SECRET` | Chave secreta para assinatura JWT (obrigatória em produção, gerada automaticamente em desenvolvimento) | — |
| `JWT_PRIVATE_KEY` | Chave privada PEM para assinar tokens de acesso assimetricamente (RS256), permitindo que qualquer parte em posse do JWKS verifique uma sessão sem a capacidade de emitir uma nova. Aceita PEM com quebras de linha reais, PEM com escapes `\n`, ou base64 de todo o PEM. Sem isso, os tokens permanecem HS256. | — |
| `JWT_KEY_ID` | Identifica a `JWT_PRIVATE_KEY` no cabeçalho do token e no JWKS. Altere sempre que a chave for modificada — o processo de rotação depende de distinguir a chave antiga da nova. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tempo de expiração do token de acesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tempo de expiração do token de atualização (refresh token). Janela deslizante — cada rotação renova o prazo, portanto isso governa quanto tempo uma sessão sobrevive à **inatividade**. Defina `400d` para sessões que sobrevivem a longos períodos de ausência; navegadores limitam o cookie de atualização a este período. | `30d` |
| `ALLOW_REGISTRATION` | Permitir o registro de novos usuários (`true`/`false`). Fora de produção, o **primeiro** usuário sempre pode se registrar, independentemente desta configuração — uma tabela de usuários vazia precisa aceitar alguém, e esse alguém se torna o administrador. Em produção (`NODE_ENV=production`), essa janela é fechada: uma tabela vazia recusa o registro inicial com `SETUP_REQUIRED`, uma primeira conta criada através de registro aberto é uma conta comum, e o administrador é definido via `REBASE_ADMIN_EMAIL` abaixo ou atribuído via service key. O `.env.example` do scaffold o define como `true`; o padrão do framework é desativado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Botão de desligamento de emergência (kill switch). Fecha a janela de inicialização do primeiro usuário que `ALLOW_REGISTRATION=false` deliberadamente deixa aberta fora de produção, de modo que o registro seja bloqueado mesmo contra um banco de dados vazio. Combine com `REBASE_ADMIN_EMAIL` abaixo, caso contrário a implantação não terá como gerar seu primeiro usuário autenticado. Todos os artefatos de implantação fornecidos vêm com esta opção definida. | — |
| `REBASE_ADMIN_EMAIL` | E-mail da primeira conta de administrador, criada na inicialização **enquanto a tabela de usuários ainda estiver vazia** e nunca posteriormente. É assim que uma implantação de produção obtém seu administrador: o operador define a primeira conta em vez de disputá-la na internet. O boot emite um aviso quando a tabela está vazia em produção e essa variável não está configurada. | — |
| `REBASE_ADMIN_PASSWORD` | Senha para essa conta. Pelo menos 12 caracteres, caso contrário será recusada e a conta não será criada. Altere-a após o primeiro login. | — |
| `MFA_ENCRYPTION_KEY` | Criptografa todos os segredos TOTP armazenados. Se não configurada, os segredos serão criptografados com `JWT_SECRET` e o boot emitirá um aviso — dessa forma, rotacionar o `JWT_SECRET` desconectará todos os usuários *e* deixará todos os autenticadores cadastrados indecifráveis. Defina uma chave dedicada (32+ caracteres aleatórios) antes que alguém faça o cadastro. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | A chave da qual se está migrando na *rotação*. Defina ambas durante uma rotação: novos segredos serão gravados com `MFA_ENCRYPTION_KEY` e os existentes continuarão legíveis, para que ninguém seja bloqueado da própria conta no meio da rotação. Remova-a assim que todos os segredos forem recriptografados. | — |
| `ALLOW_ANONYMOUS` | Habilita login anônimo (`POST /api/auth/anonymous`). Ativação opcional (opt-in) e deliberadamente não bloqueada por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticação para a API de dados. Defina como `false` para uma interface de leitura totalmente pública — o RLS ainda se aplica. | `true` |
| `AUTH_DEFAULT_ROLE` | Role atribuída a um usuário recém-registrado quando nenhuma for informada. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Habilita o endpoint `POST /api/auth/find-user`, que resolve um e-mail para um perfil público mínimo (`uid`, `displayName`, `photoURL`) para fluxos de convite por e-mail. Apenas chamadores autenticados, e nunca retorna o e-mail, roles ou metadados do usuário encontrado. Desativado por padrão: representa uma superfície de enumeração. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Atributo `SameSite` no cookie de atualização: `Strict`, `Lax` ou `None`. `None` requer HTTPS e é apenas para frontends genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Atributo `Secure` no cookie de atualização. Seguro por padrão; use `AUTH_COOKIE_SECURE=false` para http puro — uma implantação em endereço de rede local (LAN) onde o navegador descartaria o cookie e a sessão morreria silenciosamente na expiração do token de acesso. Um aviso é exibido no boot. `http://localhost` não precisa disso. | `true` |
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
| `GITLAB_CLIENT_ID` | Client ID do GitLab OAuth. A `baseUrl` de uma instância auto-hospedada não possui mapeamento de variável de ambiente — configure o GitLab no bloco `auth` para isso. | — |
| `GITLAB_CLIENT_SECRET` | Client Secret do GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Client ID do Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client Secret do Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Client ID do Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client Secret do Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Client ID do Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client Secret do Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID da Apple, para login via web. É público e disponibilizado em `GET /auth/config`. A Apple não possui um client secret estático, pois o Rebase assina um JWT ES256 de curta duração para cada troca de token. Portanto, a Apple precisa de `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, além deste ou de `APPLE_BUNDLE_IDS`, não configurando nada sem eles. | — |
| `APPLE_BUNDLE_IDS` | Lista separada por vírgulas de bundle IDs das aplicações nativas para iOS/macOS cujos códigos do Sign in with Apple são aceitos. | — |
| `APPLE_TEAM_ID` | Team ID da Apple Developer, emissor do JWT. | — |
| `APPLE_KEY_ID` | Key ID da chave privada registrada com a Apple. | — |
| `APPLE_PRIVATE_KEY` | Conteúdo do arquivo de chave privada `.p8`, incluindo quebras de linha (escapes `\n` são aceitos). | — |
| `REBASE_SERVICE_KEY` | Chave de API estática de administrador. Ignora a autenticação normal por JWT em chamadas server-to-server quando passada como `Authorization: Bearer <key>`. (Gerada automaticamente em desenvolvimento). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Chave pública da plataforma de hospedagem (PEM, EC P-256) contra a qual os tokens de plataforma `rpt_` são verificados; múltiplos blocos PEM durante a rotação de chaves. A plataforma define isso no deploy e ela não contém nenhum segredo. Juntamente com `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que a barreira de admin aceite um token de plataforma para `cron:read`, e para nada mais. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | O ID do projeto com o qual o `aud` do token de plataforma deve ser idêntico, para que tokens gerados para outros projetos sejam recusados. Se apenas uma das duas variáveis for definida, o servidor inicia, registra um aviso e responde a qualquer token `rpt_` com `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Onde os contadores de limite de taxa (rate-limit) de autenticação ficam armazenados: `memory` (por processo) ou `sql` (compartilhado entre réplicas). Um processo não pode ver sua própria contagem de réplicas, então uma implantação com instâncias paralelas precisa declarar isso — três réplicas no padrão aplicam três vezes o limite. Qualquer outro valor **recusa a inicialização** em vez de fazer fallback, incluindo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Habilita o fluxo de login sem senha via link (magic link). Requer um serviço de e-mail configurado, caso contrário o link não terá para onde ser enviado. | `false` |
| `AUTH_EMAIL_OTP` | Habilita o login sem senha por meio de código de seis dígitos enviado por e-mail. Mesmo requisito de e-mail acima. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Cadastro sem senha: uma requisição de magic link ou código por e-mail para um endereço desconhecido cria a conta, enquanto o registro estiver aberto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Ação quando um token de atualização é reenviado após sua janela de reutilização: `reject` (recusa, mantém a sessão) ou `revoke-session` (encerra a sessão). Qualquer outro valor impede a inicialização. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro com confirmação prévia: sem login por senha até que o endereço de e-mail seja verificado. Requer serviço de e-mail; o boot será recusado sem ele. | `false` |
| `CAPTCHA_PROVIDER` | Habilita a verificação por captcha nas rotas de autenticação: `turnstile` ou `hcaptcha`. Não definida significa sem captcha. | — |
| `CAPTCHA_SECRET` | O segredo do provedor, usado no servidor para verificar o token enviado pelo navegador. Obrigatório caso `CAPTCHA_PROVIDER` esteja configurado. | — |
| `CAPTCHA_ROUTES` | Lista separada por vírgulas das rotas de autenticação a serem protegidas (por exemplo `register,login`). Não definida protege o conjunto padrão do provedor. | — |

### Armazenamento (Storage)

:::caution[O armazenamento não possui segurança a nível de linha (RLS), portanto requer um modelo de acesso]
As coleções são protegidas pelo RLS do Postgres. O armazenamento de objetos não tem equivalente —
as chaves compartilham um namespace plano único — portanto, com um bucket configurado e nenhum modelo de acesso,
o servidor **se recusa a iniciar em produção**. Atenda a esse requisito com exatamente um dos seguintes:
um hook `storageAuthorize` exportado de `config/index.ts` (o que vem por padrão no scaffold),
`STORAGE_PUBLIC_READ`, ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend de armazenamento: `local`, `s3` ou `gcs`. Em produção, `local` desativa o armazenamento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Caminho base para armazenamento local. Um caminho relativo é lido a partir do diretório onde o servidor roda: a raiz do projeto em `rebase dev`, `backend/` em um servidor gerado via `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite armazenamento local em produção — apenas com um volume persistente mantendo `STORAGE_PATH` e os diretórios `<STORAGE_PATH>__<key>` dos buckets locais nomeados ao lado | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante os quais a URL de download de um arquivo privado é válida — o token que `getSignedUrl()` inclui nela. Máximo de `604800` (uma semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Tamanho máximo de arquivo aceito pela fonte, em bytes, para todas as rotas de upload — `__<KEY>` para uma fonte nomeada. Valores que não forem um número inteiro de bytes impedem a inicialização | `52428800` (50 MB) |
| `S3_BUCKET` | Nome do bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Região AWS | — |
| `S3_ACCESS_KEY_ID` | Chave de acesso AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chave secreta AWS | — |
| `S3_ENDPOINT` | Endpoint customizado do S3 (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Força URLs no estilo path-style para o bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome do bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projeto GCP. Geralmente inferido a partir das credenciais. | — |
| `GCS_KEY_FILENAME` | Caminho para o arquivo de chave da service account. Omita no GCP, onde o Workload Identity fornece as credenciais. | — |
| `STORAGE_PUBLIC_READ` | Disponibiliza todos os objetos publicamente para qualquer um, sem token. Apenas para buckets que atuam genuinamente como CDN pública. Uma das três maneiras de satisfazer a proteção de inicialização citada acima. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite que qualquer usuário autenticado leia, escreva, liste e exclua todos os objetos. Chamado de `INSECURE` no objeto de configuração por uma razão: só é justificável em uma aplicação single-tenant onde todas as contas têm permissão sobre todos os arquivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Armazena em cache rendições de imagens geradas (redimensionamentos, conversões de formato) em vez de processá-las a cada requisição. | `false` |

### E-mail (Opcional)

| Variável | Descrição |
|----------|-------------|
| `SMTP_HOST` | Host do servidor SMTP |
| `SMTP_PORT` | Porta do servidor SMTP |
| `SMTP_SECURE` | Habilitar conexão segura (`true`/`false`) |
| `SMTP_USER` | Usuário SMTP |
| `SMTP_PASS` | Senha SMTP |
| `SMTP_FROM` | Endereço de envio para e-mails do sistema |
| `SMTP_NAME` | Nome de exibição no endereço de envio |
| `APP_NAME` | Nome do produto usado nos assuntos e corpos dos e-mails (padrão: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo exibida no topo dos modelos de e-mail padrão. PNG ou JPG absoluto `http(s)` — clientes de e-mail removem SVG e bloqueiam URIs `data:`. Se não definida, um app ainda chamado `Rebase` recebe a marca do Rebase e um app renomeado não recebe nenhuma |

### Pool de conexões com o banco de dados

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `DB_POOL_MAX` | Número máximo de conexões no pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milissegundos em que uma conexão ociosa é mantida | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milissegundos a aguardar por uma conexão | `10000` |
| `DATABASE_DIRECT_URL` | Conexão direta (sem pooler intermediário). O recurso de [Realtime](/docs/backend/realtime) requer uma: `LISTEN`/`NOTIFY` não sobrevive a um pooler de transação como o PgBouncer, e sem isso as notificações de alteração são desativadas com um aviso em vez de serem perdidas silenciosamente. O [job worker](/docs/backend/jobs) também mantém seu `LISTEN` de ativação por meio dela. Preenche o `directConnectionString` do adaptador do Postgres caso não esteja configurado. | — |
| `DATABASE_READ_URL` | Réplica de leitura, como um hot standby. Quando aponta para outro servidor, leituras autenticadas (listagens, linhas únicas, contagens, agregações) são atendidas por ela sob a mesma segurança em nível de linha (RLS); escritas, autenticação, realtime, crons, jobs, o console SQL e `rebase.sql` continuam no banco primário. Um leitor que acabou de escrever continuará lendo do primário por `REBASE_READ_STICKY_MS`, e todos o farão enquanto a réplica estiver com atraso superior a `REBASE_READ_MAX_LAG_MS` ou em falha. Preenche o `readConnectionString` do adaptador Postgres quando não configurado; até a versão 0.28, o pool da réplica era aberto e nunca lido. | — |
| `REBASE_READ_STICKY_MS` | Após uma escrita, tempo durante o qual as leituras do mesmo usuário continuam sendo direcionadas ao primário, de modo que salvar seguido de uma listagem mostre o dado salvo. Por instância de servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Limite de atraso (lag) da réplica a partir do qual todas as leituras são enviadas ao primário. | `1000` |
| `DATABASE_POOLED` | `true` quando `DATABASE_URL` passa por um pooler em modo de transação, como o PgBouncer. O pool então não envia `search_path` ou `statement_timeout` na conexão (o pooler recusaria ou descartaria) e define ambos em cada transação; a inicialização define para a role do banco um `search_path` padrão como `public` para instruções fora de transações. `DATABASE_DIRECT_URL` torna-se obrigatória, e realtime, ativação de job workers, criação de índices, branching e o console SQL usam-na diretamente. Assume-se que a URL da réplica também utilize pooler. Use `DATABASE_POOLED__<KEY>` para outra fonte de dados. | — |
| `REBASE_DB_POOL_MAX` | Teto global para todos os pools no processo, aplicado independentemente do solicitado individualmente por cada um. Apenas dígitos puros: um valor malformatado é ignorado em vez de serializar o servidor silenciosamente. | — |

### Comportamento do runtime

Lido pelo runtime — `rebase dev`, `rebase start` e a imagem de servidor
publicada. Um projeto que foi ejetado gerencia essas decisões diretamente em seu próprio código.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` executa a [auditoria de row-level-security](/docs/rls-check#running-it-on-a-schedule) agendada, que reporta tabelas servidas sem policies. O projeto deve declarar `@rebasepro/rls-check` em suas dependências: o runtime não traz uma cópia embutida, e sem o pacote a inicialização será abortada indicando o erro. `false` mantém a varredura desativada neste processo. | — |
| `REBASE_BASE_PATH` | Caminho base para todas as rotas da API. O cliente deve ser configurado com o mesmo valor — veja [Alterando `basePath`](#changing-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve os assets estáticos/admin do bundle a partir deste processo. Desative se houver uma CDN à frente. | `true` |
| `REBASE_HISTORY` | Registra o [histórico de alterações de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respostas compactadas com gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Tamanho máximo do corpo da requisição, **em bytes** (`10485760`, não `10MB` — um valor que não seja número recusa a inicialização em vez de remover o limite silenciosamente). `0` desativa o limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Superfície da OpenAPI. Tri-state: não definida significa ativada em desenvolvimento, desativada em produção; `false` desativa em qualquer ambiente. Note que `true` em produção serve a **especificação** em `/api/docs`, mas não a **interface (UI)** do Swagger em `/api/swagger` — a interface depende separadamente de `NODE_ENV`. | — |
| `REBASE_METRICS` | Expõe métricas Prometheus em `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Adiciona `includeSubDomains` ao cabeçalho `Strict-Transport-Security`, fazendo com que os navegadores recusem HTTP puro em todos os subdomínios do host por seis meses — incluindo hosts não servidos por este processo. Ative apenas quando todos os subdomínios do domínio forem estritamente HTTPS. Qualquer valor diferente de `true`/`false` impede a inicialização. Veja [Cabeçalhos de segurança](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token para proteger o endpoint `/metrics`. Não definido deixa o endpoint aberto a qualquer um com acesso à porta — aceitável em rede privada, mas inadequado em rede pública, e os logs de boot alertam sobre isso. | — |
| `REBASE_MIGRATE_ON_BOOT` | O que o runtime pode fazer no esquema das coleções durante a inicialização. `ensure` (o padrão em todos os ambientes — incluindo produção) executa o passo **aditivo**: cria tabelas, colunas e tipos enum ausentes, nunca descartando ou reescrevendo nenhum. `none` não toca no esquema das coleções, mas as tabelas do próprio framework (auth, API keys, jobs, cron) continuam sendo criadas e atualizadas; `REBASE_PROVISION=false` também as desativa. A imagem publicada aceita apenas essas duas opções e **se recusa a iniciar com `push`**. Em uma [implantação dividida (split deployment)](/docs/deployment/split-processes), exatamente um processo pode provisionar, então todas as outras roles devem definir `none` para não falhar a inicialização. | `ensure` |
| `REBASE_PROVISION` | `false` faz com que o runtime não altere nada no banco de dados: nenhuma tabela, coluna, índice, função, trigger, policy, role ou grant, na inicialização ou posteriormente, incluindo os do próprio framework. Em vez disso, ele lista nominalmente o que estiver faltando. Para bancos de dados onde apenas seu processo de migração/deploy tem permissão de mudança. Veja [Quando apenas seu processo de mudança pode alterar o banco de dados](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Apenas `true` e `false` são aceitos. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Recusa a inicialização se o banco de dados foi provisionado pela última vez a partir de um conjunto de coleções diferente daquele com o qual este processo foi construído. Não definido (ou qualquer valor diferente de `true`/`1`) apenas emite um aviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Recusa a inicialização se um arquivo de função ou cron lançar exceção ou falhar no parse durante a importação, nomeando cada arquivo e a razão, permitindo que um deploy em rolling release mantenha a versão antiga ativa. O mesmo critério se aplica a reinicializações. Não definido (ou qualquer valor diferente de `true`) ignora o arquivo problemático e serve o restante. Um arquivo importado com sucesso que não exporta função ou job é sempre ignorado, sem recusa de boot. | skip |
| `REALTIME_CDC` | Captura de alterações a nível de banco de dados (CDC): `auto` (habilita onde a conexão suportar, fallback silencioso caso contrário), `trigger` (força o uso, alerta se impossível), `wal` (lê alterações a partir do write-ahead log em vez de triggers; requer `wal_level=logical` e role com permissão de replicação, fallback para `trigger` caso contrário), `off`. Veja [Realtime](/docs/backend/realtime-cdc/). Tem precedência sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instâncias para canais de broadcast e presence: `memory` ou `postgres`. Ignorado caso um transporte customizado tenha sido passado para `realtime.bus`. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Quantas inscrições um socket realtime pode manter; requisições excedentes são recusadas com `TOO_MANY_SUBSCRIPTIONS`. Um número inteiro positivo — qualquer outro valor encerra o servidor na inicialização. Tem precedência sobre `realtime.maxSubscriptionsPerSocket`. Veja [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Quantos sockets realtime um único usuário, ou uma API key, pode manter abertos em uma única instância do servidor. Sockets de impersonação abertos por um administrador contam na cota do próprio administrador. Conexões excedentes são recusadas no login com `TOO_MANY_SOCKETS` e o socket é encerrado (4002); o SDK tenta novamente, conectando-se assim que outro socket for fechado. Um número inteiro positivo — qualquer outro valor encerra o servidor na inicialização. Tem precedência sobre `realtime.maxSocketsPerUser`. | Sem limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tempo máximo em ms que uma alteração aguarda pelo refetch que a envia aos inscritos ativos. Um refetch aguarda por 300 ms na ausência de mudanças, e no máximo este tempo sob um fluxo constante de escritas. Um número inteiro positivo — qualquer outro valor encerra o servidor na inicialização. Tem precedência sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Por quanto tempo o total de uma inscrição de listagem grande pode ser reutilizado antes de ser recalculado, em ms; frames que reutilizam esse dado contêm `meta.totalAsOf`. Não definido, cada frame realiza a contagem. Tem precedência sobre `realtime.recountIntervalMs`. | Unset |
| `REALTIME_RECOUNT_MIN_ROWS` | O menor total anterior ao qual `REALTIME_RECOUNT_INTERVAL_MS` se aplica; listas menores têm a contagem executada a cada frame. Tem precedência sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores apontando para `localhost`/loopback sob `NODE_ENV=production`. Desativado por padrão, garantindo que um boot de produção falhe explicitamente em vez de tentar conectar a um banco inexistente. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | O que o boot faz com uma chave nas suas coleções que esta versão não reconhece: `warn`, `error` (recusa a inicialização — recomendado ativar em CI), ou `off`. Aplica-se apenas a chaves que o sistema não *reconhece*, o que geralmente é um erro de digitação ou, ocasionalmente, metadado intencional; uma chave reconhecida que mudou de lugar sempre causa erro fatal, pois o recurso correspondente ficaria silenciosamente ausente de outra forma. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` executa a etapa de migração do esquema e encerra a execução sem abrir socket — o formato ideal para um Job de migração, usando a mesma imagem e bundle do servidor que rodará a seguir. Também cria tabelas que um processo ativo criaria no primeiro uso, e não inicia crons nem filas de jobs. Um valor vazio é considerado *não definido*, evitando que `${SOMETHING}` não substituído em um arquivo compose transforme uma implantação comum em uma que apenas migra e recusa tráfego. Recusado se usado junto a `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Caminho de arquivo. Uma execução de provisionamento (`REBASE_PROVISION_ONLY=true`) escreve nele todas as alterações de esquema efetuadas, em ordem, como um script SQL para revisão e execução manual via `psql`. Linhas de dados gravadas não são incluídas. Recusado em processos que servem tráfego. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que uma máquina — um agente, um job de CI — *aplique* alterações de esquema através de `/api/admin/schema`, em vez de apenas planejar. Desativado por padrão: a credencial necessária para tal alteração é justamente a mais propensa a estar armazenada em variáveis de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo máximo de execução de uma custom function antes de sua requisição ser abortada. Mesmo controle que a opção `functionsTimeoutMs`. `0` desativa o timeout. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` faz com que uma promise rejection não tratada encerre o processo em vez de apenas logar o erro. Recomendado em orquestradores configurados para reiniciar o contêiner; desative onde um reinício for pior que um leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silencia o aviso de inicialização em plataformas identificadas pelo runtime como scale-to-zero (onde um timer disparado em uma instância ociosa acabaria não sendo executado em nenhuma). Não altera mais nada: ative quando mantiver pelo menos uma instância sempre ativa. | — |
| `TRUSTED_PROXY_HOPS` | Quantos proxies existem à frente deste servidor, permitindo que o limitador de taxa obtenha o IP real do cliente a partir do cabeçalho `X-Forwarded-For`. Padrão seguro `0`: sem proxy, confiar no cabeçalho permitiria a qualquer chamador forjar seu endereço IP. | `0` |

:::note[O provisionamento no boot é aditivo, e não uma ferramenta de migração]
A etapa de boot é executada sem supervisão humana para avaliar diffs, portanto nunca excluirá
uma coluna, restringirá um tipo de dado ou reescreverá uma tabela. É por isso que a imagem oficial recusa
`REBASE_MIGRATE_ON_BOOT=push`: um push completo calcula um diff e executaria
`DROP COLUMN` sem hesitar, e o reinício de um contêiner jamais deve ser capaz de destruir uma
coluna em produção devido a uma realocação do orquestrador.

Alterações destrutivas ou que reformulam o esquema devem ocorrer onde possam ser revisadas: `rebase db
generate` + `rebase db migrate`, ou `rebase db push` a partir do repositório local ou CI,
que simula a alteração (dry-run), recusa mudanças destrutivas sem confirmação explícita e
pode gerar um backup preventivo antes.
:::

### Implantações divididas (Split deployments)

Uma mesma imagem e bundle podem ser iniciados várias vezes, cada processo servindo
uma responsabilidade diferente do projeto. Resumidas abaixo em linhas únicas, já que esta página visa
listar todas as variáveis; o que cada combinação *carrega e gerencia* — e quais
combinações impedem o boot — está documentado em
**[Processos Divididos](/docs/deployment/split-processes)**.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_ROLE` | Qual papel este processo assume: `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescreve se *este* processo executará os timers de cron. Não definido segue o padrão da role. | — |
| `REBASE_JOB_WORKERS` | Sobrescreve se este processo executará os workers da fila de jobs. Não definido segue o padrão da role. | — |
| `REBASE_FUNCTIONS_ONLY` | Executa exclusivamente as custom functions informadas neste processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Executa todas as custom functions, exceto as informadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Para onde o processo de API encaminha requisições de funções que ele mesmo não atende. Em um `worker`, para onde suas próprias chamadas `rebase.functions` são enviadas. Uma URL `http(s)`. | — |

### Superfície MCP

Um endpoint Model Context Protocol opcional em `/mcp`, permitindo que um cliente de IA leia
e escreva neste projeto **atuando como o usuário autenticado**. Desativado por padrão, e — diferente de
outras superfícies — nenhuma `REBASE_ROLE` o ativa automaticamente: enquanto as roles definem o
formato do processo, esta opção concede credenciais a softwares de
terceiros, devendo ser uma decisão tomada explicitamente por uma pessoa em vez de herdada da
função de um contêiner.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Habilita a superfície MCP. Requer `REBASE_PUBLIC_URL`; sem ela, a superfície se recusa a inicializar e informa o motivo nos logs de boot. | `false` |
| `REBASE_PUBLIC_URL` | Origem publicamente acessível desta implantação, ex: `https://app.example.com`. A superfície MCP não pode inferi-la — extrair a origem do cabeçalho `Host` tornaria a identidade do emissor e a validação do audience de seus tokens valores definidos arbitrariamente pelo requisitante. | — |
| `REBASE_MCP_VIEW` | Caminho para a visualização MCP App personalizada do projeto (`rebase-view.html`, gerada por `rebaseMcpViewPlugin()`), servida ao Claude no lugar da visualização genérica, renderizando suas views, campos e ações customizados. Sem isso, o backend procura ao lado do frontend que ele hospeda. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite registro dinâmico de clientes via OAuth (RFC 7591), para que clientes façam autocadastro. Defina como `false` para exigir que os clientes sejam registrados previamente. | `true` |

### Edição de esquema em tempo real a partir de um bundle

Desativado a menos que `REBASE_LIVE_SCHEMA_REPOSITORY` esteja definida. Um bundle compilado não traz o
código-fonte das coleções para edição; com essas opções definidas, o editor de coleções do admin lê
os arquivos do repositório, faz commit de cada alteração diretamente nele e aplica o DDL neste
banco de dados. Exclusivo para administradores, e executado por humanos a menos que
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` autorize o contrário. Um repositório configurado sem
credencial válida impede a inicialização. Veja
[Edição de esquema em tempo real](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Repositório GitHub onde as mudanças de esquema receberão commit, no formato `owner/name`. Definir esta variável ativa o recurso. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Branch onde os commits serão aplicados. | `main` |
| `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` | Local onde o código-fonte das coleções reside dentro do repositório, relativo à raiz. | `config/collections` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Token granular (fine-grained) com permissão de leitura e escrita nos conteúdos do repositório. Defina este token ou as três variáveis `_GITHUB_APP_*`, nunca ambos. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | ID do GitHub App, para realizar commits como o aplicativo em vez de usar token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | ID de instalação do aplicativo no repositório. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Chave privada do aplicativo: PEM, PEM com quebras de linha escapadas, ou base64. | — |

### Backups

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Expressão cron para backups programados. Não definida significa que os backups automáticos estão desligados. | — |
| `BACKUP_DESTINATION` | Caminho local, ou URL no formato `s3://bucket/prefix` / `gs://bucket/prefix`. Obrigatória junto com `BACKUP_SCHEDULE`, que não roda sem ela. O comando `rebase db backup` usa `./backups` como fallback no local de execução. | — |
| `BACKUP_RETENTION_DAYS` | Remove backups com mais de N dias. Não definida ou `0` retém tudo indefinidamente. | — |
| `BACKUP_KEEP_MINIMUM` | Mantém sempre pelo menos N backups mais recentes, independentemente da retenção por dias. | — |
| `PG_DUMP_PATH` | Sobrescreve o executável `pg_dump` — deve corresponder à versão principal do servidor ou mais recente. | — |
| `PG_RESTORE_PATH` | Sobrescreve o executável `pg_restore`. | — |
| `PSQL_PATH` | Sobrescreve o executável `psql` utilizado pelo `rebase db restore --clean` para efetuar a restauração em uma única transação. | — |
| `PG_DUMPALL_PATH` | Caminho do `pg_dumpall`, caso não esteja presente no `PATH`. Sem ele — e sem as ferramentas cliente do PostgreSQL instaladas — o backup de globais falhará com erro indicando esta variável. | — |

A imagem oficial de runtime (`rebasepro/server`) inclui as ferramentas de cliente
do PostgreSQL 18, permitindo backups programados contra qualquer servidor até o Postgres 18.
Fora da imagem, instale-as manualmente (`apt-get install postgresql-client-18`,
`brew install libpq`).

Backups contêm segredos e dados pessoais (PII). Utilize um destino privado com
criptografia em repouso (encryption-at-rest).

### Entrega do bundle

Uma implantação gerenciada não empacota o código na imagem: o runtime faz o download do
bundle durante a inicialização. Estas opções determinam qual bundle baixar e como.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Caminho para um diretório de bundle já descompactado. Valor configurado localmente pelo comando `rebase start`. | — |
| `REBASE_BUNDLE_URL` | Local para baixar o arquivo do bundle quando não houver versão local. | — |
| `REBASE_BUNDLE_TOKEN` | Credencial Bearer para esse download. Trate-a como um segredo: é ela que autoriza o locatário a baixar seu próprio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Diretório onde o bundle baixado é extraído. Deve ter permissão de escrita e persistir entre o download e o boot. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionais que a imagem de runtime disponibiliza para o bundle, além dos declarados por ele mesmo. | — |

### Vínculo de recursos (Resource bindings)

Cada banco de dados, bucket e tópico declarado por um projeto em `config/resources.ts` é
vinculado por meio de variáveis de ambiente com nomes baseados nele. Os nomes base constam abaixo; um
recurso que não seja o padrão tem seu nome sufixado por `__` seguido de sua chave em maiúsculas: um bucket
chamado `media` lê `S3_BUCKET__MEDIA`. O comando `rebase status`
exibe, para cada recurso,
a variável exata que está sendo lida e se ela se encontra definida.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_DRIVER` | Pacote npm que implementa o driver de uma fonte de dados, quando não for o padrão do Postgres. Sufixado por fonte: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | String de conexão para um tópico declarado. Sufixado por tópico. | — |

### Ambiente exclusivo da CLI

Lido pelo `rebase`, não pelo servidor. Nenhuma configuração desta seção afeta a implantação.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Destino para onde comandos como `rebase api-keys`, `rebase storage` e `rebase auth reset-password` enviam a service key, seja no shell ou no `.env`. Configure caso o servidor execute de outra forma que não seja `rebase dev` neste projeto: `rebase start`, um contêiner ou outro host. Não definida, utiliza o servidor registrado pelo `rebase dev` enquanto ativo, e não envia nada caso contrário. | — |
| `REBASE_SERVICE_KEY` | A service key usada por esses comandos para autenticação, lida do `.env`: a mesma variável lida pelo servidor (veja acima). | — |
| `SERVICE_KEY` | Nomenclatura legada para essa chave. Quando definida no `.env`, os comandos `rebase api-keys` e `rebase storage` a utilizam no lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Arquivo `.env` alternativo que a CLI deve ler e escrever, caso não seja o do próprio projeto. | — |
| `REBASE_ROOT_RULES` | `0` impede que `rebase init` e `rebase skills install` escrevam as regras do projeto nos arquivos `CLAUDE.md` e `AGENTS.md` na raiz do repositório, ideal para projetos onde esses arquivos são mantidos manualmente. | on |
| `REBASE_CLOUD_URL` | Endpoint da camada de controle (control plane) com a qual o comando `rebase cloud` se comunica. | — |
| `REBASE_CLOUD_EMAIL` | Conta usada para login em `rebase cloud login`, evitando solicitação interativa no terminal. | — |
| `REBASE_CLOUD_PASSWORD` | Senha correspondente, permitindo que um cofre de segredos a forneça sem expô-la no histórico do shell. | — |
| `REBASE_TOKEN` | Token gerado via `rebase cloud tokens create`. Quando definido, qualquer comando `rebase cloud` é autenticado com ele no lugar da sessão de `rebase cloud login`, sem ler nem gravar a sessão armazenada. Em diretórios vinculados via `rebase cloud init --claim`, ele é reservado ao token do próprio projeto quando não possui escopo suficiente. Forma ideal de rodar `rebase cloud` no CI — veja [CI e agentes](/docs/deployment/cloud/#ci-and-agents). O [servidor MCP](/docs/ai/mcp/) repassa esta variável para a CLI instanciada por suas ferramentas na nuvem e nunca a repassa à aplicação: use `REBASE_API_TOKEN` para essa finalidade. | — |
| `REBASE_DEBUG` | `1` exibe o erro interno detalhado e os dados completos da requisição em vez da mensagem resumida. Primeira variável a ser ativada quando um comando `rebase cloud` falhar sem detalhes úteis. | — |
| `REBASE_ATLAS_DEV_URL` | Banco de dados vazio contra o qual comandos como `rebase db push`, `db generate` e `db migrate` planejam alterações, em vez do `<db>_dev_diff` criado ao lado de `DATABASE_URL`. O Rebase não cria nem apaga bancos configurados aqui, e recusa valores iguais a `DATABASE_URL`. No banco de desenvolvimento gerenciado, a CLI o configura para uma instância descartável interna em memória via PGlite. Defina onde privilégios de `CREATE DATABASE` não estiverem disponíveis. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` não inicializa nenhum banco de dados nem provisiona nada — você fornece a própria infraestrutura. Equivalente à flag `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixa a porta do servidor de desenvolvimento do frontend, que normalmente o `rebase dev` infere a partir do caminho do projeto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo máximo de espera do `rebase dev` para que o backend sinalize inicialização concluída antes de reportar falha. `0` desativa o alerta. | `30000` |
| `DATABASE_PASSWORD` | Senha injetada por `rebase dev --docker` na string de conexão derivada do `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convenção universal entre ferramentas. Definida com qualquer valor exceto `0`, a CLI desativa o envio de telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | O mesmo comportamento, específico para o Rebase. Não requer arquivo, sendo a opção recomendada para uso em CI e imagens Docker. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Endpoint para onde a telemetria deve ser encaminhada, caso utilize um coletor próprio (self-hosted). | — |

## Segredos em desenvolvimento

`JWT_SECRET` é obrigatória em produção. Ela e `REBASE_SERVICE_KEY` são
geradas automaticamente fora desse ambiente, permitindo iniciar o desenvolvimento sem configuração prévia.

Esses valores gerados são armazenados em cache no arquivo `.rebase-dev-secrets.json`, ao lado de
`.rebase-dev-port` e `.rebase-dev-url`, sendo ignorados pelo git juntamente com eles. Anteriormente,
eram recalculados a cada inicialização — o que causava logout da sua
própria aplicação após reiniciar o servidor dev e invalidava qualquer API key recém-criada.

- Defina qualquer uma das variáveis explicitamente e seu valor será usado; nada será armazenado ou lido do cache.
- Redirecione o cache para outro caminho através de `REBASE_DEV_SECRETS_FILE` — aceita um caminho de arquivo, sendo
  a única variável desta seção criada para ser configurada manualmente.
- Exclua o arquivo para alternar (rotacionar) ambos os segredos. O próximo boot gravará um novo arquivo com valores renovados.
- Caso o arquivo não possa ser gravado — em um contêiner somente leitura, por exemplo —, o servidor inicia
  normalmente utilizando um segredo efêmero, mantendo o comportamento anterior.

Nenhum valor é mantido em cache em produção ou sob executores de teste. Em produção,
nada é gerado automaticamente: um boot sem `JWT_SECRET` falhará indicando o nome da variável ausente,
mantendo este comportamento estrito:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objeto de Configuração do Backend

O objeto `RebaseBackendConfig` passado para `initializeRebaseBackend()` fornece controle programático completo:

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

As mesmas opções,
sem `app`, `server` e `basePath` e exigindo `provision`, constroem um
backend que não expõe nada até ser montado: `createRebaseBackend`. Veja
[Integração com Servidor Customizado](/docs/backend/custom-server/).

### Alterando `basePath`

O `basePath` realoca todas as rotas da API; portanto, o cliente deve ser informado da mesma alteração —
caso contrário, continuará enviando requisições para `/api/...` e recebendo erros 404 em tudo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

O painel administrativo obtém essa informação diretamente da instância de cliente fornecida; nada mais requer
configuração. Se montar a URL da requisição manualmente, concatene-a a partir do cliente em vez
de escrever `/api` no código:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solução de Problemas

### Permissão Negada no Editor SQL (`permission denied for table <name>`)

* **Sintomas:** Consultas customizadas executadas no editor SQL do Rebase Studio falham com o erro `cause: error: permission denied for table <name>`, mesmo que a visualização estilo planilha do CMS carregue os dados sem problemas.
* **Causa:** Por padrão, o Rebase tenta executar consultas do Editor SQL alternando temporariamente as roles do banco de dados para corresponder à role da aplicação do usuário ativo (ex: `SET LOCAL ROLE "admin"`). Se estiver usando autenticação personalizada onde as roles existem apenas em tabelas e não como roles reais do PostgreSQL, a troca de role falha ou as permissões de banco estarão ausentes. A visualização de planilha do CMS roda sob o usuário padrão proprietário da conexão, ignorando essa checagem.
* **Solução:** Adicione `DISABLE_DB_ROLE_SWITCHING=true` à configuração `.env` do backend. Isso força o Rebase a executar as consultas do Editor SQL com os privilégios do proprietário da conexão (geralmente superuser/owner). O Editor SQL exibirá, acima dos resultados, que os dados foram lidos como o dono da conexão e desativará o seletor de roles.

### Falha ao Carregar Esquema no Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Sintomas:** O Studio falha ao carregar a árvore de esquemas ou o Editor SQL lança `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** O Rebase requer privilégios administrativos para consultar catálogos de sistema do banco de dados e executar comandos administrativos. Se `adminConnectionString` não for fornecida ao inicializador (bootstrapper), ou se `getAdmin()` for sobrescrito para retornar `undefined`, essas operações falharão.
* **Solução:** Garanta que `adminConnectionString` esteja devidamente configurada durante a inicialização do bootstrapper do backend:
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
