# UsageBar

A mod for Claude Code that puts a colorful usage bar at the right of the prompt footer, in the same row as the mode label.

## What it shows

- **5h and 7d limits:** a slim bar, the percent used, and the time until each limit resets, like `5h ━━━─── 43% (2h 46m)`. If you would hit a limit before it resets at your current pace, it adds a red `hit 2h 42m`.
- **Model and effort buttons:** `◆ Sonnet 5.5` and `⚡ Medium`. Click one to open a row with every choice, then click the one you want.
- **Context:** how full the chat is, as a percent, as tokens out of the window (like `62k/1M`), or both.
- **Cost:** what the session has cost so far.
- **Current Streak and Total Tokens:** read from Claude Code's own stats file, the same numbers `/stats` shows.
- **Resets button:** types `/limit-reset` into the prompt. It never uses a reset by itself; you press Enter.

If you have two sessions open, they share the newest 5h and 7d numbers through a small file at `~/.claude/mods/limits-shared.json`.

## Settings

Run `/usagebar` to open the settings panel above the prompt. Click a part to pick it, then show or hide it, move it left or right (it carries on into the next line), or send it to another of the three lines. You can also choose how context is shown. Your choices are saved.

If a click turns into highlighted text because the mouse moved, highlighting a button's label presses it too.

## Install

At the prompt of a terminal session:

```
/plugin install usagebar --marketplace Redfish247/UsageBar
```

From a shell:

```
claude plugin install usagebar --marketplace Redfish247/UsageBar
```

Then run `/reload-plugins`.

## Notes

- Claude Code asks "Switch model?" or "Change effort level?" when your chat is cached. That confirmation is built in and cannot be turned off from a mod.
- Works best in fullscreen mode.
- The mod only reads files on your own computer (`~/.claude/settings.json`, `~/.claude/stats-cache.json`) and does not send anything anywhere.
