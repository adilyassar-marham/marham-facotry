import { useSyncExternalStore } from 'react'
import { getFactoryTabOpen, subscribeFactoryTab } from './factory-tab-store'

export function useFactoryTabOpen(): boolean {
  return useSyncExternalStore(subscribeFactoryTab, getFactoryTabOpen, getFactoryTabOpen)
}
