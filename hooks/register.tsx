import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { Item } from '../types'

const tick = atom({ plugin: 'usagebar', key: 'tick' } as const, 0)
const effort = atom({ plugin: 'usagebar', key: 'effort' } as const, '')
const menu = atom({ plugin: 'usagebar', key: 'menu' } as const, '')
const settings = atom({ plugin: 'usagebar', key: 'settings' } as const, false)
const ctxMode = atom({ plugin: 'usagebar', key: 'ctxMode' } as const, 'percent')
const stats = atom({ plugin: 'usagebar', key: 'stats' } as const, { streak: 0, tokens: 0 })
const picked = atom({ plugin: 'usagebar', key: 'picked' } as const, '5h')
const sent = atom({ plugin: 'usagebar', key: 'sent' } as const, [] as string[])

const DEFAULT_LAYOUT: Item[] = [
  { id: '5h', on: true, line: 1 },
  { id: '7d', on: true, line: 1 },
  { id: 'model', on: true, line: 1 },
  { id: 'effort', on: true, line: 1 },
  { id: 'resets', on: true, line: 1 },
  { id: 'ctx', on: true, line: 2 },
  { id: 'cost', on: true, line: 2 },
  { id: 'streak', on: true, line: 3 },
  { id: 'tokens', on: true, line: 3 },
]
const layout = atom({ plugin: 'usagebar', key: 'layout' } as const, DEFAULT_LAYOUT)

const NAMES: Record<string, string> = {
  '5h': '5h limit',
  '7d': '7d limit',
  model: 'model',
  effort: 'effort',
  resets: 'resets',
  ctx: 'context',
  cost: 'cost',
  streak: 'streak',
  tokens: 'tokens',
}

const MODELS: [string, string][] = [
  ['opus', 'claude-opus-5-5'],
  ['sonnet', 'claude-sonnet-5-5'],
  ['fable', 'claude-fable-5-2'],
  ['haiku', 'claude-haiku-5-5'],
]
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

const KIND: Record<string, string> = { '5h': 'five_hour', '7d': 'seven_day' }
const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3.6e6, seven_day: 7 * 86.4e6 }

const GREEN = '#3fb950'
const AMBER = '#e3b341'
const RED = '#f85149'
const SKY = '#58c4ff'
const VIOLET = '#c792ea'
const ORANGE = '#ff9e64'
const GREY = '#4b5263'
const DIM = '#8b90a0'

function pretty(id: string) {
  const m = /(opus|sonnet|haiku|fable)[- ]?(\d+)?(?:[-.](\d{1,2})(?!\d))?/i.exec(id)
  if (!m) return id
  const base = m[1]!
  const name = base.charAt(0).toUpperCase() + base.slice(1).toLowerCase()
  return m[2] ? `${name} ${m[2]}${m[3] ? '.' + m[3] : ''}` : name
}

function tok(n: number) {
  return n >= 1e9 ? `${+(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// "Sonnet 5.5" or "claude-sonnet-5-5[1m]" -> "claude-sonnet-5-5"
function modelKey(s: string) {
  const m = /(opus|sonnet|haiku|fable)[- ]?(\d+)?(?:[-.](\d{1,2})(?!\d))?/i.exec(s)
  if (!m) return s
  return `claude-${m[1]!.toLowerCase()}${m[2] ? '-' + m[2] : ''}${m[3] ? '-' + m[3] : ''}`
}

function tone(p: number) {
  return p >= 90 ? RED : p >= 70 ? AMBER : GREEN
}

function fmt(ms: number) {
  const h = Math.floor(ms / 3.6e6)
  const m = Math.floor((ms % 3.6e6) / 6e4)
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

const CELLS = 6
function filled(p: number) {
  return p > 0 ? Math.max(1, Math.round((Math.min(100, p) / 100) * CELLS)) : 0
}

function ymd(d: Date) {
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

// Current streak and total tokens, from Claude Code's own stats cache (what /stats shows).
function parseStats(text: string) {
  const d = JSON.parse(text) as {
    dailyActivity?: { date: string }[]
    modelUsage?: Record<
      string,
      { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number }
    >
  }
  const days = new Set((d.dailyActivity ?? []).map(x => x.date))
  // The stats file lags behind; being here now makes today an active day.
  const cur = new Date()
  days.add(ymd(cur))
  let streak = 0
  while (days.has(ymd(cur))) {
    streak += 1
    cur.setDate(cur.getDate() - 1)
  }
  let tokens = 0
  for (const v of Object.values(d.modelUsage ?? {})) tokens +=
      (v.inputTokens ?? 0) + (v.outputTokens ?? 0) + (v.cacheReadInputTokens ?? 0) + (v.cacheCreationInputTokens ?? 0)
  return { streak, tokens }
}

// Keep a saved layout valid: known ids only, every default id present.
function clean(saved: unknown): Item[] {
  if (!Array.isArray(saved)) return DEFAULT_LAYOUT.map(i => ({ ...i }))
  const out: Item[] = []
  for (const x of saved as Item[]) {
    if (x && NAMES[x.id] && !out.some(o => o.id === x.id))
      out.push({ id: x.id, on: x.on !== false, line: x.line === 2 ? 2 : x.line === 3 ? 3 : 1 })
  }
  for (const d of DEFAULT_LAYOUT) if (!out.some(o => o.id === d.id)) out.push({ ...d })
  return out
}

type RL = { kind: string; percentUsed: number; resetsAt?: string }

export const register: Register = on => {
  // Limits are only reported after this session's own replies, so a second open session shares
  // the newest reading through a small file and each one shows whichever is fresher.
  let lastSig = ''
  let ownAt = 0
  // What the footer buttons say now, so a drag over one (a click that selected its text) can press it.
  let shownModel = ''
  let shownEffort = ''
  let shownResets = false
  let lastSel = ''
  // Settings buttons by label, so highlighting a button's text (a click that dragged) presses it too.
  const reg = new Map<string, () => unknown>()
  const norm = (s: string) => s.replace(/[\[\]▸✓✗◀▶⇤⇥:]/g, '').trim().toLowerCase()

  on('session.start', async ($, e, next) => {
    $.clock.every(2000, () => void update($, tick, n => n + 1))
    const loadStats = async () => {
      try {
        const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
        const s = parseStats(await $.fs.read(`${home}/.claude/stats-cache.json`))
        await update($, stats, () => s)
      } catch {
        /* stats file missing or unreadable: leave the last values */
      }
    }
    void loadStats()
    $.clock.every(100, async () => {
      try {
        const sel = await $.ui.selection()
        const txt = (sel?.text ?? '').trim()
        if (!txt) {
          lastSel = ''
          return
        }
        if (txt === lastSel || txt.length > 30 || txt.includes(String.fromCharCode(10))) return
        lastSel = txt
        const bare = txt.replace(/^[◆⚡↺]\s*/, '')
        // An open settings panel or model/effort row comes first: its buttons win over the footer's.
        if (reg.size > 0 && !/^[◆⚡↺]/.test(txt)) {
          const q = norm(txt)
          const exact = reg.get(q)
          const hits = q.length >= 3 ? [...reg.keys()].filter(k => k.includes(q)) : []
          const fn = exact ?? (hits.length === 1 ? reg.get(hits[0]!) : undefined)
          if (fn) {
            void fn()
            return
          }
        }
        if (shownModel && (txt.startsWith('◆') || bare === shownModel)) {
          await update($, menu, () => 'model')
        } else if (txt.startsWith('⚡') || (shownEffort && bare === shownEffort)) {
          await update($, menu, () => 'effort')
        } else if (shownResets && (txt.startsWith('↺') || bare === 'Resets')) {
          void $.prompt.fill({ text: '/limit-reset' })
        }
      } catch {
        /* no selection support here (fullscreen off): nothing to do */
      }
    })
    $.clock.every(15000, () => void loadStats())
    const saved = clean(await $.store.get('layout'))
    await update($, layout, () => saved)
    const cm = await $.store.get('ctxMode')
    await update($, ctxMode, () => (cm === 'tokens' || cm === 'both' ? cm : 'percent'))
    await $.command.register({
      name: 'usagebar',
      description: 'Usage bar settings: show, hide and rearrange its parts',
    })
    return next(e)
  })

  on('command.run', { command: 'usagebar' }, async $ => {
    await update($, settings, s => !s)
    await update($, menu, () => '')
    return { text: 'Usage bar settings toggled above the prompt.' }
  })

  on('session.measure', async ($, e, next) => {
    await update($, tick, n => n + 1)
    return next(e)
  })

  // Learn the live effort level from tool calls (they carry it).
  on('tool.call', async ($, e, next) => {
    const lvl = (e as { effort?: { level?: string } }).effort?.level
    if (lvl) {
      await update($, effort, () => lvl)
      await $.store.set('effort', lvl)
    }
    return next(e)
  })

  // Hide the transcript rows of the model/effort changes this mod ran, and of /usagebar.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    const p = e.props as { command: string; args: string }
    const mine = await read($, sent)
    if (p.command === 'usagebar' || mine.includes(`${p.command} ${p.args}`.trim())) {
      const { Box } = $.ui.resolve(e)
      return <Box />
    }
    return next(e)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const p = e.props as { text?: string; origin?: { kind?: string; name?: string } }
    const mine = await read($, sent)
    const t = (p.text ?? '').trim().replace(/^\//, '')
    const fromMe = p.origin?.kind === 'plugin' && p.origin?.name === 'usagebar'
    if (fromMe || t === 'usagebar' || mine.includes(t)) {
      const { Box } = $.ui.resolve(e)
      return <Box />
    }
    return next(e)
  })

  // Right of the footer: the parts the layout turns on, on one or two lines.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    await read($, tick)
    const eff = await read($, effort)
    const items = await read($, layout)
    const cmode = await read($, ctxMode)
    const st = await read($, stats)
    const mod = await $.session.model()
    let saved = ''
    try {
      const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
      const s = JSON.parse(await $.fs.read(`${home}/.claude/settings.json`)) as {
        effortLevel?: string
        modelSettings?: Record<string, { effortLevel?: string }>
      }
      saved = s.modelSettings?.[modelKey(mod)]?.effortLevel ?? s.effortLevel ?? ''
    } catch {
      /* settings unreadable: fall back to the live value */
    }
    const effNow = eff || saved
    shownModel = pretty(mod)
    shownEffort = effNow ? cap(effNow) : 'Effort'
    const usage = await $.session.usage()
    const now = await $.clock.now()
    let limits: RL[] = usage.rateLimits
    try {
      const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
      const sharedPath = `${home}/.claude/mods/limits-shared.json`
      const sig = JSON.stringify(usage.rateLimits.map(r => [r.kind, r.percentUsed, r.resetsAt]))
      if (usage.rateLimits.length > 0 && sig !== lastSig) {
        lastSig = sig
        ownAt = now
        await $.fs.write(sharedPath, JSON.stringify({ ts: now, rateLimits: usage.rateLimits }))
      } else {
        const sh = JSON.parse(await $.fs.read(sharedPath)) as { ts?: number; rateLimits?: RL[] }
        if (sh.rateLimits && (sh.ts ?? 0) > ownAt && now - (sh.ts ?? 0) < 6 * 3.6e6) limits = sh.rateLimits
      }
    } catch {
      /* no shared file yet: use this session's own reading */
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const engine = await next(e)
    const hasReset = (await $.command.list()).some(c => c.name === 'limit-reset')
    shownResets = hasReset

    const bar = (p: number) => (
      <Box flexDirection="row">
        <Text color={tone(p)}>{'━'.repeat(filled(p))}</Text>
        <Text color={GREY}>{'─'.repeat(CELLS - filled(p))}</Text>
      </Box>
    )

    const piece = (id: string) => {
      if (id === '5h' || id === '7d') {
        const r = limits.find(x => x.kind === KIND[id])
        if (!r) return null
        const reset = r.resetsAt ? Date.parse(r.resetsAt) - now : 0
        const win = WINDOW_MS[r.kind]
        let hit = ''
        if (win && reset > 0) {
          const elapsed = win - reset
          if (r.percentUsed > 0 && elapsed > 6e4) {
            const eta = (100 - r.percentUsed) / (r.percentUsed / elapsed)
            if (eta < reset) hit = `hit ${fmt(eta)}`
          }
        }
        return (
          <Box key={id} flexDirection="row" gap={1}>
            <Text color={SKY} bold>{id}</Text>
            {bar(r.percentUsed)}
            <Text color={tone(r.percentUsed)} bold>{Math.round(r.percentUsed)}%</Text>
            {hit ? <Text color={RED} bold>{hit}</Text> : null}
            {reset > 0 ? <Text color={DIM}>({fmt(reset)})</Text> : null}
          </Box>
        )
      }
      if (id === 'ctx') {
        const c = usage.context.percent
        if (c == null) return null
        return (
          <Box key={id} flexDirection="row" gap={1}>
            <Text color={SKY} bold>Context</Text>
            {bar(c)}
            <Text color={tone(c)} bold>
              {cmode === 'tokens'
                ? `${tok(usage.context.tokens ?? 0)}/${tok(usage.context.window)}`
                : cmode === 'both'
                  ? `${tok(usage.context.tokens ?? 0)}/${tok(usage.context.window)} ${Math.round(c)}%`
                  : `${Math.round(c)}% used`}
            </Text>
          </Box>
        )
      }
      if (id === 'cost') {
        const usd = usage.cost?.usd
        if (usd == null) return null
        return (
          <Box key={id} flexDirection="row" gap={1}>
            <Text color={SKY} bold>cost</Text>
            <Text color={AMBER} bold>${usd.toFixed(2)}</Text>
          </Box>
        )
      }
      if (id === 'model')
        return (
          <Button key="model" plain onPress={() => void update($, menu, m => (m === 'model' ? '' : 'model'))}>
            <Text color={VIOLET} bold>◆ {pretty(mod)}</Text>
          </Button>
        )
      if (id === 'streak')
        return (
          <Box key={id} flexDirection="row" gap={1}>
            <Text color={SKY} bold>Current Streak</Text>
            <Text color={ORANGE} bold>
              {st.streak} {st.streak === 1 ? 'day' : 'days'}
            </Text>
          </Box>
        )
      if (id === 'tokens')
        return (
          <Box key={id} flexDirection="row" gap={1}>
            <Text color={SKY} bold>Total Tokens</Text>
            <Text color={VIOLET} bold>{tok(st.tokens)}</Text>
          </Box>
        )
      if (id === 'resets') {
        if (!hasReset) return null
        return (
          <Button key="resets" plain onPress={() => void $.prompt.fill({ text: '/limit-reset' })}>
            <Text color={GREEN} bold>↺ Resets</Text>
          </Button>
        )
      }
      if (id === 'effort')
        return (
          <Button key="effort" plain onPress={() => void update($, menu, m => (m === 'effort' ? '' : 'effort'))}>
            <Text color={ORANGE} bold>⚡ {effNow ? cap(effNow) : 'Effort'}</Text>
          </Button>
        )
      return null
    }

    const line = (n: number) => {
      const parts = items.filter(i => i.on && i.line === n).map(i => piece(i.id)).filter(p => p != null)
      const out: JSX.Element[] = []
      parts.forEach((p, i) => {
        if (i > 0)
          out.push(
            <Text key={`sep${n}-${i}`} color={GREY}>
              │
            </Text>,
          )
        out.push(p as JSX.Element)
      })
      return out
    }

    const l1 = line(1)
    const l2 = line(2)
    const l3 = line(3)
    return (
      <Box flexDirection="column" alignItems="flex-end">
        <Box flexDirection="row" gap={1}>
          {l1}
          {engine}
        </Box>
        {l2.length > 0 ? (
          <Box flexDirection="row" gap={1}>
            {l2}
          </Box>
        ) : null}
        {l3.length > 0 ? (
          <Box flexDirection="row" gap={1}>
            {l3}
          </Box>
        ) : null}
      </Box>
    )
  })

  // Band above the prompt: the settings panel, or the model/effort picker.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const open = await read($, settings)
    const { Box, Text, Button } = $.ui.resolve(e)

    if (open) {
      const items = await read($, layout)
      const cmode = await read($, ctxMode)
      const save = async (fn: (l: Item[]) => Item[]) => {
        const nextL = fn(items.map(i => ({ ...i })))
        await update($, layout, () => nextL)
        await $.store.set('layout', nextL)
      }
      // One step left or right; at the end of a line it carries on into the next (or previous) line.
      const move = (idx: number, dir: -1 | 1) =>
        save(l => {
          const me = l[idx]!
          let j = idx + dir
          while (j >= 0 && j < l.length && l[j]!.line !== me.line) j += dir
          if (j >= 0 && j < l.length) {
            l[idx] = l[j]!
            l[j] = me
            return l
          }
          const target = me.line + dir
          if (target < 1 || target > 3) return l
          l.splice(idx, 1)
          me.line = target
          let at = -1
          if (dir === 1) {
            at = l.findIndex(x => x.line === target)
            if (at === -1) at = l.length
          } else {
            l.forEach((x, k) => {
              if (x.line === target) at = k
            })
            at = at === -1 ? l.length : at + 1
          }
          l.splice(at, 0, me)
          return l
        })
      // Jump to the start (-1) or end (1) of its line.
      const edge = (idx: number, dir: -1 | 1) =>
        save(l => {
          const [it] = l.splice(idx, 1)
          if (!it) return l
          let at = dir === -1 ? 0 : l.length
          if (dir === -1) {
            const first = l.findIndex(x => x.line === it.line)
            at = first === -1 ? 0 : first
          } else {
            let last = -1
            l.forEach((x, k) => {
              if (x.line === it.line) last = k
            })
            at = last + 1
          }
          l.splice(at, 0, it)
          return l
        })
      const toggle = (idx: number) =>
        save(l => {
          l[idx]!.on = !l[idx]!.on
          return l
        })
      const setLine = (idx: number, n: number) =>
        save(l => {
          l[idx]!.line = n
          return l
        })
      const pickedId = await read($, picked)
      const selIdx = Math.max(0, items.findIndex(i => i.id === pickedId))
      const sel = items[selIdx]!
      reg.clear()
      const btn = (key: string, label: string, color: string, fn: () => unknown, isBold = false) => {
        reg.set(norm(label), fn)
        return (
          <Button key={key} plain onPress={() => void fn()}>
            <Text color={color} bold={isBold}>
              {label}
            </Text>
          </Button>
        )
      }

      return (
        <Box flexDirection="column" paddingX={1}>
          <Box flexDirection="row" gap={2}>
            <Text color={SKY} bold>
              Usage bar settings
            </Text>
            {btn('reset', '[ Reset all ]', DIM, () => save(() => DEFAULT_LAYOUT.map(i => ({ ...i }))))}
            {btn('done', '[ Done ]', GREEN, () => update($, settings, () => false), true)}
          </Box>
          <Text color={DIM}>Click a part to pick it, then use the buttons under the lines to change it.</Text>
          <Text> </Text>
          {[1, 2, 3].map(n => (
            <Box key={`line${n}`} flexDirection="row" gap={1}>
              <Box width={8}>
                <Text color={DIM}>Line {n}</Text>
              </Box>
              {items.every(i => i.line !== n) ? <Text color={GREY}>(empty)</Text> : null}
              {items.map(it =>
                it.line !== n
                  ? null
                  : btn(
                      `chip-${it.id}`,
                      `${it.id === sel.id ? "▸" : " "}${it.on ? "✓" : "✗"} ${cap(NAMES[it.id] ?? it.id)} `,
                      it.id === sel.id ? SKY : it.on ? GREEN : GREY,
                      () => update($, picked, () => it.id),
                      it.id === sel.id,
                    ),
              )}
            </Box>
          ))}
          <Text> </Text>
          <Box flexDirection="row" gap={1}>
            <Text color={SKY} bold>
              {cap(NAMES[sel.id] ?? sel.id)}:
            </Text>
            {btn('toggle', sel.on ? '[ Hide ]' : '[ Show ]', sel.on ? RED : GREEN, () => toggle(selIdx))}
            {btn('left', '[ ◀ Left ]', ORANGE, () => move(selIdx, -1))}
            {btn('right', '[ Right ▶ ]', ORANGE, () => move(selIdx, 1))}
            {btn('start', '[ ⇤ Start ]', ORANGE, () => edge(selIdx, -1))}
            {btn('end', '[ End ⇥ ]', ORANGE, () => edge(selIdx, 1))}
            {[1, 2, 3]
              .filter(n => n !== sel.line)
              .map(n => btn(`to-${n}`, `[ To line ${n} ]`, VIOLET, () => setLine(selIdx, n)))}
          </Box>
          <Box flexDirection="row" gap={1}>
            <Box width={8}>
              <Text color={DIM}>Context</Text>
            </Box>
            {(['percent', 'tokens', 'both'] as const).map(m =>
              btn(
                `cm-${m}`,
                `[ ${cap(m)} ]`,
                m === cmode ? GREEN : DIM,
                async () => {
                  await update($, ctxMode, () => m)
                  await $.store.set('ctxMode', m)
                },
                m === cmode,
              ),
            )}
          </Box>
        </Box>
      )
    }

    reg.clear()
    const which = await read($, menu)
    if (!which) return next(e)
    const eff = await read($, effort)
    const run = async (command: string, args: string) => {
      await update($, sent, s => [...s.slice(-20), `${command} ${args}`])
      await update($, menu, () => '')
      void $.command.run({ command, args })
    }

    return (
      <Box flexDirection="row" paddingX={1} gap={2}>
        <Text color={which === 'model' ? VIOLET : ORANGE} bold>
          {which === 'model' ? '◆ Model' : '⚡ Effort'}
        </Text>
        {which === 'model'
          ? MODELS.map(([name, id]) => {
              reg.set(norm(name), () => run('model', id))
              return (
                <Button key={name} plain onPress={() => void run('model', id)}>
                  <Text color={VIOLET}>[ {cap(name)} ]</Text>
                </Button>
              )
            })
          : EFFORTS.map(lvl => {
              const pick = async () => {
                await update($, effort, () => lvl)
                await $.store.set('effort', lvl)
                await run('effort', lvl)
              }
              reg.set(norm(lvl), pick)
              return (
                <Button key={lvl} plain onPress={() => void pick()}>
                  <Text color={lvl === eff ? GREEN : ORANGE} bold={lvl === eff}>
                    [ {cap(lvl)} ]
                  </Text>
                </Button>
              )
            })}
        {(reg.set('close', () => update($, menu, () => '')), null)}
        <Button key="close" plain onPress={() => void update($, menu, () => '')}>
          <Text color={DIM}>[ ✕ close ]</Text>
        </Button>
      </Box>
    )
  })
}
