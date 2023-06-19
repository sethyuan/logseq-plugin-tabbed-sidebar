import type { ComponentChildren } from "preact"
import { Ref, useRef, useState } from "preact/hooks"
import Menu from "./Menu"

type DropDownProps = {
  children: ComponentChildren
  container: HTMLElement
  popup: (hidePopup: () => void) => ComponentChildren
  popupClass: string
  onPopupHidden: () => void
} & Record<string, any>

interface Position {
  x: number
  y: number
}

export default function DropDown({
  children,
  container,
  popup,
  popupClass,
  onPopupHidden,
  ...attrs
}: DropDownProps) {
  const [popupShown, setPopupShown] = useState(false)
  const root = useRef<HTMLElement>() as Ref<HTMLElement>
  const [pos, setPos] = useState<Position>()

  function showPopup() {
    setPopupShown(true)
    const containerRect = container.getBoundingClientRect()
    const rect = root.current!.getBoundingClientRect()
    setPos({
      x: rect.x - containerRect.x,
      y: rect.y - containerRect.y + rect.height + 6,
    })
  }

  function hidePopup() {
    setPopupShown(false)
    onPopupHidden?.()
  }

  function toggleVisibility() {
    if (popupShown) {
      hidePopup()
    } else {
      showPopup()
    }
  }

  return (
    <span ref={root} {...attrs} onClick={toggleVisibility}>
      {children}
      {popupShown && (
        <Menu className={popupClass} x={pos!.x} y={pos!.y} onClose={hidePopup}>
          {popup(hidePopup)}
        </Menu>
      )}
    </span>
  )
}
