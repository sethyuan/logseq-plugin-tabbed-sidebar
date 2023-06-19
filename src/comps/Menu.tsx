import { waitMs } from "jsutils"
import { ComponentChildren } from "preact"
import { Ref, useEffect, useRef } from "preact/hooks"
import { cls } from "reactutils"

type MenuProps = {
  x: number
  y: number
  children: ComponentChildren
  onClose: () => void | Promise<void>
  className: string
}

export default function Menu({
  x,
  y,
  children,
  onClose,
  className,
}: MenuProps) {
  const rootRef = useRef<HTMLDivElement>() as Ref<HTMLDivElement>

  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && !e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  async function onBlur() {
    await waitMs(200)
    if (
      rootRef.current == null ||
      rootRef.current.contains(parent.document.activeElement)
    )
      return
    onClose()
  }

  function stopPropagation(e: Event) {
    e.stopPropagation()
  }

  return (
    <div
      ref={rootRef}
      class={cls("kef-ts-menu", className)}
      tabIndex={-1}
      style={{ top: `${y}px`, left: `${x}px` }}
      onKeyDown={onKeyDown}
      onMouseDown={stopPropagation}
      onClick={stopPropagation}
      onBlur={onBlur}
    >
      {children}
    </div>
  )
}
