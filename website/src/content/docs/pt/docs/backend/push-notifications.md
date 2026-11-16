---
sourceHash: bcfb0bd417433447
title: Notificações push
sidebar_label: Notificações push
description: Web Push para os navegadores dos seus usuários — Chrome, Firefox, Edge e Safari no iPhone, iPad e Mac — enviados a partir de funções e cron jobs com rebase.push.
---

## Visão geral

<span class="since-badge" data-since="0.32">A partir de 0.32</span>

O Web Push exibe uma notificação na tela de bloqueio ou na área de trabalho do usuário enquanto o seu aplicativo está fechado. O Rebase cuida do lado do servidor: ele armazena a inscrição de cada navegador, assina as mensagens com suas chaves VAPID, as criptografa para que apenas aquele navegador possa lê-las e remove os navegadores que cancelaram a inscrição.

Ele funciona em qualquer navegador que ofereça suporte à Push API: Chrome e Android, Firefox, Edge e Safari no macOS, iPadOS e iOS. No iOS e iPadOS, o aplicativo web deve ser adicionado à Tela de Início primeiro.

São necessárias três partes:

1. O servidor ativa o push e possui um par de chaves.
2. O navegador registra um service worker e se inscreve por meio do SDK.
3. O código do seu servidor envia com `rebase.push`.

## Ativando

O push fica desativado até que você o ative.

:::note[Onde isso é configurado]
**Ambiente gerenciado** — `REBASE_PUSH=true` no `.env`.

**Ejetado** — `push: true` em `initializeRebaseBackend({ … })`.
:::

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";

await initializeRebaseBackend({
    app,
    server,
    // …
    push: true
});
```

Isso cria a tabela `rebase.push_subscriptions` na inicialização e monta as rotas sob `/api/push`.

### Chaves

<span class="since-badge" data-since="0.32">A partir de 0.32</span>

Um navegador se inscreve com a chave pública do seu servidor e só aceita mensagens assinadas com a chave privada correspondente. Defina o par e um endereço de contato pelo qual os serviços de push possam entrar em contato com você:

```bash
REBASE_VAPID_PUBLIC_KEY=BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U
REBASE_VAPID_PRIVATE_KEY=UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls
REBASE_VAPID_SUBJECT=mailto:ops@example.com
```

Gere um par uma única vez com `npx web-push generate-vapid-keys` e guarde-o. Se você alterar as chaves, todas as inscrições existentes deixarão de receber mensagens; cada navegador terá que se inscrever novamente, o que o `client.push.subscribe()` faz automaticamente na próxima vez em que for executado.

`REBASE_VAPID_SUBJECT` é um endereço `mailto:` ou uma URL `https://`. A Apple recusa mensagens sem um valor válido. Se não for definido, a origem de `REBASE_PUBLIC_URL` será usada quando for `https`.

**No ambiente de desenvolvimento**, você pode ignorar tudo isso. Se nenhuma chave for definida, o servidor gera um par, mantém-no em `.rebase-dev-secrets.json` para que as inscrições sobrevivam a uma reinicialização e registra uma linha no log informando isso. **Em produção**, nada é gerado. O push permanece desativado, o log de inicialização informa as variáveis que devem ser definidas, `/api/push/*` responde com `503 PUSH_NOT_CONFIGURED`, e qualquer envio lança a mesma mensagem de erro.

## No navegador

### O service worker

O navegador entrega a mensagem push ao seu service worker, que decide o que exibir. Coloque este arquivo na raiz do seu site, como `public/sw.js` em um aplicativo Vite:

```javascript no-verify
// sw.js — shows what the server sent, and opens its url when tapped.
self.addEventListener("push", (event) => {
    const data = event.data ? event.data.json() : {};
    event.waitUntil(self.registration.showNotification(data.title ?? "", {
        body: data.body,
        icon: data.icon ?? "/icon-192.png",
        tag: data.tag,
        data: { url: data.url ?? "/" }
    }));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(self.clients.openWindow(event.notification.data.url));
});
```

O payload é o que o seu servidor tiver enviado. Este worker lê `title`, `body`, `icon`, `tag` e `url`. Exiba uma notificação para cada push: os navegadores podem revogar a permissão de um site que recebe pushes e não exibe nada.

### Inscrevendo-se

Com um usuário autenticado, registre o worker e faça a inscrição. Chame `subscribe()` a partir de um clique, pois o Safari só solicita permissão a partir de um gesto do usuário:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "https://api.example.com" });

await navigator.serviceWorker.register("/sw.js");

async function turnOnNotifications() {
    if (!client.push.isSupported()) return;
    const { id } = await client.push.subscribe({ lang: "es" });
    console.log("this browser is subscription", id);
}
```

`subscribe()` solicita permissão, busca a chave pública do servidor, inscreve o navegador e o registra sob o usuário autenticado. `lang` é opcional e tem como padrão `navigator.language`. O servidor o devolve a você quando monta a mensagem de cada navegador. Chamá-lo novamente é seguro: ele atualiza a mesma inscrição e substitui uma feita com uma chave antiga.

Ele lança `RebaseClientError` com um destes códigos:

| Código | Significado |
|--------|-------------|
| `PUSH_UNSUPPORTED` | O navegador não oferece suporte à Push API. `isSupported()` informa isso antecipadamente. |
| `PUSH_PERMISSION_DENIED` | O usuário bloqueou as notificações para o site. Apenas as configurações de site do navegador podem reverter isso. |
| `PUSH_NO_SERVICE_WORKER` | Nenhum service worker está registrado e nenhum foi passado como `registration`. |
| `PUSH_NOT_CONFIGURED` | Do servidor: o push está desativado nele ou não possui chaves configuradas. |

Para interromper as notificações neste navegador:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "https://api.example.com" });

await client.push.unsubscribe();
const subscription = await client.push.getSubscription(); // null now
```

## Enviando

`rebase.push` está disponível em functions, cron jobs, table hooks e job handlers, assim como `rebase.email`.

```typescript
import { defineCron, rebase } from "@rebasepro/server";

export default defineCron({
    schedule: "0 9 * * *",
    name: "Morning nudge",
    async handler() {
        const result = await rebase.push.sendToUser("user-123", {
            title: "Your daily puzzle is ready",
            body: "Tap to play",
            url: "/daily"
        }, { tag: "daily", ttl: 4 * 60 * 60 });
        return `sent ${result.sent}, removed ${result.removed}, failed ${result.failed}`;
    }
});
```

`sendToUser` envia para todos os navegadores nos quais o usuário ativou as notificações. `sendToSubscriptions(ids, payload, options)` envia para os navegadores especificados pelo ID de inscrição. Ambos resolvem com o resultado da operação:

| Campo | Significado |
|-------|-------------|
| `sent` | Aceito pelo serviço de push do navegador. |
| `removed` | O serviço de push respondeu 404 ou 410: o navegador cancelou a inscrição ou a inscrição expirou. O registro correspondente é excluído. |
| `failed` | Qualquer outro caso: limite de taxa (rate limit), erro do serviço de push, problema de rede. O registro é mantido e a falha é registrada em log. |

O envio é resolvido assim que todos os serviços de push tiverem respondido, portanto, use `await` quando o resultado for importante, ou passe-o para `waitUntil` em uma função para responder à requisição primeiro.

### Uma mensagem no idioma de cada navegador

Passe uma função em vez de um objeto, e ela será chamada uma vez para cada navegador com a respectiva inscrição:

```typescript
import { rebase } from "@rebasepro/server";

const words: Record<string, { title: string; body: string }> = {
    en: { title: "Ada is asking you to a game", body: "Tap to join" },
    es: { title: "Ada te invita a una partida", body: "Toca para unirte" }
};

await rebase.push.sendToUser("user-123", (subscription) => ({
    ...(words[subscription.lang ?? "en"] ?? words.en),
    url: "/join?room=ABCD"
}), { urgency: "high", ttl: 30 * 60, topic: "invite-ada", tag: "invite-ada" });
```

### Opções

| Opção | Padrão | Significado |
|-------|--------|-------------|
| `ttl` | `86400` | Segundos que o serviço de push continuará tentando alcançar um navegador offline. `0`: agora ou nunca. No máximo quatro semanas. |
| `urgency` | `"normal"` | `"very-low"`, `"low"`, `"normal"` ou `"high"`. Celulares em modo de economia de bateria podem reter qualquer prioridade abaixo de `"high"`. |
| `topic` | — | Uma mensagem mais recente com o mesmo tópico substitui uma que o serviço de push ainda não entregou. Até 32 caracteres contendo `A-Z a-z 0-9 - _`. |
| `tag` | — | Adicionado ao payload como `tag`. O service worker acima o repassa para `showNotification`, de modo que uma notificação mais recente substitua uma mais antiga com a mesma tag no dispositivo. |

O payload pode ter no máximo 3993 bytes em formato JSON, o limite do Web Push. Um tamanho maior lança um erro antes que algo seja enviado, assim como uma opção inválida.

### Quem está com as notificações ativadas

```typescript
import { rebase } from "@rebasepro/server";

const browsers = await rebase.push.subscriptionsOf("user-123");
// [{ id, userId, endpointHost: "web.push.apple.com", lang: "es", createdAt, lastSentAt }]
```

`endpointHost` informa qual é o navegador: `fcm.googleapis.com` para Chrome e Android, `updates.push.services.mozilla.com` para Firefox, `*.push.apple.com` para Safari, `*.notify.windows.com` para Edge.

`rebase.push.isConfigured()` retorna `false` quando o push está desativado ou não possui chaves. Verifique isso antes de enviar caso o seu código possa continuar sem o push.

## Seus próprios dados por navegador

O Rebase armazena o que precisa para entregar a mensagem e nada mais. Para configurações personalizadas por navegador, como um horário de lembrete, mantenha uma tabela indexada pelo ID da inscrição. `subscribe()` retorna esse ID no navegador, e `subscriptionsOf()` o retorna no servidor.

```typescript
// backend/schema/reminder-settings.ts
import { col, defineTable } from "@rebasepro/server/schema";

export const reminderSettings = defineTable("reminder_settings", {
    columns: {
        // the subscription id, from client.push.subscribe() or rebase.push.subscriptionsOf()
        id: col.text().primaryKey(),
        userId: col.text().notNull(),
        remindAt: col.integer().validate({ min: 0, max: 23 })
    },
    rls: [{ operations: ["select", "insert", "update", "delete"], ownerField: "userId" }],
    indexes: [{ columns: ["remindAt"], reason: "the browsers due a reminder, every hour" }]
});
```

Um cron de hora em hora lê as linhas com vencimento nesta hora e envia exatamente para esses navegadores:

```typescript
import { defineCron, rebase } from "@rebasepro/server";

export default defineCron({
    schedule: "0 * * * *",
    name: "Reminders",
    async handler(ctx) {
        const hour = (ctx.scheduledAt ?? new Date()).getUTCHours();
        const due = await rebase.dataAsAdmin.reminder_settings.findAll({ where: { remindAt: ["==", hour] } });
        const result = await rebase.push.sendToSubscriptions(due.map((row) => String(row.id)), { title: "Time to play" });
        return `sent ${result.sent}`;
    }
});
```

Quando um navegador cancela a inscrição ou seu serviço de push o descarta, seu registro em `rebase.push_subscriptions` é removido, e o `sendToSubscriptions` ignora um ID que não existe mais. O seu próprio registro permanece até que você o remova. Compare com `subscriptionsOf(userId)` ao fazer a limpeza.

## Rotas

Todas as três exigem um usuário autenticado. Chaves de API e a service key são recusadas com `403 PUSH_NEEDS_A_USER`, porque uma inscrição representa o navegador de uma pessoa. O SDK faz essas chamadas por você.

| Rota | Corpo | Resposta |
|------|-------|----------|
| `GET /api/push/key` | — | `{ key }`: a chave pública VAPID |
| `POST /api/push/subscriptions` | `{ subscription, lang? }`, onde `subscription` é `PushSubscription.toJSON()` | `{ id }` |
| `DELETE /api/push/subscriptions` | `{ endpoint }` | `{ removed }`: `false` quando quem chamou não possuía esse navegador |

Uma inscrição é armazenada sob a identificação do chamador. Se um navegador inscrito em uma conta for inscrito sob outra, ele será movido para a nova conta. O cancelamento da inscrição remove apenas o próprio navegador do chamador.

O servidor faz um POST para o endereço de cada inscrição a cada envio, portanto, aceita apenas os serviços de push que os navegadores utilizam: `fcm.googleapis.com`, `android.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com`, `*.push.apple.com` e `*.notify.windows.com`, via `https` na porta padrão. Qualquer outro endpoint é recusado com `400 PUSH_ENDPOINT_REFUSED`, impedindo que um cliente faça o seu servidor enviar requisições para um endereço interno. Para permitir outro serviço de push, como um dublê de testes local, liste-o em `push.allowedHosts`:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";

await initializeRebaseBackend({
    app,
    server,
    push: { allowedHosts: ["127.0.0.1:8443"] }
});
```

## A tabela

`rebase.push_subscriptions` possui uma linha por navegador: `id` (um hash do endpoint), `user_id`, `endpoint`, as chaves `p256dh` e `auth` do navegador, `lang`, `user_agent`, `created_at`, `updated_at` e `last_sent_at`.

O servidor a preenche. O recurso de Row-level security (RLS) limita os papéis de requisição à leitura e exclusão de suas próprias linhas (`user_id = rebase.uid()`), portanto, o [SQL executado como o chamador](/docs/backend/scripts/) enxerga os navegadores daquele usuário e de mais ninguém, não podendo realizar inserções.

## Enviando por outro mecanismo

A entrega é feita por meio de um `PushSender`: uma mensagem para um navegador, respondida com o status do serviço de push. O remetente integrado (built-in) assina, criptografa e envia a requisição com `fetch`. Para enviar por meio de um relay ou registrar mensagens em testes, passe o seu próprio:

```typescript
import { initializeRebaseBackend, type PushSender } from "@rebasepro/server";

const recorded: string[] = [];
const sender: PushSender = {
    async send(target, payload, options) {
        recorded.push(`${target.endpoint} ttl=${options.ttl} ${payload}`);
        return { statusCode: 201 };
    }
};

await initializeRebaseBackend({
    app,
    server,
    push: { sender }
});
```

`createWebPushSender(keys, subject)` do `@rebasepro/server` constrói o remetente integrado, caso queira encapsulá-lo.

## Relacionados

- [Funções personalizadas](/docs/backend/custom-functions/) e [Cron Jobs](/docs/backend/cron-jobs/): de onde `rebase.push` é chamado.
- [Background Jobs](/docs/backend/jobs/): para enviar a partir de uma fila com tentativas automáticas (retries), enfileire um job cujo handler chame `rebase.push`.
- [Verificação de e-mail](/docs/backend/email-verification/): `rebase.email`, o outro canal.
