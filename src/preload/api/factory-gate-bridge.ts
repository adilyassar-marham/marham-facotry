import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const factoryGateApi = {
  list: () => ipcRenderer.invoke('factoryGate:list'),
  enable: (args) => ipcRenderer.invoke('factoryGate:enable', args),
  disable: (args) => ipcRenderer.invoke('factoryGate:disable', args)
} satisfies PreloadApi['factoryGate']
