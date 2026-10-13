// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarFactoryRequestsButton } from './SidebarFactoryRequestsButton'

vi.mock('../factory-requests/FactoryRequestsSheet', () => ({
  FactoryRequestsSheet: (props: { open: boolean }) =>
    props.open ? <div data-testid="factory-screen" /> : null
}))

let root: Root
let host: HTMLDivElement

describe('sidebar factory button', () => {
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('opens the factory across the app as soon as the sidebar is there', async () => {
    await act(async () => {
      root.render(<SidebarFactoryRequestsButton />)
    })

    expect(host.querySelector('[data-testid="factory-screen"]')).not.toBeNull()
  })
})
