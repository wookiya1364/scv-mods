import type { Register } from 'claude-code'

const PANE = 'scv-hello'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'scv-hello',
      description: 'Open the scv-hello placement test pane',
    })
    void $.ui.open({ id: PANE, title: 'SCV' })
    return started
  })

  on('prompt.submit', async ($, e, next) => {
    const submitted = await next(e)
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (!isOpen) void $.ui.open({ id: PANE, title: 'SCV' })
    return submitted
  })

  on('command.run', { command: 'scv-hello' }, async $ => {
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'SCV' })
    return { text: `scv-hello 0.4.0 pane ${isPlaced ? 'is drawn' : 'is not drawn here'}.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const props = e.props as { placement?: string }

    return (
      <Box flexDirection="column">
        <Text bold>SCV placement test 0.4.0</Text>
        <Text>surface: {e.surface}</Text>
        <Text>placement: {props.placement ?? 'unknown'}</Text>
        <Button key="ping" label="Click me" onPress={() => $.ui.toast('scv-hello: button pressed')} />
      </Box>
    )
  })
}
