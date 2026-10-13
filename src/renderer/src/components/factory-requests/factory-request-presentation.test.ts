import { describe, expect, it } from 'vitest'
import {
  factoryRequestAgeLabel,
  factoryRequestMatchesListFilter,
  factoryRequestStepIndex,
  factoryRequestStepLabels,
  factoryRequestToOpen
} from './factory-request-presentation'

const now = Date.parse('2026-10-08T00:10:00.000Z')

describe('factory request presentation', () => {
  it('places a request on one step of the process', () => {
    expect(factoryRequestStepIndex('intake')).toBe(0)
    expect(factoryRequestStepIndex('plan_approval')).toBe(1)
    expect(factoryRequestStepIndex('building')).toBe(2)
    expect(factoryRequestStepIndex('reviewing')).toBe(3)
    expect(factoryRequestStepIndex('ready_for_pr')).toBe(4)
    expect(factoryRequestStepIndex('cancelled')).toBeNull()
    expect(factoryRequestStepLabels()).toEqual([
      'Reading',
      'Agree',
      'Building',
      'Checking',
      'Ready'
    ])
  })

  it('keeps finished requests out of the open list', () => {
    expect(factoryRequestMatchesListFilter('building', 'open')).toBe(true)
    expect(factoryRequestMatchesListFilter('plan_approval', 'open')).toBe(true)
    expect(factoryRequestMatchesListFilter('cancelled', 'open')).toBe(false)
    expect(factoryRequestMatchesListFilter('plan_approval', 'needsYou')).toBe(true)
    expect(factoryRequestMatchesListFilter('building', 'needsYou')).toBe(false)
    expect(factoryRequestMatchesListFilter('cancelled', 'finished')).toBe(true)
  })

  it('says how long ago the request started', () => {
    expect(factoryRequestAgeLabel('2026-10-08T00:10:00.000Z', now)).toBe('Just now')
    expect(factoryRequestAgeLabel('2026-10-08 00:09:30', now)).toBe('Just now')
    expect(factoryRequestAgeLabel('2026-10-08T00:05:00.000Z', now)).toBe('5 min ago')
    expect(factoryRequestAgeLabel('2026-10-07T22:10:00.000Z', now)).toBe('2 hr ago')
    expect(factoryRequestAgeLabel('2026-10-07T00:10:00.000Z', now)).toBe('1 day ago')
    expect(factoryRequestAgeLabel('not-a-date', now)).toBeNull()
  })

  it('opens a request that appears while the person is waiting to send', () => {
    const seen = new Set(['freq_old'])
    expect(factoryRequestToOpen(seen, [{ id: 'freq_old' }, { id: 'freq_new' }], true, null)).toBe(
      'freq_new'
    )
    expect(factoryRequestToOpen(seen, [{ id: 'freq_new' }], true, 'freq_other')).toBeNull()
    expect(factoryRequestToOpen(seen, [{ id: 'freq_new' }], false, null)).toBeNull()
  })
})
