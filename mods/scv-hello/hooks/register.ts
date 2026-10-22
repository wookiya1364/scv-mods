import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const surfaces = (await $.session.surfaces()).join(', ') || 'no surface'
    $.ui.status(`on (${surfaces})`)
    $.ui.toast(`scv-hello loaded (${surfaces})`)
    return started
  })
}
