import type { Register } from 'claude-code'

import { IMAGE_COLUMNS, IMAGE_ROWS, buddyRgba, pickRole, poseAt } from './cells'

const TICK_MS = 1000
const KEY = 'buddy'

export const register: Register = (on, options) => {
  const role = pickRole(String(options.role ?? 'random'), Math.random())
  let working = false
  let idleSince = 0
  let shown: string | undefined
  let site: string | undefined

  on('session.start', async ($, e, next) => {
    idleSince = await $.clock.now()
    $.clock.every(TICK_MS, async () => {
      if (site === undefined) return
      // Swap the picture only when the pose changes: every swap makes iTerm2 flash the cells.
      const pose = poseAt(working, idleSince, await $.clock.now())
      if (pose === shown) return
      shown = pose
      await $.ui.blit({ requestId: site, key: KEY, source: buddyRgba(role, pose) }).catch(() => {
        site = undefined // not mounted (band collapsed, survey, no room): wait for the next draw
      })
    })
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    working = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    working = false
    idleSince = await $.clock.now()
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey || e.props.bodyColumns < IMAGE_COLUMNS) {
      site = undefined
      return next(e)
    }
    if (working && !e.props.isWorking) idleSince = await $.clock.now()
    working = e.props.isWorking
    site = e.requestId

    const { Box, Image } = $.ui.resolve(e)
    const pose = poseAt(working, idleSince, await $.clock.now())
    shown = pose
    return (
      <Box flexDirection="row" justifyContent="flex-end" width={e.props.bodyColumns}>
        <Image key={KEY} columns={IMAGE_COLUMNS} rows={IMAGE_ROWS} source={buddyRgba(role, pose)} alt=" " />
      </Box>
    )
  })
}
