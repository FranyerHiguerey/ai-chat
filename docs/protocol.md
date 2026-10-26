# ai-chat protocol (v1)

The browser and the site's server talk over one endpoint, usually `POST /api/chat`. The server holds the API key; the browser never talks to the model provider directly.

`@franyerhiguerey/ai-chat-client` implements the browser side (`streamChat()`); `createChatHandler()` in `@franyerhiguerey/ai-chat-core` implements the server side. You only need this document to write your own client.

## Request

```http
POST /api/chat
Content-Type: application/json
Accept: text/event-stream

{
  "messages": [
    { "role": "user", "content": "¿Cuál es el pedido mínimo?" },
    { "role": "assistant", "content": "Depende del producto..." },
    { "role": "user", "content": "¿Y para frascos?" }
  ],
  "lang": "es"
}
```

- `messages`: the whole conversation as plain text. It starts and ends with `user` and alternates roles. The server is stateless, so the client keeps the history and sends it every turn.
- `lang` (optional, `"es"` or `"en"`): the UI language. Fixed replies and error messages use it. The model replies in whatever language the visitor writes in. An unsupported value falls back to the site's default language.

Limits come from the site config (`limits`): characters per message (default 2,000) and per conversation (20,000), user turns per conversation (20), and body size (100 KB).

**Cross-origin use.** The widget normally calls an endpoint on its own site. To embed it on another origin, list that origin in `allowedOrigins`; the endpoint then answers the CORS preflight (`OPTIONS`) and adds `Access-Control-Allow-Origin` to every response for that origin.

## Errors before the stream opens

Rejected requests never reach the model, so they cost nothing. They return JSON, not a stream:

| Status | `error.code`         | Meaning                                                                                           |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------- |
| 400    | `invalid_request`    | Not JSON, wrong shape, roles don't alternate, or an empty message                                 |
| 400    | `message_too_long`   | A message is over `limits.maxMessageChars`, or all messages together over `maxConversationChars`  |
| 400    | `too_many_turns`     | More than `limits.maxTurns` user turns: start a new conversation                                  |
| 403    | `forbidden_origin`   | The page's `Origin` is not the endpoint's own and not in `allowedOrigins`                         |
| 405    | `method_not_allowed` | Not a POST                                                                                        |
| 413    | `message_too_long`   | The body is over `limits.maxBodyBytes`                                                            |
| 429    | `rate_limited`       | Too many requests from this visitor or from everyone. `Retry-After` says how many seconds to wait |
| 500    | `internal`           | The server is misconfigured (for example, the knowledge folder is missing)                        |
| 503    | `unavailable`        | The site's daily token budget is spent. New chats work again the next UTC day                     |

`forbidden_origin` and the 400s are final: retrying the same request won't help. `rate_limited` and `unavailable` are temporary.

```json
{
  "error": {
    "code": "message_too_long",
    "message": "El mensaje es demasiado largo. Intenta resumirlo."
  }
}
```

`message` is localized and safe to show to the visitor.

## The stream

A `200` response is `text/event-stream`. Each event is one SSE frame with a JSON `data` line:

```
event: start
data: {"id":"5b0c…","protocol":1}

event: delta
data: {"text":"Para frascos, el pedido "}

event: delta
data: {"text":"mínimo es de **3.000 unidades**."}

event: done
data: {"finishReason":"stop"}
```

| Event     | Data                                                           | What the UI should do                                                                                                      |
| --------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `start`   | `id`, `protocol`                                               | Sent right away. Show the typing indicator                                                                                 |
| `delta`   | `text`                                                         | Append to the reply. The text is **markdown**, so render it safely (M3)                                                    |
| `replace` | `text`                                                         | Throw away everything streamed so far and show this text. Sent after a refusal: the partial answer must not stay on screen |
| `done`    | `finishReason`: `stop`, `max_tokens` or `refusal`              | The reply is complete. On `max_tokens` it was cut off by the length limit                                                  |
| `error`   | `code`: `rate_limited`, `unavailable` or `internal`; `message` | The reply failed. Show `message` (already localized) and offer Retry                                                       |

The stream also carries `: ping` comment lines every 15 seconds so proxies don't close an idle connection. SSE parsers ignore them.

A stream always ends with exactly one `done` or `error`. If the connection closes without either, treat it as a network error. `streamChat()` reports it as `error` with code `network`.

**Stopping.** To stop a reply, abort the request (close the connection). The server then aborts the model call, so no more tokens are paid for. The stream just ends, with no `error` event.

**Retrying.** Send the same `messages` again. The server is stateless, so a retry is just a new request.

## Forward compatibility

Clients must ignore events they don't recognize. New features add new events and never change existing ones; a breaking change would raise `protocol` in `start`.

Planned for M4 (not sent yet):

| Event         | Data                                                                 | Purpose                                                        |
| ------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| `suggestions` | `items: string[]`                                                    | Reply chips after an answer                                    |
| `card`        | `kind: "product" \| "whatsapp" \| "lead_form"`, plus fields per kind | Product cards, the WhatsApp handoff card, the inline lead form |
| `lead_saved`  | `ok`                                                                 | The lead form was delivered to the site's webhook              |
