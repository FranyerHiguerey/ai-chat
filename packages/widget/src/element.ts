import { ChatController, isRetryable, type ChatState } from './controller.js';
import { STRINGS, pickLanguage } from './i18n.js';
import { safeUrl } from './markdown.js';
import { h } from './render/dom.js';
import { icon } from './render/icons.js';
import {
  avatar,
  chipsView,
  draftView,
  errorView,
  handoffLink,
  messageView,
  renderDraft,
  startersView,
  type ErrorViewProps,
  type Handoff,
  type ViewContext,
} from './render/views.js';
import { sessionStore, type Store } from './store.js';
import { styles } from './styles.js';
import {
  localize,
  textOf,
  type ChatError,
  type Language,
  type Message,
  type Starter,
  type WidgetConfig,
} from './types.js';

/** Below this width the panel goes full screen. Keep in sync with styles.ts. */
const MOBILE_QUERY = '(max-width: 639px)';
const DEFAULT_MAX_CHARS = 2000;
const MAX_INPUT_HEIGHT = 132;

export interface AiChatEventMap {
  'ai-chat:open': CustomEvent<void>;
  'ai-chat:close': CustomEvent<void>;
  'ai-chat:message': CustomEvent<{ message: Message }>;
  'ai-chat:error': CustomEvent<ChatError>;
  /** A lead form was delivered. Carries no form data. */
  'ai-chat:lead': CustomEvent<Record<string, never>>;
}

interface UiState {
  open?: boolean;
  teaserDismissed?: boolean;
}

type Ui = ReturnType<typeof createSkeleton>;

// Lets the module load during SSR; the element only works in a browser.
const Base = (globalThis.HTMLElement ?? class {}) as typeof HTMLElement;

/**
 * `<ai-chat>`: the chat launcher and panel. Attributes: `endpoint`, `name`,
 * `avatar`, `lang`, `theme` (auto | light | dark), `status`, `open`,
 * `max-chars`, `config` (JSON) and `remote-config` (read settings from the
 * endpoint's GET; markup wins). The `config` property takes the same
 * object. See the package README.
 */
export class AiChatElement extends Base {
  static readonly observedAttributes = [
    'endpoint',
    'name',
    'avatar',
    'lang',
    'theme',
    'status',
    'open',
    'max-chars',
    'config',
    'remote-config',
  ];

  /** Replaces `fetch` for chat requests (tests, custom transports). */
  declare fetch?: typeof fetch;

  private configValue: WidgetConfig = {};
  /** Settings served by the endpoint (`remote-config`): the lowest-priority layer. */
  private remote: RemoteSettings = {};
  private remoteRequest = 0;
  private controller?: ChatController;
  private controllerEndpoint?: string;
  private unsubscribe?: () => void;
  private uiStore?: Store;
  private uiState: UiState = {};
  private lastState?: ChatState;
  private readonly ui: Ui;
  /** Each message's node, and the message it was built from: a changed message is rebuilt. */
  private readonly rendered = new Map<string, { node: HTMLElement; message: Message }>();
  private draft?: { root: HTMLElement; bubble: HTMLElement };
  private frame = 0;
  private stick = true;
  private shown = false;
  private restoring = false;
  private readonly releaseOnClose: (() => void)[] = [];

  constructor() {
    super();
    this.ui = createSkeleton();
    this.attachShadow({ mode: 'open' }).append(h('style', {}, styles), this.ui.root);
    this.wire();
  }

  get config(): WidgetConfig {
    return this.configValue;
  }

  set config(value: WidgetConfig | null | undefined) {
    this.configValue = value ?? {};
    this.render();
  }

  /** The `config` property over the endpoint's settings, key by key. */
  private get widgetConfig(): WidgetConfig {
    const { name: _name, avatar: _avatar, ...remote } = this.remote;
    return { ...remote, ...this.configValue };
  }

  /**
   * With `remote-config`, reads the widget settings the endpoint serves on GET,
   * so dashboard edits show up without touching the page. Any failure leaves
   * the widget as the markup configured it.
   */
  private loadRemote(): void {
    const request = ++this.remoteRequest;
    if (!this.hasAttribute('remote-config')) {
      this.remote = {};
      return;
    }
    const endpoint = this.getAttribute('endpoint') || '/api/chat';
    void (async () => {
      try {
        const response = await (this.fetch ?? fetch)(endpoint, {
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { widget?: unknown };
        if (request !== this.remoteRequest) return; // a newer request superseded this one
        this.remote = isObject(body.widget) ? (body.widget as RemoteSettings) : {};
        this.render();
      } catch (error) {
        console.debug('[ai-chat] remote-config unavailable:', error);
      }
    })();
  }

  get isOpen(): boolean {
    return this.hasAttribute('open');
  }

  show(): void {
    this.setAttribute('open', '');
  }

  hide(): void {
    this.removeAttribute('open');
  }

  toggle(): void {
    this.toggleAttribute('open');
  }

  /** Opens the panel and sends a message as the visitor. */
  send(text: string): boolean {
    if (!this.controller) return false;
    this.show();
    this.stick = true;
    return this.controller.send(text);
  }

  /** Clears the conversation and its saved copy. */
  reset(): void {
    this.controller?.reset();
  }

  connectedCallback(): void {
    upgradeProperty(this, 'config');
    upgradeProperty(this, 'fetch');
    this.setup();
    this.render();
    this.syncOpen(false);
  }

  disconnectedCallback(): void {
    this.release();
    this.shown = false;
    this.ui.panel.hidden = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === 'config') this.configValue = parseConfig(value) ?? this.configValue;
    if (!this.controller) return; // connectedCallback renders everything.
    if (name === 'open') return this.syncOpen(!this.restoring);
    if (name === 'remote-config') this.loadRemote();
    if (name === 'endpoint') this.setup();
    if (name === 'endpoint' || name === 'lang' || name === 'name' || name === 'avatar') {
      this.clearMessages();
    }
    this.render();
  }

  private get language(): Language {
    return pickLanguage(
      this.getAttribute('lang'),
      globalThis.document?.documentElement.lang,
      globalThis.navigator?.language,
    );
  }

  private context(): ViewContext & { lang: Language } {
    const lang = this.language;
    const strings = STRINGS[lang];
    return {
      lang,
      strings,
      name: this.getAttribute('name')?.trim() || this.remote.name || strings.assistant,
      avatar: this.getAttribute('avatar') || this.remote.avatar || undefined,
      send: (text) => {
        this.send(text);
      },
      submitLead: (messageId, lead) =>
        this.controller
          ? this.controller.submitLead(messageId, lead)
          : Promise.resolve({ ok: false, code: 'network', message: '' }),
    };
  }

  /** One conversation per endpoint, saved in sessionStorage. */
  private setup(): void {
    const endpoint = this.getAttribute('endpoint') || '/api/chat';
    if (this.controller && this.controllerEndpoint === endpoint) return;
    this.controller?.stop();
    this.unsubscribe?.();

    const key = `ai-chat:${endpoint}`;
    this.uiStore = sessionStore(`${key}:ui`);
    this.uiState = asUiState(this.uiStore.load());
    this.controllerEndpoint = endpoint;
    this.loadRemote();
    this.controller = new ChatController({
      endpoint,
      lang: () => this.language,
      store: sessionStore(key),
      fetch: (input, init) => (this.fetch ?? fetch)(input, init),
      onMessage: (message) => {
        this.ui.announcer.textContent = textOf(message);
        this.emit('ai-chat:message', { message });
      },
      onError: (error) => this.emit('ai-chat:error', error),
      // No form contents in the event: it's for analytics, which shouldn't see personal data.
      onLead: () => {
        this.ui.announcer.textContent = STRINGS[this.language].lead.sentTitle;
        this.emit('ai-chat:lead', {});
      },
    });
    this.lastState = this.controller.state;
    this.unsubscribe = this.controller.subscribe((state) => this.onState(state));
    // Reopen if this conversation was open before a reload, without taking focus.
    if (this.uiState.open && !this.isOpen) {
      this.restoring = true;
      this.setAttribute('open', '');
      this.restoring = false;
    }
  }

  /** Structural changes render now; streamed text renders once per frame. */
  private onState(state: ChatState): void {
    const last = this.lastState;
    this.lastState = state;
    const onlyDraft =
      last &&
      last.messages === state.messages &&
      last.status === state.status &&
      last.error === state.error;
    if (!onlyDraft) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.renderConversation();
      return;
    }
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.draft && this.controller) {
        renderDraft(this.draft.bubble, this.controller.state.draft, this.context().strings);
        this.scrollToEnd();
      }
    });
  }

  private wire(): void {
    const ui = this.ui;
    ui.launcher.addEventListener('click', () => this.toggle());
    ui.close.addEventListener('click', () => this.hide());
    ui.newChat.addEventListener('click', () => this.restart());
    ui.teaserText.addEventListener('click', () => this.show());
    ui.teaserClose.addEventListener('click', () => {
      this.saveUi({ teaserDismissed: true });
      ui.teaser.hidden = true;
    });
    ui.body.addEventListener('scroll', () => {
      const { scrollHeight, scrollTop, clientHeight } = ui.body;
      this.stick = scrollHeight - scrollTop - clientHeight < 32;
    });
    ui.panel.addEventListener('keydown', (event) => this.onPanelKey(event));
    ui.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit();
    });
    ui.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!this.controller?.busy) this.submit();
      }
    });
    ui.input.addEventListener('input', () => {
      this.autosize();
      this.renderSendButton();
    });
  }

  /** Send, or Stop while a reply is in progress. */
  private submit(): void {
    const controller = this.controller;
    if (!controller) return;
    const input = this.ui.input;
    if (controller.busy) {
      const question = controller.stop();
      if (question && !input.value.trim()) input.value = question;
    } else if (this.send(input.value)) {
      input.value = '';
    }
    this.autosize();
    this.renderSendButton();
  }

  private onPanelKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.hide();
      return;
    }
    // Full screen is modal: keep Tab inside the panel.
    if (event.key !== 'Tab' || !isMobile()) return;
    const focusable = [
      ...this.ui.panel.querySelectorAll<HTMLElement>('button, a[href], textarea'),
    ].filter((el) => !el.closest('[hidden]'));
    const first = focusable[0];
    const last = focusable.at(-1);
    const active = this.shadowRoot?.activeElement;
    if (event.shiftKey && (active === first || active === this.ui.panel)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  private syncOpen(userAction: boolean): void {
    const open = this.isOpen;
    if (open === this.shown) return;
    this.shown = open;
    const ui = this.ui;
    // Read before hiding: hiding the panel blurs whatever had focus.
    const hadFocus = Boolean(this.shadowRoot?.activeElement);
    ui.panel.hidden = !open;
    ui.root.toggleAttribute('data-open', open);
    this.render();
    if (open) {
      this.saveUi({ open: true, teaserDismissed: true });
      if (isMobile()) this.takeOverScreen();
      if (userAction) (isMobile() ? ui.panel : ui.input).focus();
      this.stick = true;
      this.scrollToEnd();
      this.emit('ai-chat:open');
    } else {
      this.saveUi({ open: false });
      this.release();
      if (hadFocus) ui.launcher.focus();
      this.emit('ai-chat:close');
    }
  }

  /** Mobile: lock page scroll and keep the panel above the on-screen keyboard. */
  private takeOverScreen(): void {
    const { panel } = this.ui;
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = 'hidden';
    panel.setAttribute('aria-modal', 'true');
    const viewport = window.visualViewport;
    const fit = () => {
      if (!viewport) return;
      panel.style.height = `${viewport.height}px`;
      panel.style.top = `${viewport.offsetTop}px`;
    };
    viewport?.addEventListener('resize', fit);
    viewport?.addEventListener('scroll', fit);
    fit();
    this.releaseOnClose.push(() => {
      html.style.overflow = overflow;
      panel.removeAttribute('aria-modal');
      viewport?.removeEventListener('resize', fit);
      viewport?.removeEventListener('scroll', fit);
      panel.style.removeProperty('height');
      panel.style.removeProperty('top');
    });
  }

  private release(): void {
    for (const undo of this.releaseOnClose.splice(0)) undo();
  }

  private render(): void {
    if (!this.controller) return;
    const ctx = this.context();
    const { strings, lang } = ctx;
    const ui = this.ui;
    const config = this.widgetConfig;

    ui.launcher.setAttribute('aria-expanded', String(this.isOpen));
    ui.launcher.setAttribute('aria-label', this.isOpen ? strings.closeChat : strings.openChat);
    ui.launcher.replaceChildren(icon(this.isOpen ? 'close' : 'chat'));

    const teaser = localize(config.teaser, lang);
    ui.teaserText.textContent = teaser ?? '';
    ui.teaserClose.setAttribute('aria-label', strings.dismiss);
    ui.teaser.hidden =
      !teaser ||
      this.isOpen ||
      Boolean(this.uiState.teaserDismissed) ||
      this.controller.state.messages.length > 0;

    ui.headerAvatar.replaceChildren(avatar(ctx, 'md'));
    ui.title.textContent = ctx.name;
    ui.status.textContent = this.getAttribute('status') || strings.status;
    ui.newChat.setAttribute('aria-label', strings.newChat);
    ui.newChat.title = strings.newChat;
    ui.close.setAttribute('aria-label', strings.closeChat);

    const handoff = this.handoff();
    const header = ui.handoffHeader;
    header.hidden = !handoff;
    if (handoff) {
      header.href = handoff.href;
      header.title = handoff.label;
      header.setAttribute('aria-label', [handoff.label, handoff.newTab].filter(Boolean).join(' '));
      if (handoff.newTab) {
        header.target = '_blank';
        header.rel = 'noopener noreferrer';
      } else {
        header.removeAttribute('target');
      }
    }
    ui.welcomeHandoff.replaceChildren(...(handoff ? [handoffLink(handoff, 'handoff-link')] : []));

    ui.welcomeAvatar.replaceChildren(avatar(ctx, 'lg'));
    ui.welcomeTitle.textContent = ctx.name;
    ui.welcomeText.textContent = localize(config.greeting, lang) ?? strings.greeting(ctx.name);
    ui.starters.replaceChildren(
      startersView(normalizeStarters(localize(config.starters, lang)), (starter) =>
        this.send(starter.message ?? starter.label),
      ),
    );

    ui.log.setAttribute('aria-label', strings.conversation);
    ui.input.maxLength = Number(this.getAttribute('max-chars')) || DEFAULT_MAX_CHARS;
    ui.footer.replaceChildren(icon('lock', 14), strings.poweredBy);

    this.renderConversation();
  }

  private renderConversation(): void {
    const controller = this.controller;
    if (!controller) return;
    const { messages, status, draft, error } = controller.state;
    const ctx = this.context();
    const ui = this.ui;

    ui.welcome.hidden = messages.length > 0 || status !== 'idle' || Boolean(error);
    ui.newChat.hidden = messages.length === 0;
    if (messages.length > 0) ui.teaser.hidden = true;

    const ids = new Set(messages.map((message) => message.id));
    for (const [id, { node }] of this.rendered) {
      if (!ids.has(id)) {
        node.remove();
        this.rendered.delete(id);
      }
    }
    for (const message of messages) {
      const existing = this.rendered.get(message.id);
      if (existing?.message === message) continue;
      // New, or changed (a lead form was sent): build it, in place if it existed.
      const node = messageView(message, ctx);
      if (existing) existing.node.replaceWith(node);
      else ui.log.insertBefore(node, ui.draftSlot);
      this.rendered.set(message.id, { node, message });
    }

    if (status === 'idle') {
      this.draft = undefined;
      ui.draftSlot.replaceChildren();
    } else {
      if (!this.draft) {
        this.draft = draftView(ctx);
        ui.draftSlot.replaceChildren(this.draft.root);
      }
      renderDraft(this.draft.bubble, draft, ctx.strings);
    }

    ui.errorSlot.replaceChildren(...(error ? [this.errorView(error)] : []));

    // At the turn limit only a new conversation helps: lock the input until then.
    const locked = error?.code === 'too_many_turns';
    ui.input.disabled = locked;
    ui.input.placeholder = locked ? ctx.strings.limitReached : ctx.strings.placeholder;
    ui.input.setAttribute('aria-label', ui.input.placeholder);

    // Chips belong to the latest reply and go away once the visitor moves on.
    const last = messages.at(-1);
    const chips =
      status === 'idle' && !error && last?.role === 'assistant' ? (last.suggestions ?? []) : [];
    ui.chips.setAttribute('aria-label', ctx.strings.suggestions);
    ui.chips.replaceChildren(...chipsView(chips, (text) => this.send(text)));
    ui.chips.hidden = ui.chips.childElementCount === 0;

    this.renderSendButton();
    this.scrollToEnd();
  }

  private renderSendButton(): void {
    const { strings } = this.context();
    const busy = Boolean(this.controller?.busy);
    const { send, input } = this.ui;
    send.replaceChildren(icon(busy ? 'stop' : 'send', busy ? 16 : 20));
    send.setAttribute('aria-label', busy ? strings.stop : strings.send);
    send.setAttribute('aria-disabled', String(!busy && !input.value.trim()));
  }

  private errorView(error: ChatError): HTMLElement {
    const { strings } = this.context();
    const local = (strings.errors as Record<string, string>)[error.code];
    const titles = strings.errorTitles as Record<string, string>;
    let action: ErrorViewProps['action'];
    if (error.code === 'too_many_turns') {
      action = { label: strings.newChat, primary: true, run: () => this.restart() };
    } else if (isRetryable(error.code)) {
      action = { label: strings.retry, run: () => this.controller?.retry() };
    }
    return errorView({
      code: error.code,
      title: titles[error.code] ?? titles.other ?? '',
      text: local ?? (error.message || strings.errors.bad_response),
      action,
      handoff: this.handoff(),
    });
  }

  /** The site's "Talk to a person" link, if configured with a safe URL. */
  private handoff(): Handoff | undefined {
    const { strings, lang } = this.context();
    const handoff = this.widgetConfig.handoff;
    const href = handoff && safeUrl(handoff.href);
    if (!href) return undefined;
    return {
      href,
      label: localize(handoff?.label, lang) ?? strings.talkToPerson,
      newTab: href.startsWith('http') ? strings.newTab : undefined,
    };
  }

  private restart(): void {
    this.reset();
    this.ui.input.focus();
  }

  private clearMessages(): void {
    for (const { node } of this.rendered.values()) node.remove();
    this.rendered.clear();
    this.draft = undefined;
  }

  private scrollToEnd(): void {
    const { body, panel, welcome } = this.ui;
    if (panel.hidden) return;
    // The welcome screen reads from the top.
    if (!welcome.hidden) body.scrollTop = 0;
    else if (this.stick) body.scrollTop = body.scrollHeight;
  }

  private autosize(): void {
    const { input } = this.ui;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }

  private saveUi(patch: UiState): void {
    this.uiState = { ...this.uiState, ...patch };
    this.uiStore?.save(this.uiState);
  }

  private emit(type: keyof AiChatEventMap, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

function createSkeleton() {
  const launcher = h('button', {
    type: 'button',
    class: 'launcher',
    part: 'launcher',
    'aria-controls': 'panel',
    'aria-expanded': 'false',
  });
  const teaserText = h('button', { type: 'button', class: 'teaser__text' });
  const teaserClose = h('button', { type: 'button', class: 'teaser__close' }, icon('close', 16));
  const teaser = h(
    'div',
    { class: 'teaser', part: 'teaser', hidden: true },
    teaserText,
    teaserClose,
  );

  const headerAvatar = h('span', { class: 'header__avatar' });
  const title = h('h2', { class: 'header__title', id: 'title' });
  const status = h('p', { class: 'header__status' });
  const handoffHeader = h('a', { class: 'icon-btn', hidden: true }, icon('headset'));
  const newChat = h('button', { type: 'button', class: 'icon-btn', hidden: true }, icon('restart'));
  const close = h('button', { type: 'button', class: 'icon-btn' }, icon('close'));
  const header = h(
    'header',
    { class: 'header', part: 'header' },
    headerAvatar,
    h('div', { class: 'header__titles' }, title, status),
    handoffHeader,
    newChat,
    close,
  );

  const welcomeAvatar = h('div');
  const welcomeTitle = h('h3', { class: 'welcome__title' });
  const welcomeText = h('p', { class: 'welcome__text' });
  const starters = h('div', { class: 'welcome__starters' });
  const welcomeHandoff = h('div');
  const welcome = h(
    'section',
    { class: 'welcome' },
    welcomeAvatar,
    welcomeTitle,
    welcomeText,
    starters,
    welcomeHandoff,
  );

  const draftSlot = h('div', { class: 'slot' });
  const errorSlot = h('div', { class: 'slot' });
  const log = h('div', { class: 'log', role: 'log', 'aria-live': 'off' }, draftSlot, errorSlot);
  const body = h('div', { class: 'body' }, welcome, log);
  const chips = h('div', { class: 'chips', role: 'group', hidden: true });
  const input = h('textarea', { rows: '1', enterkeyhint: 'send', autocomplete: 'off' });
  const send = h('button', { type: 'submit', class: 'send' });
  const form = h('form', { class: 'composer' }, input, send);
  const footer = h('p', { class: 'footer' });
  const announcer = h('div', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const panel = h(
    'section',
    {
      class: 'panel',
      part: 'panel',
      id: 'panel',
      role: 'dialog',
      'aria-labelledby': 'title',
      tabindex: '-1',
      hidden: true,
    },
    header,
    body,
    chips,
    form,
    footer,
    announcer,
  );
  const root = h('div', { class: 'root' }, teaser, launcher, panel);

  return {
    root,
    launcher,
    teaser,
    teaserText,
    teaserClose,
    panel,
    headerAvatar,
    title,
    status,
    handoffHeader,
    newChat,
    close,
    welcome,
    welcomeAvatar,
    welcomeTitle,
    welcomeText,
    starters,
    welcomeHandoff,
    body,
    log,
    draftSlot,
    errorSlot,
    chips,
    form,
    input,
    send,
    footer,
    announcer,
  };
}

function isMobile(): boolean {
  return globalThis.matchMedia?.(MOBILE_QUERY).matches ?? false;
}

function normalizeStarters(value: unknown): Starter[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: unknown) => (typeof item === 'string' ? { label: item } : (item as Starter)))
    .filter((item) => typeof item?.label === 'string' && item.label.trim() !== '');
}

function parseConfig(value: string | null): WidgetConfig | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as WidgetConfig;
  } catch {
    // Reported below.
  }
  console.warn('[ai-chat] The config attribute must be a JSON object.');
  return undefined;
}

/** What the endpoint's GET returns under `widget`: the WidgetConfig plus name and avatar. */
type RemoteSettings = WidgetConfig & { name?: string; avatar?: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asUiState(value: unknown): UiState {
  if (!value || typeof value !== 'object') return {};
  const { open, teaserDismissed } = value as Record<string, unknown>;
  return { open: open === true, teaserDismissed: teaserDismissed === true };
}

/** A property set before the element was defined shadows the class accessor: re-apply it. */
function upgradeProperty(element: HTMLElement, property: 'config' | 'fetch'): void {
  if (!Object.hasOwn(element, property)) return;
  const record = element as unknown as Record<string, unknown>;
  const value = record[property];
  delete record[property];
  record[property] = value;
}
