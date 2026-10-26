# @franyerhiguerey/ai-chat-client

The browser client for an [ai-chat](https://github.com/FranyerHiguerey/ai-chat) endpoint, with zero dependencies. The `<ai-chat>` widget uses it; you only need it directly to build your own UI.

```ts
import { streamChat, submitLead } from '@franyerhiguerey/ai-chat-client';

for await (const event of streamChat({ endpoint: '/api/chat', messages, lang: 'es' })) {
  if (event.type === 'delta') append(event.text);
  else if (event.type === 'card')
    showCard(event); // items, handoff, lead_form
  else if (event.type === 'suggestions') showChips(event.items);
  else if (event.type === 'error') showError(event.message);
}

await submitLead({ endpoint: '/api/chat', lead: { name: 'Ana', email: 'ana@example.com' } });
```

Every failure arrives as one `error` event, and unknown events are skipped, so newer servers don't break older clients. The events are listed in [docs/protocol.md](https://github.com/FranyerHiguerey/ai-chat/blob/main/docs/protocol.md).
