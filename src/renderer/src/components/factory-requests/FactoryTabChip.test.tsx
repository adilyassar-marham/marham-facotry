// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getFactoryTabOpen, setFactoryTabOpen } from './factory-tab-store'
import { FactoryTabChip } from './FactoryTabChip'

let root: Root
let host: HTMLDivElement

describe('factory tab chip', () => {
  beforeEach(() => {
    setFactoryTabOpen(false)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    setFactoryTabOpen(false)
  })

  it('opens again after another tab closed it', async () => {
    await act(async () => {
      root.render(<FactoryTabChip />)
    })
    const button = host.querySelector('button')
    expect(button?.className).toContain('right-sidebar-header-no-drag')

    setFactoryTabOpen(true)
    setFactoryTabOpen(false)
    await act(async () => {
      button?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })

    expect(getFactoryTabOpen()).toBe(true)
  })
})
