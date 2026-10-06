# Nimbo ☁️

**English** · [Español](README.es.md)

A floating companion for [Claude Code](https://claude.com/claude-code) on Windows. It lives on the top edge of your screen, shows what each of your chats is doing, and lets you approve permissions without switching to the terminal.

No API key: it uses the `claude` you already have installed and signed in.

![Nimbo in action](promo/nimbo.gif)

## Install

1. Download **[Nimbo-Setup.exe](https://github.com/FedericoChalaca/nimbo/releases/latest/download/Nimbo-Setup.exe)** and run it.
2. Windows may show "Windows protected your PC" because the installer is not code-signed. Choose **More info → Run anyway**.
3. Nimbo opens and shows the **Connections** panel. Click **Connect** next to Claude Code and you are done.

You do not need Node.js. You do need Claude Code installed and signed in (`claude` in a terminal).

> Nimbo follows your Windows language (English or Spanish). Change it any time: right-click → **Idioma / Language**.

## Connect everything

Right-click Nimbo → **Connections & settings** (it also opens by itself the first time). Each row has a green or amber dot and one button.

| Connection | What you get | How to connect |
|---|---|---|
| **Claude Code** | Live view of your chats, permission cards | Click **Connect**. It adds Nimbo's hooks to `~/.claude/settings.json` (a dated backup is made first, your own hooks are untouched). **Disconnect** removes them. |
| **Your name** | A greeting with your name | Type it in the box. |
| **GitHub** | A pill with your unread notifications | Install the [GitHub CLI](https://cli.github.com) and run `gh auth login`. Nimbo uses that session. |
| **Trello** | A pill with your pending cards | Enable the Trello connector in [claude.ai → Settings → Connectors](https://claude.ai/settings/connectors), then click **Test** (takes about a minute). |
| **WhatsApp** | Unread count, who wrote, what is urgent | Open WhatsApp Desktop. To get summaries, click **Turn on** (see [WhatsApp](#whatsapp-optional-read-only)). |
| **Start with Windows** | Nimbo starts when you log in | Click **Turn on**. |

## What it does

- **Watches your chats live.** Reacts to every Claude Code session at once: thinking, working, waiting for you, done, or failed. Shows the current step and the diff or terminal output of the active chat.
- **Approves permissions from the island.** Allow, Deny, Always, or send it back to the terminal. The card shows the full command.
- **Chats with your Claude.** Type, dictate (local Whisper, no audio leaves your PC), paste images, or drop files on it.
- **Orchestrates.** It knows your chats: ask for something that belongs to another project and it drafts the prompt for that chat, and sends it only when you confirm.
- **Reminders.** "Remind me tomorrow at 9 to send the invoice": it alerts on the island and with a Windows notification.
- **Two looks.** A cloud with a face, or a JARVIS-style sphere of connected dots.
- **Mini mode.** `Ctrl+Alt+N` shrinks it into a corner while you play.
- **Moves.** Drag it along the top edge; it remembers where you left it.

## Using it

| Action | Result |
|---|---|
| Hover | Pills appear (Chats, Trello, GitHub, WhatsApp, Reminders). Click one to see its detail. |
| Click | Opens or closes the chat. |
| Right-click | Menu: connections, language, look, mini mode, WhatsApp, mute, quit. |
| Drag the bar | Moves it along the top edge. |
| Drop a file on it | It "eats" the file and attaches it to the chat. |
| `Ctrl+Alt+N` | Mini mode. |

## WhatsApp (optional, read-only)

Off by default. Nimbo always shows how many chats you have unread (read from the title of the WhatsApp Desktop window). If you turn on **Read WhatsApp messages**:

- It reads the WhatsApp notifications Windows already showed you, through the official Windows notification API. It does not open your WhatsApp session, uses no unofficial libraries, and never sends anything or marks anything as read.
- It passes those texts to **your** Claude to tell you who wrote, what is work, which groups to ignore, and what is urgent. Urgent messages trigger a different, red alarm.
- You define what counts as work and which groups to ignore in a plain text file: right-click → **WhatsApp rules**.

Be aware: when this is on, the text of those notifications (written by other people) is sent to Anthropic through your Claude account to be classified. Nimbo does not store it on disk. It only sees chats that produced a notification (muted chats do not).

## Security

Nimbo sits between you and Claude Code's permission prompts, so this matters:

- The local server listens only on `127.0.0.1` and accepts only messages signed (HMAC-SHA256) by `hook.js` with a secret that changes on every start. A web page or another program cannot approve commands for you.
- The permission card shows the full command or change. Read before you allow.
- Nimbo's own chat can only read files. To change something in a project it proposes a prompt and sends it only when you click.
- The Trello and WhatsApp summaries run with no tools: text written by someone else cannot make Claude execute anything.
- Nimbo stores no passwords, tokens, or API keys. GitHub uses your `gh` session; Trello uses your Claude connector.

Found a security problem? Please open an issue.

## Run from source

Requires [Node.js](https://nodejs.org) 20+.

```bash
git clone https://github.com/FedericoChalaca/nimbo.git
```

```bash
cd nimbo
```

```bash
npm install
```

```bash
npm start
```

Then connect Claude Code from the Connections panel (or `npm run install-hooks`).

Other scripts: `npm test`, `npm run dist` (builds the installer), `npm run promo` (records the demo video), `npm run promo:gif` (regenerates the GIF above).

Your settings live in `%APPDATA%\nimbo\`, never in the project folder. The interface texts live in `i18n.js` (Spanish in the code, English in that file). `CLAUDE.md` explains the architecture, the flows, and the lessons learned (in Spanish; useful for people and for Claude Code).

If your `claude.exe` is not where npm or the native installer puts it, set the `NIMBO_CLAUDE` environment variable to its path.

## Credits

The idea and several island-interface techniques come from [Coucou](https://github.com/louis-cfm/coucou) by Louis Raillé (MIT), a companion for the Mac notch. Nimbo is an independent implementation for Windows, with its own character, sounds, and code.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
