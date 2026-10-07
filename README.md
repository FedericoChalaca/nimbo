# Nimbo ☁️

**English** · [Español](README.es.md)

A floating companion for [Claude Code](https://claude.com/claude-code) on Windows. It lives on the top edge of your screen, shows what each of your chats is doing, and lets you approve permissions without switching to the terminal.

No API key: it uses the `claude` you already have installed and signed in.

[![Watch the 10-second intro](promo/nimbo-intro.jpg)](promo/nimbo-intro.mp4)

*▶ Click to watch the intro (10 s, Spanish captions). It is an AI-generated concept video; the real interface is the one below.*

![Nimbo in action](promo/nimbo.gif)

## Install

1. Download **[Nimbo-Setup.exe](https://github.com/FedericoChalaca/nimbo/releases/latest/download/Nimbo-Setup.exe)** and run it.
2. Windows may show "Windows protected your PC" because the installer is not code-signed. Choose **More info → Run anyway**.
3. Nimbo opens and shows the **Connections** panel. Click **Connect** next to Claude Code and you are done.

You do not need Node.js. You do need Claude Code installed and signed in (`claude` in a terminal).

To remove it, uninstall Nimbo from Windows Settings → Apps. The uninstaller also removes Nimbo's hooks from Claude Code; your settings in `%APPDATA%\nimbo` are kept.

> Nimbo follows your Windows language (English or Spanish). Change it any time: right-click → **Idioma / Language**.

## Connect everything

Everything is connected from one place: right-click Nimbo → **Connections & settings** (it also opens by itself the first time). Each row has a dot and one button:

- 🟢 green: connected and working
- 🟠 amber: needs a step from you
- ⚪ gray: optional, not set up

Only Claude Code is required. The rest is optional and you can add it whenever you want.

### 1. Claude Code (required)

What you get: your chats live on the island, and permission requests as cards.

1. Make sure Claude Code works: open a terminal, run `claude`, and sign in if it asks.
2. In Nimbo's Connections panel, click **Connect**.
3. Send any message in a Claude Code session (terminal, desktop app, or IDE). The island shows the chat's name and what it is doing.

If nothing shows up, close and reopen the Claude Code session that was already running: it picks up the connection when it starts.

What **Connect** does: it adds Nimbo's hooks to `~/.claude/settings.json`. It makes a dated backup first and does not touch hooks you already had. **Disconnect** removes them.

### 2. Your name

Type it in the box so Nimbo greets you by name.

### 3. GitHub (optional)

What you get: a purple pill with your unread GitHub notifications, and a heads-up when a new one arrives.

1. Install the [GitHub CLI](https://cli.github.com):

```bash
winget install --id GitHub.cli
```

2. Sign in:

```bash
gh auth login
```

3. Reopen the Connections panel: the GitHub row turns green. Nimbo checks every 5 minutes using that session; it never sees your password or token.

### 4. Trello (optional)

What you get: a blue pill with your pending cards, and a warning when one is due within 24 hours. Read-only: Nimbo cannot create, move, or delete cards.

1. Open [claude.ai → Settings → Connectors](https://claude.ai/settings/connectors), find **Trello**, click **Connect**, and authorize your Trello account. Use the same Claude account you use in Claude Code.
2. In Nimbo's Connections panel, click **Test**. The first read takes about a minute.
3. The row turns green with the number of pending cards. It refreshes every 30 minutes, or right away with right-click → **Refresh Trello**.

A card counts as pending if it is open and has an unfinished due date, or sits in a list such as To do, In progress, Blocked, or Inbox.

### 5. WhatsApp (optional, read-only)

There are two levels. The first needs nothing from you.

**Level 1: unread count.** Open WhatsApp Desktop (the Microsoft Store app). Nimbo reads the number from the window title and shows it in the WhatsApp pill.

**Level 2: who wrote and what is urgent.** Off until you turn it on.

1. In the Connections panel, on the WhatsApp row, click **Turn on**.
2. Check that Windows shows WhatsApp notifications with their text: Windows Settings → System → Notifications → WhatsApp on, and in WhatsApp → Settings → Notifications, message previews on. Nimbo reads those notifications; no notification, no summary.
3. Tell it what matters to you: click **Rules** (or right-click → **WhatsApp rules**). It is a plain text file; write it in your own words and save. For example:

```text
Work: Laura (my boss), Andrés (client), the group "Team Rocket".
Groups I don't care about: Thursday football, Building neighbors.
Urgent: anything from work that needs an answer today, an upset client, a payment, something down, or a family emergency.
```

4. Recommended: make it fully local. Install [Ollama](https://ollama.com), then download a small model (2 GB, one time):

```bash
ollama pull llama3.2:3b
```

Leave Ollama running. The WhatsApp row will say "Summarized by a local model": about a second per chat, no tokens spent, and the messages never leave your PC. Without Ollama, your own Claude (Haiku) does it: 10 to 20 seconds per batch, counted against your Claude usage.

What you will see:

| On the island | Meaning |
|---|---|
| Green button with a number | Chats with a summary you have not seen yet. Click it to open it. |
| The button spins, "WhatsApp · summarizing…" | The model is reading the new messages. |
| "WhatsApp · Laura: asks for the report" | The summary, shown for a few seconds when it is ready. |
| Red island that pulses, three beeps | Something urgent according to your rules. |
| ↩ a line under each chat, with **Copy** | A suggested reply. Copy it and paste it into WhatsApp if you like it; Nimbo never sends anything. |
| **Seen** (inside the summary) | You read it: it closes and those messages do not come back. It also happens by itself when you close the summary. |
| **Summarize now** (inside the summary) | Ask for it again, for example after changing your rules. |

Good to know:

- What you have already seen is not summarized or announced again, even after restarting Nimbo. It only speaks up when a new message arrives.
- Replies are suggestions from a small model: read them before you paste. You can describe your style in the rules file ("I answer short and informal").
- Muted chats, and messages that arrive while the WhatsApp window is in front, do not produce a notification, so Nimbo does not see them.
- Groups you listed as not important are counted but never ring.
- Summaries pause in mini mode and catch up when you leave it.
- To force one or the other, set `waModel` in `%APPDATA%\nimbo\prefs.json` to `"claude"` or to an Ollama model name.

**Privacy.** Nimbo has no servers and no telemetry: nothing goes to Nimbo's author or to anyone else. It reads the notifications Windows already showed you through the official Windows API; it does not open your WhatsApp session, uses no unofficial libraries, and never sends anything or marks anything as read in WhatsApp. With a local model the text stays on your PC. Without one, the text of those notifications (written by other people) goes to Anthropic through **your** Claude account, the same as anything you type into Claude. Nimbo keeps messages in memory only, never on disk (the only thing saved is the internal number of the notifications you have already seen, with no text).

### 6. Start with Windows

Click **Turn on** and Nimbo launches when you log in.

### 7. Your notes (optional)

If you keep notes in a folder (an Obsidian vault, for example), Nimbo's chat can read them to answer questions like "which projects are on hold?". Add the folder to `%APPDATA%\nimbo\prefs.json` and restart Nimbo:

```json
{ "vault": "D:\\my-notes" }
```

### 8. Voice (optional)

Nimbo can read its replies aloud, with a different voice for each look (cloud and JARVIS). It reads only its short answer, never the prompts it proposes for other chats.

Nimbo does not talk to a voice provider and stores no keys. It sends the text to a text-to-speech service you choose and plays the audio that comes back:

Do not have a service yet? [examples/tts-service](examples/tts-service) is one ready to deploy for ElevenLabs: you add your own key and the ids of the two voices you like.

1. Put the address of your service in `%APPDATA%\nimbo\prefs.json` and restart Nimbo:

```json
{ "ttsUrl": "https://your-service.example/api/tts" }
```

2. In the Connections panel, on the Voice row, click **Turn on** (or right-click → **Read replies aloud**).

The service receives `POST {"text": "..."}` for the JARVIS look and `POST {"text": "...", "voz": "nube"}` for the cloud look, and must answer with `audio/mpeg`. Texts are cut at a sentence end to fit 1500 characters.

It stops talking when a new answer arrives, when you start dictating, when you switch looks, or when you turn the voice or all sounds off. If the service is down, slow (more than 10 seconds), or you are offline, Nimbo simply stays silent: one request per answer, no retries, no errors on screen.

Keep in mind that the text of each reply is sent to that service.

### 9. Daily plan (optional)

If another tool of yours leaves a daily plan as a JSON file in a branch of a git repository on your PC, Nimbo can show it, say it aloud the first time you open it each day, and give it to you when you type "what's the plan for today". It only reads (`git fetch` and `git show`), with the git you already have. Tell it where the plan is in `%APPDATA%\nimbo\prefs.json`:

```json
{ "planRepo": "D:\\my-repo", "planBranch": "daily-plan", "planFile": "plan.json" }
```

The file format is described at the top of [plan.js](plan.js).

### If something does not work

| Problem | What to check |
|---|---|
| The island does not react to my chats | Connections → Claude Code must be green. Then restart the Claude Code session. |
| The Claude Code row says "points to another folder" | You moved or reinstalled Nimbo. Click **Reconnect**. |
| A pill is missing | Pills only appear when they have something: zero notifications or zero cards hides them. |
| WhatsApp says "No preview" | Those chats left no notification in Windows. See step 2 of WhatsApp. |
| WhatsApp summaries are slow | You are on Claude. Install Ollama and a small model (step 4 of WhatsApp). |
| Dictation does nothing the first time | It downloads the speech model once (about 76 MB). The island shows the progress. |

## What it does

- **Watches your chats live.** Reacts to every Claude Code session at once: thinking, working, waiting for you, done, or failed. Shows the current step and the diff or terminal output of the active chat.
- **Approves permissions from the island.** Allow, Deny, Always, or send it back to the terminal. The card shows the full command.
- **Chats with your Claude.** Type, dictate (local Whisper, no audio leaves your PC), paste images, or drop files on it.
- **Sees your screen when you ask.** Click 🖥 in the chat: it takes one screenshot, shows you the thumbnail, and you ask what you need ("what does this error mean?", "where do I click to export?"). No live view and nothing automatic: one picture, only when you press the button, sent to your Claude only when you send the message.
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
| Click the green button | Opens the WhatsApp summary. |
| 🖥 in the chat | Takes a screenshot of the screen where your cursor is and attaches it. Click the thumbnail to remove it. |
| Right-click | Menu: connections, language, look, mini mode, WhatsApp, voice, mute, quit. |
| ⋮ at the right end of the island | The same menu, without right-clicking. It shows up when you hover. |
| Nimbo's icon next to the clock | The same menu again. Windows may keep the icon behind the little arrow (^) on the taskbar. |
| Drag the bar | Moves it along the top edge. |
| Drop a file on it | It "eats" the file and attaches it to the chat. |
| `Ctrl+Alt+N` | Mini mode. |

## Security

Nimbo sits between you and Claude Code's permission prompts, so this matters:

- The local server listens only on `127.0.0.1` and accepts only messages signed (HMAC-SHA256) by `hook.js` with a secret that changes on every start. A web page or another program cannot approve commands for you.
- The permission card shows the full command or change. Read before you allow.
- Nimbo's own chat can only read files. To change something in a project it proposes a prompt and sends it only when you click.
- The Trello and WhatsApp summaries run with no tools: text written by someone else cannot make a model execute anything.
- Nimbo stores no passwords, tokens, or API keys. GitHub uses your `gh` session; Trello uses your Claude connector.

Found a security problem? Please open an issue.

## Code signing

The installer is **not code-signed yet**. That is the only reason Windows shows "Windows protected your PC" when you open it: Windows does not know the publisher. Signing needs a certificate from a recognized authority, and we have applied to the [SignPath Foundation](https://signpath.org), which provides free code signing for open-source projects.

In the meantime, two things let you trust what you download:

- The installer attached to each release is built by [GitHub Actions](.github/workflows/build.yml) straight from this repository, with no manual steps.
- You can skip the installer and [run from source](#run-from-source).

Code signing policy:

- Authors, reviewers and approvers: [@FedericoChalaca](https://github.com/FedericoChalaca). Changes from anyone else are reviewed before they are merged.
- Privacy: see [PRIVACY.md](PRIVACY.md) for every case in which Nimbo connects to the network.

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
