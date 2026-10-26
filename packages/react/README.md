# @franyerhiguerey/ai-chat-react

A React wrapper for the [`<ai-chat>` widget](../widget). React 18 or newer. Install the widget next to it: it's a peer dependency, so your app controls its version.

```tsx
import { AiChat } from '@franyerhiguerey/ai-chat-react';

export function Chat() {
  return (
    <AiChat
      endpoint="/api/chat"
      name="Your Brand"
      lang="es"
      style={{ '--chat-brand': '#C2410C' }}
      config={{ starters: { es: ['¿Qué ofrecen?'], en: ['What do you offer?'] } }}
      onMessage={(message) => console.log(message)}
    />
  );
}
```

Props mirror the widget's attributes (`maxChars` is `max-chars`), plus `config`, `className`, `style` and the `onOpen`, `onClose`, `onMessage` and `onError` handlers. Pass `open` to control the panel; leave it out to let the widget manage itself.

It works with server rendering: the server outputs a plain `<ai-chat>` tag, and the widget registers in the browser on mount. The build carries `'use client'` for the Next.js app router. Keep `config` stable (a constant or `useMemo`) to avoid re-rendering the welcome screen.
