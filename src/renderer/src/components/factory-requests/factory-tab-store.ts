type Listener = () => void

let open = false
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function getFactoryTabOpen(): boolean {
  return open
}

export function setFactoryTabOpen(next: boolean): void {
  if (open === next) {
    return
  }
  open = next
  emit()
}

export function subscribeFactoryTab(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
