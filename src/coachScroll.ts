export function scrollContainerToBottom(container: Pick<HTMLElement, 'scrollTop' | 'scrollHeight'> | null) {
  if (!container) return
  container.scrollTop = container.scrollHeight
}
