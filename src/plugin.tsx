import "@logseq/libs"
import { IAsyncStorage } from "@logseq/libs/dist/modules/LSPlugin.Storage"
import { setup, t } from "logseq-l10n"
import { render } from "preact"
import { debounce } from "rambdax"
import Menu from "./comps/Menu"
import {
  getBlock,
  isElement,
  parseContent,
  persistBlockUUID,
  readPinData,
  writePinData,
} from "./libs/utils"
import zhCN from "./translations/zh-CN.json"

const TOOLTIP_WIDTH = 300
const DECORATIVE_W = -4
const TAB_V_START = 48
const TAB_V_SPACING = 10
const TAB_V_DRAGBAR_SPACING = 4
const TAB_V_SPACE_FIX = 28
const TAB_V_HEIGHT_KEY = "kef-ts-tab-height"

let sidebarResizeObserver: ResizeObserver

let activeIdx = 0
let lastActiveIdx = 0
let reordering = false
let drake: any = null
let nextActiveIdx = -1
let lastTabsCount = -1

let storage: IAsyncStorage
let graphName: string
let graphUrl: string

const moved = new Map<number, "up" | "down">()

const placeMovedTabs = debounce(() => {
  const tabs = parent.document.getElementById("kef-ts-tabs")
  if (tabs == null) return
  const sidebarListContainer = parent.document.querySelector(
    ".sidebar-item-list",
  ) as HTMLElement | null
  if (sidebarListContainer == null) return

  const itemList = parent.document.querySelectorAll(
    ".sidebar-item-list .sidebar-item.content",
  )
  if (itemList == null) return

  const itemListLen = itemList.length
  let top = TAB_V_START
  let bottom = TAB_V_SPACING

  for (let i = 0; i < itemListLen; i++) {
    const item = itemList[itemListLen - 1 - i] as HTMLElement
    if (tabs.children[i]?.classList.contains("kef-ts-moved-up")) {
      item.style.top = `${top}px`
      item.style.bottom = ""

      const dragBar =
        (parent.document.querySelector(
          `.kef-ts-drag-bar[data-index="${i}"]`,
        ) as HTMLElement | null) ?? createDragBar(i, "up")
      const rect = item.getBoundingClientRect()
      dragBar.style.display = ""
      dragBar.style.top = `${rect.top + rect.height}px`
      dragBar.style.left = `${rect.left}px`

      top += item.offsetHeight + TAB_V_SPACING
    } else if (tabs.children[i]?.classList.contains("kef-ts-moved-down")) {
      item.style.bottom = `${bottom}px`
      item.style.top = ""

      const dragBar =
        (parent.document.querySelector(
          `.kef-ts-drag-bar[data-index="${i}"]`,
        ) as HTMLElement | null) ?? createDragBar(i, "down")
      const rect = item.getBoundingClientRect()
      dragBar.style.display = ""
      dragBar.style.top = `${rect.top - TAB_V_SPACING}px`
      dragBar.style.left = `${rect.left}px`

      bottom += item.offsetHeight + TAB_V_SPACING
    }
  }

  if (top > TAB_V_START) {
    tabs.style.marginTop = `${top - TAB_V_START}px`
  } else {
    tabs.style.marginTop = "0"
  }

  if (bottom === TAB_V_SPACING) {
    sidebarListContainer.style.height = `calc(100vh - ${
      top + bottom + TAB_V_SPACE_FIX
    }px)`
  } else {
    sidebarListContainer.style.height = `calc(100vh - ${top + bottom}px - 32px)`
  }
}, 100) as () => {}

async function main() {
  await setup({ builtinTranslations: { "zh-CN": zhCN } })

  injectDeps()
  provideStyles()

  storage = logseq.Assets.makeSandboxStorage()
  const graph = (await logseq.App.getCurrentGraph())!
  graphName = graph.name
  graphUrl = graph.url

  const sidebarVisibleOffHook = logseq.App.onSidebarVisibleChanged(
    async ({ visible }) => {
      if (visible) {
        renderTabs()
      }
    },
  )

  sidebarResizeObserver = new ResizeObserver((_entries) => {
    placeMovedTabs()
  })

  let sidebarItemObserver: MutationObserver | undefined
  const sidebar = parent.document.getElementById("right-sidebar")
  if (sidebar != null) {
    sidebarItemObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          const existent =
            node.parentElement?.classList.contains("initial") ||
            node.parentElement?.parentElement?.classList.contains("initial")
          if (
            isElement(node) &&
            (node.classList.contains("sidebar-item") || existent)
          ) {
            refreshTabs()
            return
          }
        }
        for (const node of mutation.removedNodes) {
          if (isElement(node) && node.classList.contains("sidebar-item")) {
            refreshTabs()
            return
          }
        }
      }
    })
    sidebarItemObserver.observe(sidebar, { childList: true, subtree: true })

    sidebarResizeObserver.observe(sidebar)

    sidebar.addEventListener("pointerdown", onDragDown)
    sidebar.addEventListener("pointerup", onDragUp)
    sidebar.addEventListener("pointermove", onDragMove)
    sidebar.addEventListener("pointercancel", onDragCancel)
  }

  const graphChangeOffHook = logseq.App.onCurrentGraphChanged(async () => {
    const graph = (await logseq.App.getCurrentGraph())!
    graphName = graph.name
    graphUrl = graph.url

    initialize()

    logseq.App.setRightSidebarVisible(false)
    logseq.App.clearRightSidebarBlocks()
  })

  logseq.beforeunload(async () => {
    sidebarResizeObserver.disconnect()
    sidebarItemObserver?.disconnect()
    sidebarVisibleOffHook()
    graphChangeOffHook()
  })

  console.log("#tabbed-sidebar loaded")
}

function injectDeps() {
  const base = getBase(document.baseURI)
  const js = `${base}/dragula.min.3.7.3.js`
  const css = `${base}/dragula.min.3.7.3.css`
  if (!parent.document.body.querySelector(`script[src="${js}"]`)) {
    const script = parent.document.createElement("script")
    script.src = js
    parent.document.body.append(script)
  }
  if (!parent.document.head.querySelector(`link[href="${css}"]`)) {
    const link = parent.document.createElement("link")
    link.rel = "stylesheet"
    link.href = css
    link.type = "text/css"
    parent.document.head.append(link)
  }
}

function initialize() {
  const bars = parent.document.querySelectorAll(".kef-ts-drag-bar")
  for (const bar of bars) {
    bar.remove()
  }

  moved.clear()

  // HACK: clear as many as possible.
  for (let i = 0; i < 50; i++) {
    sessionStorage.removeItem(`${TAB_V_HEIGHT_KEY}-${i}`)
  }

  sidebarResizeObserver.disconnect()
  const sidebar = parent.document.getElementById("right-sidebar")
  if (sidebar != null) {
    sidebarResizeObserver.observe(sidebar)
  }
}

function getBase(uri: string) {
  const index = document.baseURI.lastIndexOf("/")
  if (index > -1) {
    return uri.substring(0, index)
  }
  return uri
}

function provideStyles() {
  logseq.provideStyle({
    key: "kef-ts",
    style: `
    #kef-ts-tabs {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      padding-left: 0.5em;
      font-size: 0.875em;
      position: relative;
    }
    #kef-ts-tooltip {
      display: none;
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      width: 300px;
      background-color: var(--ls-primary-background-color);
      z-index: var(--ls-z-index-level-2);
      border-radius: 8px;
      padding: 0.75em 1em;
      box-shadow: 0px 2px 14px 0px var(--ls-block-bullet-color);
      line-height: 1.6;
      transition: translate 100ms linear;
    }
    .kef-ts-header {
      flex: 0 1 auto;
      overflow: hidden;
      display: flex;
      align-items: center;
      width: 150px;
      height: 30px;
      line-height: 30px;
      margin-right: 5px;
      padding: 0 0.25em;
      background-color: var(--ls-primary-background-color);
      border-radius: 4px;
      cursor: pointer;
      border-right: 1px solid var(--ls-border-color);
    }
    .kef-ts-header:hover {
      background-color: var(--ls-secondary-background-color);
    }
    .kef-ts-active {
      background-color: var(--ls-selection-background-color) !important;
    }
    .kef-ts-block-title {
      flex: 1 0 20px;
      margin-right: 4px;
      overflow: hidden;
      white-space: nowrap;
    }
    .kef-ts-block-close {
      flex: 0 1 0%;
      font-family: 'tabler-icons';
    }
    .kef-ts-pinned,
    .kef-ts-moved {
      flex: 0 0 auto;
      width: 28px;
      letter-spacing: 10px;
    }
    .sidebar-item[data-moved="true"] {
      position: absolute;
      left: 8px;
      right: 8px;
      z-index: var(--ls-z-index-level-1);
      height: 25%;
      overflow: auto;
    }
    .sidebar-item[data-moved="true"] .sidebar-item-header:has(.page-title) {
      display: flex !important;
    }
    .sidebar-item[data-moved="true"] .sidebar-item-header + div {
      overflow: auto;
    }
    .sidebar-item[data-moved="true"] .sidebar-item-header + div.hidden {
      display: none !important;
      flex: unset !important;
    }
    .kef-ts-drag-bar {
      position: fixed;
      right: 8px;
      height: 10px;
      z-index: var(--ls-z-index-level-2);
      cursor: row-resize;
    }
    .kef-ts-drag-bar:hover::before {
      content: "";
      display: block;
      position: absolute;
      top: 5px;
      left: 0;
      right: 0;
      height: 2px;
      background-color: var(--ls-active-primary-color);
    }
    .kef-ts-menu {
      position: fixed;
      box-shadow: 0 2px 8px 0 var(--ls-block-bullet-color);
      background-color: var(--ls-secondary-background-color);
      padding: 0.5em 0;
      z-index: var(--ls-z-index-level-2);
    }
    .kef-ts-menu:focus-visible {
      outline: none;
    }
    .kef-ts-menu-item {
      display: block;
      padding: 0.5em 0.75em;
      width: 100%;
      text-align: left;
      user-select: none;
      font-size: 0.875em;
    }
    .kef-ts-menu-item:hover {
      background-color: var(--ls-primary-background-color);
    }
    #right-sidebar {
      position: relative !important;
    }
    .sidebar-item-list {
      margin-top: 4px !important;
    }
    .sidebar-drop-indicator {
      display: none !important;
    }
    .sidebar-item-header:has(.page-title) {
      display: none !important;
    }
    .sidebar-item-header {
      background: unset !important;
    }
    .sidebar-item-header > button > span,
    .sidebar-item-header > button + div {
      display: none !important;
    }
    .sidebar-item-header + div.hidden {
      display: block !important;
      flex: 1 !important;
    }
    .sidebar-item.collapsed {
      flex: 1 1 !important;
      overflow: hidden !important;
    }
    `,
  })
}

function renderTabs() {
  if (parent.document.getElementById("kef-ts-tabs") != null) return
  const topBar = parent.document.querySelector(".cp__right-sidebar-topbar")
  if (topBar == null) return

  const container = parent.document.createElement("div")
  container.id = "kef-ts-tabs"
  container.addEventListener("click", onTabCloseClick)
  container.addEventListener("click", onTabClick)
  container.addEventListener("dblclick", onTabDoubleClick)
  container.addEventListener("contextmenu", onTabContextMenu)
  container.addEventListener("mouseleave", onTabMouseLeave)

  const tooltip = parent.document.createElement("div")
  tooltip.id = "kef-ts-tooltip"
  container.append(tooltip)

  topBar.after(container)

  drake = (parent as any).dragula([container], {
    direction: "horizontal",
    mirrorContainer: container,
    accepts: (
      el: HTMLElement,
      target: HTMLElement,
      _source: HTMLElement,
      sibling: HTMLElement | null,
    ) => {
      if (sibling?.classList.contains("gu-mirror")) return false
      return (
        (!el.classList.contains("kef-ts-pinned") &&
          !sibling?.classList.contains("kef-ts-pinned")) ||
        (el.classList.contains("kef-ts-pinned") &&
          ((sibling == null &&
            target.lastElementChild?.previousElementSibling?.classList.contains(
              "kef-ts-pinned",
            )) ||
            sibling?.classList.contains("kef-ts-pinned") ||
            sibling?.previousElementSibling?.classList.contains(
              "kef-ts-pinned",
            )))
      )
    },
  })
  drake.on("drop", onDrop)
}

async function refreshTabs() {
  const sidebarBlocks = await logseq.App.getStateFromStore("sidebar/blocks")

  if (sidebarBlocks.length === 0) {
    initialize()

    const contents = [graphUrl, "contents", "contents"]
    sidebarBlocks.push(contents)
    await logseq.App.setStateFromStore("sidebar/blocks", [contents])
  }

  if (
    sidebarBlocks.some(([, , type]: [any, any, string]) => type === "blockRef")
  ) {
    const blocks = await Promise.all(
      sidebarBlocks.map(async (item: [any, any, string]) => {
        const [g, id, type] = item
        if (type === "blockRef") {
          const entity =
            (await logseq.Editor.getBlock(id)) ??
            (await logseq.Editor.getPage(id))!
          if (entity.name) {
            return [g, entity.id, "page"]
          } else {
            return [g, entity.id, "block"]
          }
        }
        return item
      }),
    )
    await logseq.App.setStateFromStore("sidebar/blocks", blocks)
    return
  }

  const [hasOpenings, newSidebarBlocks] = await checkForPins(sidebarBlocks)
  if (hasOpenings) {
    await logseq.App.setStateFromStore("sidebar/blocks", newSidebarBlocks)
    return
  }

  const container = parent.document.getElementById("kef-ts-tabs")
  if (container == null) return
  const itemList = parent.document.querySelectorAll(
    ".sidebar-item-list .sidebar-item.content",
  )
  if (itemList == null) return
  const tabsCount = container.childElementCount - 1

  const newCount = itemList.length - tabsCount
  for (let i = 0; i < newCount; i++) {
    const tab = parent.document.createElement("div")
    tab.classList.add("kef-ts-header")
    const title = parent.document.createElement("div")
    title.classList.add("kef-ts-block-title")
    const closeBtn = parent.document.createElement("button")
    closeBtn.classList.add("kef-ts-block-close")
    closeBtn.type = "button"
    closeBtn.innerHTML = "&#xeb55;"
    tab.append(title, closeBtn)
    tab.addEventListener("mouseenter", onTabMouseEnter)
    container.prepend(tab)
  }

  const deleteCount = tabsCount - itemList.length
  for (let i = 0; i < deleteCount; i++) {
    container.children[0].remove()
  }

  const newTabsCount = container.childElementCount - 1
  if (nextActiveIdx > -1) {
    await setActive(nextActiveIdx, sidebarBlocks)
    nextActiveIdx = -1
  } else if (!reordering) {
    if (lastTabsCount < newTabsCount) {
      await setActive(newTabsCount - 1, sidebarBlocks)
    } else {
      if (activeIdx >= itemList.length) {
        activeIdx = 0
      }
      await setActive(activeIdx, sidebarBlocks)
    }
  } else {
    await updateTabs(container, sidebarBlocks)
  }

  lastTabsCount = newTabsCount
  reordering = false
}

async function checkForPins(sidebarBlocks: any[]) {
  const pinnedBlocks = await readPinData(graphName, storage)

  const hasOpenings = pinnedBlocks.some(
    (b) => !sidebarBlocks.some(([, eid]) => b.id === eid || b.name === eid),
  )

  if (hasOpenings) {
    const filtered = sidebarBlocks.filter(([, eid]) =>
      pinnedBlocks.every((b) => eid !== b.id && eid !== b.name),
    )
    const pinned = pinnedBlocks
      .map((b) =>
        b.name === "contents"
          ? [graphUrl, "contents", "contents"]
          : [graphUrl, b.id, b.name ? "page" : "block"],
      )
      .reverse()
    const newSidebarBlocks = [...filtered, ...pinned]
    return [hasOpenings, newSidebarBlocks]
  }

  return [hasOpenings, null]
}

async function onTabCloseClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (target?.classList?.contains("kef-ts-block-close")) {
    e.stopImmediatePropagation()
    e.preventDefault()
    const container = target.parentElement!.parentElement!
    const index = Array.prototype.indexOf.call(
      container.children,
      target.parentElement!,
    )
    if (index < 0) return
    await close(index)
  }
}

async function onTabClick(e: MouseEvent) {
  e.preventDefault()

  const path = e.composedPath()
  const el = path.find(
    (x) => (x as Node).parentElement?.id === "kef-ts-tabs",
  ) as HTMLElement
  if (el == null) return
  const container = el.parentElement!
  const index = Array.prototype.indexOf.call(container.children, el)
  if (index < 0) return

  e.stopImmediatePropagation()

  if (e.shiftKey) {
    await openTab(index)
  } else {
    await setActive(index)
  }
}

async function onTabDoubleClick(e: MouseEvent) {
  e.preventDefault()

  const path = e.composedPath()
  const el = path.find(
    (x) => (x as Node).parentElement?.id === "kef-ts-tabs",
  ) as HTMLElement
  if (el == null) return
  const container = el.parentElement!
  const index = Array.prototype.indexOf.call(container.children, el)
  if (index < 0) return

  e.stopImmediatePropagation()

  await openTab(index)
}

async function onTabContextMenu(e: MouseEvent) {
  e.preventDefault()

  const path = e.composedPath()
  const el = path.find(
    (x) => (x as Node).parentElement?.id === "kef-ts-tabs",
  ) as HTMLElement
  if (el == null) return
  const container = el.parentElement!
  const index = Array.prototype.indexOf.call(container.children, el)
  if (index < 0) return

  e.stopImmediatePropagation()

  const menuContainer = parent.document.createElement("div")
  parent.document.body.append(menuContainer)
  // ensure context menu stays inside the viewport.
  const x = Math.min(e.clientX, parent.innerWidth - 168)
  const isPinned = el.classList.contains("kef-ts-pinned")
  const isMoved = el.classList.contains("kef-ts-moved")

  render(
    <Menu x={x} y={e.clientY} onClose={() => unrender(menuContainer)}>
      <button
        class="kef-ts-menu-item"
        onClick={() => open(index, menuContainer)}
      >
        {t("Open")}
      </button>
      {!isMoved && (
        <button
          class="kef-ts-menu-item"
          onClick={() =>
            isPinned ? unpin(index, menuContainer) : pin(index, menuContainer)
          }
        >
          {isPinned ? t("Unpin") : t("Pin")}
        </button>
      )}
      {!isMoved && moved.size < 2 && (
        <button
          class="kef-ts-menu-item"
          onClick={() => moveUp(index, menuContainer)}
        >
          {t("Move Up")}
        </button>
      )}
      {!isMoved && moved.size < 2 && (
        <button
          class="kef-ts-menu-item"
          onClick={() => moveDown(index, menuContainer)}
        >
          {t("Move Down")}
        </button>
      )}
      {isMoved && (
        <button
          class="kef-ts-menu-item"
          onClick={() =>
            moveBack(
              index,
              menuContainer,
              el.classList.contains("kef-ts-moved-up"),
            )
          }
        >
          {t("Move Back")}
        </button>
      )}
      {!isPinned && (
        <>
          <button
            class="kef-ts-menu-item"
            onClick={() => close(index, menuContainer)}
          >
            {t("Close")}
          </button>
          <button
            class="kef-ts-menu-item"
            onClick={() => closeOthers(index, menuContainer)}
          >
            {t("Close Others")}
          </button>
          <button
            class="kef-ts-menu-item"
            onClick={() => closeRight(index, menuContainer)}
          >
            {t("Close Tabs to the Right")}
          </button>
          <button
            class="kef-ts-menu-item"
            onClick={() => closeAll(menuContainer)}
          >
            {t("Close All")}
          </button>
        </>
      )}
    </Menu>,
    menuContainer,
  )
}

function onTabMouseEnter(e: MouseEvent) {
  const container = parent.document.getElementById("kef-ts-tabs")!
  const tooltip = parent.document.getElementById("kef-ts-tooltip")!
  const tab = e.target as HTMLElement
  const tabTitle = tab.querySelector(".kef-ts-block-title") as HTMLElement
  const tabRect = tab.getBoundingClientRect()

  if (tabRect.left + DECORATIVE_W + TOOLTIP_WIDTH > parent.innerWidth) {
    tooltip.style.translate = `${container.clientWidth - TOOLTIP_WIDTH}px`
  } else {
    tooltip.style.translate = `${tab.offsetLeft + DECORATIVE_W}px`
  }

  tooltip.innerText = tabTitle.innerText
  tooltip.style.display = "block"
}

function onTabMouseLeave(e: MouseEvent) {
  const tooltip = parent.document.getElementById("kef-ts-tooltip")!
  tooltip.style.display = ""
}

async function setActive(idx: number, sidebarBlocks?: any[], itemList?: any) {
  const container = parent.document.getElementById("kef-ts-tabs")
  if (container == null) return

  if (itemList == null) {
    itemList = parent.document.querySelectorAll(
      ".sidebar-item-list .sidebar-item.content",
    )
  }
  if (itemList == null) return

  const tabsCount = container.childElementCount - 1

  if (sidebarBlocks == null) {
    sidebarBlocks = (await logseq.App.getStateFromStore("sidebar/blocks"))!
  }
  if (sidebarBlocks.length === 0) {
    sidebarBlocks.push([graphUrl, "contents", "contents"])
  }

  const pinData = await readPinData(graphName, storage)

  for (let i = 0; i < tabsCount; i++) {
    const tab = container.children[i] as HTMLElement

    if (i === idx) {
      tab.classList.add("kef-ts-active")
    } else {
      tab.classList.remove("kef-ts-active")
    }

    if (i < pinData.length) {
      tab.classList.add("kef-ts-pinned")
    } else {
      tab.classList.remove("kef-ts-pinned")
    }

    const [, id] = sidebarBlocks[sidebarBlocks.length - 1 - i]
    if (moved.has(id)) {
      tab.classList.add("kef-ts-moved")
      tab.classList.remove("kef-ts-moved-up")
      tab.classList.remove("kef-ts-moved-down")
      tab.classList.add(`kef-ts-moved-${moved.get(id)}`)
    } else {
      tab.classList.remove("kef-ts-moved")
      tab.classList.remove("kef-ts-moved-up")
      tab.classList.remove("kef-ts-moved-down")
    }
  }

  lastActiveIdx = activeIdx
  activeIdx = idx

  const itemListLen = itemList.length
  let top = TAB_V_START // Default beginning
  let bottom = TAB_V_SPACING // Default beginning

  for (let i = 0; i < itemListLen; i++) {
    const item = itemList[itemListLen - 1 - i] as HTMLElement
    if (container.children[i].classList.contains("kef-ts-moved-up")) {
      item.dataset.moved = "true"
      item.style.display = ""
      item.style.top = `${top}px`
      item.style.bottom = ""
      const storedHeight = sessionStorage.getItem(`${TAB_V_HEIGHT_KEY}-${i}`)
      if (storedHeight != null) {
        item.style.height = storedHeight
      }
      sidebarResizeObserver.observe(item)

      const dragBar =
        (parent.document.querySelector(
          `.kef-ts-drag-bar[data-index="${i}"]`,
        ) as HTMLElement | null) ?? createDragBar(i, "up")
      const rect = item.getBoundingClientRect()
      dragBar.style.display = ""
      dragBar.style.top = `${rect.top + rect.height}px`
      dragBar.style.left = `${rect.left}px`

      top += item.offsetHeight + TAB_V_SPACING
    } else if (container.children[i].classList.contains("kef-ts-moved-down")) {
      item.dataset.moved = "true"
      item.style.display = ""
      item.style.bottom = `${bottom}px`
      item.style.top = ""
      const storedHeight = sessionStorage.getItem(`${TAB_V_HEIGHT_KEY}-${i}`)
      if (storedHeight != null) {
        item.style.height = storedHeight
      }
      sidebarResizeObserver.observe(item)

      const dragBar =
        (parent.document.querySelector(
          `.kef-ts-drag-bar[data-index="${i}"]`,
        ) as HTMLElement | null) ?? createDragBar(i, "down")
      const rect = item.getBoundingClientRect()
      dragBar.style.display = ""
      dragBar.style.top = `${rect.top - TAB_V_SPACING}px`
      dragBar.style.left = `${rect.left}px`

      bottom += item.offsetHeight + TAB_V_SPACING
    } else if (i === idx) {
      item.style.display = ""
      item.dataset.moved = ""
      item.style.top = ""
      item.style.bottom = ""
      sidebarResizeObserver.unobserve(item)
    } else {
      item.style.display = "none"
      item.dataset.moved = ""
      item.style.top = ""
      item.style.bottom = ""
      sidebarResizeObserver.unobserve(item)
    }
  }

  if (top > TAB_V_START) {
    container.style.marginTop = `${top - TAB_V_START}px`
  } else {
    container.style.marginTop = "0"
  }
  const sidebarListContainer = parent.document.querySelector(
    ".sidebar-item-list",
  ) as HTMLElement | null
  if (sidebarListContainer != null) {
    if (bottom === TAB_V_SPACING) {
      sidebarListContainer.style.height = `calc(100vh - ${
        top + bottom + TAB_V_SPACE_FIX
      }px)`
    } else {
      sidebarListContainer.style.height = `calc(100vh - ${
        top + bottom
      }px - 32px)`
    }
  }

  await updateTabs(container, sidebarBlocks)
}

async function updateTabs(container: HTMLElement, sidebarBlocks: any[]) {
  const tabs = container.querySelectorAll(".kef-ts-header")

  await Promise.all(
    Array.prototype.map.call(tabs, async (tab: HTMLElement, i) => {
      const [_graph, id, type] = sidebarBlocks[sidebarBlocks.length - 1 - i]
      const span = tab.querySelector(".kef-ts-block-title") as HTMLElement
      switch (type) {
        case "page": {
          const page = await logseq.Editor.getPage(id)
          if (page == null) return
          const icon =
            page.properties?.icon ??
            (tab.classList.contains("kef-ts-pinned") ? "📄" : "")
          const displayName = `${icon}${icon ? " " : ""}${page.originalName}`
          span.innerText = `${moved.has(id) ? "📍 " : ""}${displayName}`
          break
        }
        case "block": {
          const block = await logseq.Editor.getBlock(id)
          if (block == null) return
          let displayName
          if (block["preBlock?"]) {
            const page = (await logseq.Editor.getPage(block.page.id))!
            const icon =
              page.properties?.icon ??
              (tab.classList.contains("kef-ts-pinned") ? "📄" : "")
            displayName = `${icon}${icon ? " " : ""}${page.originalName}`
          } else {
            const icon =
              block.properties?.icon ??
              (tab.classList.contains("kef-ts-pinned") ? "📄" : "")
            displayName = `${icon}${icon ? " " : ""}${await parseContent(
              block.content,
            )}`
          }
          span.innerText = `${moved.has(id) ? "📍 " : ""}${displayName}`
          break
        }
        case "help": {
          span.innerText = `${moved.has(id) ? "📍 " : "🧐 "}${t("Help")}`
          break
        }
        case "pageGraph": {
          span.innerText = `${moved.has(id) ? "📍 " : "🧠 "}${t("Page graph")}`
          break
        }
        case "contents": {
          const page = (await logseq.Editor.getPage("contents"))!
          const icon =
            page.properties?.icon ??
            (tab.classList.contains("kef-ts-pinned") ? "📄" : "")
          const displayName = `${icon}${icon ? " " : ""}${t("Contents")}`
          span.innerText = `${moved.has(id) ? "📍 " : ""}${displayName}`
          break
        }
        default:
          break
      }
    }),
  )
}

async function onDrop(
  el: HTMLElement,
  target: HTMLElement,
  source: HTMLElement,
  sibling: HTMLElement,
) {
  const targetIndex =
    sibling == null
      ? target.childElementCount - 2
      : Array.prototype.indexOf.call(target.children, sibling) - 1
  drake.cancel(true)
  const sourceIndex = Array.prototype.indexOf.call(target.children, el)

  if (el.classList.contains("kef-ts-pinned")) {
    const pinData = await readPinData(graphName, storage)
    const src = pinData.splice(sourceIndex, 1)
    pinData.splice(targetIndex, 0, ...src)
    await writePinData(
      graphName,
      pinData.map((b) => b.name ?? b.uuid),
      storage,
    )
  }

  const stateSidebarBlocks = await logseq.App.getStateFromStore(
    "sidebar/blocks",
  )
  const stateSourceIndex = stateSidebarBlocks.length - 1 - sourceIndex
  const stateTargetIndex = stateSidebarBlocks.length - 1 - targetIndex
  const sourceItem = stateSidebarBlocks.splice(stateSourceIndex, 1)
  stateSidebarBlocks.splice(stateTargetIndex, 0, ...sourceItem)
  reordering = true
  logseq.App.setStateFromStore("sidebar/blocks", stateSidebarBlocks)
  if (
    (sourceIndex < activeIdx && targetIndex < activeIdx) ||
    (sourceIndex > activeIdx && targetIndex > activeIdx)
  ) {
    setTimeout(() => setActive(activeIdx), 16)
  } else if (sourceIndex > activeIdx) {
    nextActiveIdx = activeIdx + 1
    setActive(nextActiveIdx)
  } else if (sourceIndex < activeIdx) {
    nextActiveIdx = activeIdx - 1
    setActive(nextActiveIdx)
  } else if (targetIndex > activeIdx) {
    nextActiveIdx = activeIdx + (targetIndex - activeIdx)
    setActive(nextActiveIdx)
  } else {
    nextActiveIdx = activeIdx - (activeIdx - targetIndex)
    setActive(nextActiveIdx)
  }
}

function unrender(container?: HTMLElement) {
  if (!container) return
  render(null, container)
  container.remove()
}

async function openTab(index: number) {
  const sideBlocks = await logseq.App.getStateFromStore("sidebar/blocks")
  const [_graph, id, type] = sideBlocks[sideBlocks.length - 1 - index]
  switch (type) {
    case "page": {
      const page = await logseq.Editor.getPage(id)
      ;(logseq.Editor.scrollToBlockInPage as any)(page!.name)
      break
    }
    case "block": {
      const block = await logseq.Editor.getBlock(id)
      ;(logseq.Editor.scrollToBlockInPage as any)(block!.uuid)
      break
    }
    case "contents": {
      ;(logseq.Editor.scrollToBlockInPage as any)("contents")
      break
    }
    default:
      break
  }
}

async function open(index: number, container?: HTMLElement) {
  unrender(container)
  await openTab(index)
}

async function pin(index: number, container?: HTMLElement) {
  unrender(container)

  const block = await getBlock(index)
  if (block == null) return

  const pinData = await readPinData(graphName, storage)
  await persistBlockUUID(block)
  const pinned = pinData.map((b) => b.name ?? b.uuid)
  pinned.push(block.name ?? block.uuid)
  await writePinData(graphName, pinned, storage)

  await moveTab(index, pinned.length - 1)
}

async function unpin(index: number, container?: HTMLElement) {
  unrender(container)

  const block = await getBlock(index)
  if (block == null) return

  const pinData = await readPinData(graphName, storage)
  const to = pinData.length - 1

  const i = pinData.findIndex(
    (b) => b.name === block.name || b.uuid === block.uuid,
  )
  if (i > -1) {
    pinData.splice(i, 1)
  }

  await writePinData(
    graphName,
    pinData.map((b) => b.name ?? b.uuid),
    storage,
  )

  await moveTab(index, to)
}

async function moveUp(index: number, container?: HTMLElement) {
  unrender(container)

  const sidebarBlocks = await logseq.App.getStateFromStore("sidebar/blocks")
  const [, id] = sidebarBlocks[sidebarBlocks.length - 1 - index]
  moved.set(id, "up")

  const itemList = parent.document.querySelectorAll(
    ".sidebar-item-list .sidebar-item.content",
  )
  const item = itemList[itemList.length - 1 - index] as HTMLElement
  sidebarResizeObserver.observe(item)

  await setActive(activeIdx, sidebarBlocks, itemList)
}

async function moveDown(index: number, container?: HTMLElement) {
  unrender(container)

  const sidebarBlocks = await logseq.App.getStateFromStore("sidebar/blocks")
  const [, id] = sidebarBlocks[sidebarBlocks.length - 1 - index]
  moved.set(id, "down")

  const itemList = parent.document.querySelectorAll(
    ".sidebar-item-list .sidebar-item.content",
  )
  const item = itemList[itemList.length - 1 - index] as HTMLElement
  sidebarResizeObserver.observe(item)

  await setActive(activeIdx, sidebarBlocks, itemList)
}

async function moveBack(
  index: number,
  container: HTMLElement | undefined,
  fromUp: boolean,
) {
  unrender(container)

  const sidebarBlocks = await logseq.App.getStateFromStore("sidebar/blocks")
  const [, id] = sidebarBlocks[sidebarBlocks.length - 1 - index]
  moved.delete(id)

  const itemList = parent.document.querySelectorAll(
    ".sidebar-item-list .sidebar-item.content",
  )
  const item = itemList[itemList.length - 1 - index] as HTMLElement
  item.style.height = ""
  sidebarResizeObserver.unobserve(item)
  sessionStorage.removeItem(`${TAB_V_HEIGHT_KEY}-${index}`)

  removeDragBar(index)

  await setActive(activeIdx, sidebarBlocks)
}

async function close(index: number, container?: HTMLElement) {
  unrender(container)

  const sidebarBlocks = await logseq.App.getStateFromStore("sidebar/blocks")
  const realIndex = sidebarBlocks.length - 1 - index
  if (realIndex < 0) {
    await logseq.App.invokeExternalCommand("logseq.ui/toggle-right-sidebar")
    return
  }
  sidebarBlocks.splice(realIndex, 1)

  const tabs = parent.document.querySelectorAll("#kef-ts-tabs > .kef-ts-header")
  if (tabs) {
    nextActiveIdx = Math.min(
      tabs.length - 2,
      Math.max(0, index > activeIdx ? activeIdx : lastActiveIdx),
    )
  }

  await logseq.App.setStateFromStore("sidebar/blocks", sidebarBlocks)
}

async function closeOthers(index: number, container: HTMLElement) {
  unrender(container)
  const sidebarBlocks = await logseq.App.getStateFromStore("sidebar/blocks")
  const realIndex = sidebarBlocks.length - 1 - index
  const blocks = sidebarBlocks.splice(realIndex, 1)
  nextActiveIdx = 0
  await logseq.App.setStateFromStore("sidebar/blocks", blocks)
}

async function closeRight(index: number, container: HTMLElement) {
  unrender(container)
  const sidebarBlocks = await logseq.App.getStateFromStore("sidebar/blocks")
  const realIndex = sidebarBlocks.length - 1 - index
  sidebarBlocks.splice(0, realIndex)
  nextActiveIdx = Math.min(activeIdx, index)
  await logseq.App.setStateFromStore("sidebar/blocks", sidebarBlocks)
}

async function closeAll(container: HTMLElement) {
  unrender(container)
  logseq.App.clearRightSidebarBlocks({ close: true })
}

async function moveTab(from: number, to: number) {
  if (from !== to) {
    const stateSidebarBlocks = await logseq.App.getStateFromStore(
      "sidebar/blocks",
    )

    const stateSourceIndex = stateSidebarBlocks.length - 1 - from
    const stateTargetIndex = stateSidebarBlocks.length - 1 - to
    const sourceItem = stateSidebarBlocks.splice(stateSourceIndex, 1)
    stateSidebarBlocks.splice(stateTargetIndex, 0, ...sourceItem)

    reordering = true

    logseq.App.setStateFromStore("sidebar/blocks", stateSidebarBlocks)
  }

  setTimeout(() => setActive(to), 16)
}

function createDragBar(index: number, dir: "up" | "down") {
  const dragBar = parent.document.createElement("div")
  dragBar.style.display = "none"
  dragBar.classList.add("kef-ts-drag-bar")
  dragBar.dataset.index = `${index}`
  dragBar.dataset.dir = `${dir}`
  const sidebar = parent.document.getElementById("right-sidebar-container")!
  sidebar.append(dragBar)
  return dragBar
}

function removeDragBar(index: number) {
  const dragBar = parent.document.querySelector(
    `.kef-ts-drag-bar[data-index="${index}"]`,
  )
  if (dragBar != null) {
    dragBar.remove()
  }
}

let draggingTarget: HTMLElement | null = null
let startTop = ""

function onDragDown(e: PointerEvent) {
  if (draggingTarget) return
  const target = e.target as HTMLElement
  if (!target.classList?.contains("kef-ts-drag-bar")) return

  e.preventDefault()
  e.stopImmediatePropagation()

  draggingTarget = target
  startTop = target.style.top
}

function onDragMove(e: PointerEvent) {
  if (!draggingTarget) return

  e.preventDefault()
  e.stopImmediatePropagation()

  draggingTarget.style.top = `${e.y}px`
}

function onDragUp(e: PointerEvent) {
  if (!draggingTarget) return

  e.preventDefault()
  e.stopImmediatePropagation()

  const itemList = parent.document.querySelectorAll(
    ".sidebar-item-list .sidebar-item.content",
  )
  const item = itemList[
    itemList.length - 1 - +draggingTarget.dataset.index!
  ] as HTMLElement | null
  if (item == null) {
    onDragCancel(e)
    return
  }
  const dir = draggingTarget.dataset.dir
  const diff = e.y - parseInt(startTop)
  const newHeight = item.offsetHeight + (dir === "up" ? diff : -1 * diff)
  item.style.height = `${newHeight - TAB_V_DRAGBAR_SPACING}px`
  sessionStorage.setItem(
    `${TAB_V_HEIGHT_KEY}-${draggingTarget.dataset.index}`,
    item.style.height,
  )
  const dragBar = draggingTarget
  setTimeout(() => {
    const rect = item.getBoundingClientRect()
    dragBar.style.top =
      dir === "up"
        ? `${rect.top + rect.height + TAB_V_DRAGBAR_SPACING}px`
        : `${rect.top - TAB_V_DRAGBAR_SPACING}px`
  }, 0)
  draggingTarget = null
}

function onDragCancel(e: PointerEvent) {
  if (!draggingTarget) return

  e.preventDefault()
  e.stopImmediatePropagation()

  draggingTarget.style.top = startTop
  draggingTarget = null
}

logseq.ready(main).catch(console.error)
