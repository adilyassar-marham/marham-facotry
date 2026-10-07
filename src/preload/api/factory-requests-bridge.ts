import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const factoryRequestsApi = {
  list: () => ipcRenderer.invoke('factoryRequests:list'),
  create: (args) => ipcRenderer.invoke('factoryRequests:create', args),
  answer: (args) => ipcRenderer.invoke('factoryRequests:answer', args),
  decidePlan: (args) => ipcRenderer.invoke('factoryRequests:decidePlan', args),
  cancel: (args) => ipcRenderer.invoke('factoryRequests:cancel', args)
} satisfies PreloadApi['factoryRequests']
