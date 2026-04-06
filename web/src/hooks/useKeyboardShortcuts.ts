import { useEffect } from 'react'

import { isTypingTarget } from '../lib/domEvents'
import { useEditorStore } from '../store'

export function useKeyboardShortcuts() {
  const deleteSelected = useEditorStore((state) => state.deleteSelected)
  const pendingImport = useEditorStore((state) => state.ui.pendingImport)
  const clearPendingImport = useEditorStore((state) => state.clearPendingImport)
  const setDirectSelectionModifierActive = useEditorStore(
    (state) => state.setDirectSelectionModifierActive,
  )
  const setImportStatus = useEditorStore((state) => state.setImportStatus)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Meta') {
        setDirectSelectionModifierActive(true)
      }

      if (isTypingTarget(event.target)) {
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deleteSelected()
      }

      if (event.key === 'Escape' && pendingImport) {
        event.preventDefault()
        clearPendingImport()
        setImportStatus({
          tone: 'info',
          message: `Cancelled placing "${pendingImport.name}".`,
        })
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Meta') {
        setDirectSelectionModifierActive(false)
      }
    }

    const resetDirectSelectionModifier = () => {
      setDirectSelectionModifierActive(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', resetDirectSelectionModifier)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', resetDirectSelectionModifier)
    }
  }, [
    clearPendingImport,
    deleteSelected,
    pendingImport,
    setDirectSelectionModifierActive,
    setImportStatus,
  ])
}
