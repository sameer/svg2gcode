export const isTypingTarget = (eventTarget: EventTarget | null): boolean => {
  if (!(eventTarget instanceof HTMLElement)) {
    return false
  }

  const tagName = eventTarget.tagName.toLowerCase()
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    eventTarget.isContentEditable ||
    eventTarget.getAttribute('role') === 'textbox'
  )
}
