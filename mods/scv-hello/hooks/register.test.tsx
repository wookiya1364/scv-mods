import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'scv-hello',
  component: 'Pane',
  requestId: 'scv-hello',
  props: {
    title: 'SCV',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('a session start opens the pane', async ($, on) => {
  const opened: string[] = []
  on('command.register', () => ({ value: { command: 'scv-hello' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(opened).toEqual(['scv-hello'])
})

test('the pane draws and its button raises a toast, on every surface', async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /surface:/ }))?.text).toBe(`surface: ${surface}`)
    expect((await ui.find({ type: 'Text', text: /placement:/ }))?.text).toBe('placement: dock')
    await ui.press({ key: 'ping' })
    await ui.unmount()
  }

  expect(toasts).toEqual(Array(4).fill('scv-hello: button pressed'))
})

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as const

test('a prompt reopens the pane after the person closed it', async ($, on) => {
  const opened: string[] = []
  let panes: { id: string }[] = []
  on('ui.panes', () => ({ value: panes as never }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))

  await $.prompt.submit(typed('hi'))
  expect(opened).toEqual(['scv-hello'])

  panes = [{ id: 'scv-hello' }]
  await $.prompt.submit(typed('again'))
  expect(opened).toEqual(['scv-hello'])
})
