import "@logseq/libs"
import { setup, t } from "logseq-l10n"
import { render } from "preact"
import Menu from "./comps/Menu"
import { isElement, parseContent } from "./libs/utils"
import zhCN from "./translations/zh-CN.json"

let todayPageId = 0
let lastSidebarItemCount = -1
let sidebarItemBeforeClosed: string | number = ""
let activeIdx = 0
let lastActiveIdx = 0
let lastDeleteIdx = -1
let reordering = false
let drake: any = null
let nextActiveIdx = -1

async function main() {
  await setup({ builtinTranslations: { "zh-CN": zhCN } })

  injectDeps()
  provideStyles()

  const sidebarVisibleOffHook = logseq.App.onSidebarVisibleChanged(
    async ({ visible }) => {
      if (visible) {
        renderTabs()
        const todayPageName = await logseq.App.getStateFromStore("today")
        const today = await logseq.Editor.getPage(todayPageName)
        todayPageId = today!.id
      } else {
        const items = await logseq.App.getStateFromStore("sidebar/blocks")
        ;[, sidebarItemBeforeClosed] = items[0] ?? []
        lastSidebarItemCount = (
          await logseq.App.getStateFromStore("sidebar/blocks")
        ).length
      }
    },
  )

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
            refreshTabs(
              existent,
              node.parentElement?.classList.contains("contents"),
            )
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
  }

  const graphChangeOffHook = logseq.App.onCurrentGraphChanged(() => {
    logseq.App.clearRightSidebarBlocks()
  })

  logseq.beforeunload(async () => {
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
      padding: 0 0.5em;
      background-color: var(--ls-primary-background-color);
      border-radius: 4px;
      cursor: pointer;
    }
    .kef-ts-active {
      background-color: var(--ls-selection-background-color) !important;
    }
    .kef-ts-block-title {
      flex: 1 1 auto;
      margin-right: 4px;
      overflow: hidden;
      white-space: nowrap;
    }
    .kef-ts-block-close {
      flex: 0 0 auto;
      font-family: 'tabler-icons';
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
    .sidebar-item > .flex > .flex > .flex > a {
      display: none;
    }
    .sidebar-item a.close {
      display: none;
    }
    .sidebar-item a.page-title {
      display: none;
    }
    .sidebar-item .initial > .ml-2 {
      margin-left: 0;
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
  container.addEventListener("contextmenu", onTabContextMenu)
  topBar.after(container)

  drake = (parent as any).dragula([container], {
    direction: "horizontal",
    mirrorContainer: container,
  })
  drake.on("drop", onDrop)
}

async function refreshTabs(
  hasExistent: boolean = false,
  isContents: boolean = false,
) {
  const sidebarBlocks = await logseq.App.getStateFromStore("sidebar/blocks")
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

  const container = parent.document.getElementById("kef-ts-tabs")
  if (container == null) return
  const itemList = parent.document.querySelector(".sidebar-item-list")
  if (itemList == null) return

  const newCount = itemList.childElementCount - container.childElementCount
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
    container.prepend(tab)
  }

  const deleteCount = container.childElementCount - itemList.childElementCount
  for (let i = 0; i < deleteCount; i++) {
    container.children[0].remove()
  }

  const [, topItemId] = sidebarBlocks[0] ?? []
  if (nextActiveIdx > -1) {
    await setActive(nextActiveIdx)
    nextActiveIdx = -1
  } else if (isContents) {
    const index = sidebarBlocks.findIndex(
      ([, , type]: [any, any, string]) => type === "contents",
    )
    if (index > -1) {
      await setActive(sidebarBlocks.length - 1 - index)
    }
  } else if (
    (newCount === 1 ||
      (hasExistent && !isContents) ||
      sidebarItemBeforeClosed !== topItemId ||
      topItemId === todayPageId ||
      (newCount > lastSidebarItemCount && lastSidebarItemCount > -1)) &&
    !reordering
  ) {
    await setActive(container.childElementCount - 1)
  } else if (newCount > 1) {
    await setActive(activeIdx)
  } else if (lastDeleteIdx > activeIdx) {
    await setActive(
      activeIdx < container.childElementCount ? activeIdx : activeIdx - 1,
    )
  } else if (lastDeleteIdx === activeIdx) {
    await setActive(
      lastActiveIdx > lastDeleteIdx
        ? lastActiveIdx - 1
        : lastActiveIdx < container.childElementCount
        ? lastActiveIdx
        : lastActiveIdx - 1,
    )
  } else {
    await updateTabs(container)
  }
  lastDeleteIdx = -1
  reordering = false
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
    lastDeleteIdx = index
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
  render(
    <Menu x={x} y={e.clientY} onClose={() => unrender(menuContainer)}>
      <button
        class="kef-ts-menu-item"
        onClick={() => open(index, menuContainer)}
      >
        {t("Open")}
      </button>
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
      <button class="kef-ts-menu-item" onClick={() => closeAll(menuContainer)}>
        {t("Close All")}
      </button>
    </Menu>,
    menuContainer,
  )
}

async function setActive(idx: number) {
  const container = parent.document.getElementById("kef-ts-tabs")
  if (container == null) return
  const itemList = parent.document.querySelector(".sidebar-item-list")
  if (itemList == null) return

  for (let i = 0; i < container.children.length; i++) {
    const tab = container.children[i] as HTMLElement
    if (i === idx) {
      tab.classList.add("kef-ts-active")
    } else {
      tab.classList.remove("kef-ts-active")
    }
  }

  lastActiveIdx = activeIdx
  activeIdx = idx

  const itemListLen = itemList.children.length
  for (let i = 0; i < itemListLen; i++) {
    const item = itemList.children[itemListLen - 1 - i] as HTMLElement
    if (i === idx) {
      item.style.display = ""
    } else {
      item.style.display = "none"
    }
  }

  await updateTabs(container)
}

async function updateTabs(container: HTMLElement) {
  const sideBlocks = await logseq.App.getStateFromStore("sidebar/blocks")
  if (sideBlocks.length === 0) {
    sideBlocks.push(["", "contents", "contents"])
  }
  await Promise.all(
    Array.prototype.map.call(container.children, async (tab, i) => {
      const [_graph, id, type] = sideBlocks[sideBlocks.length - 1 - i]
      const span = tab.querySelector(".kef-ts-block-title")
      switch (type) {
        case "page": {
          const page = await logseq.Editor.getPage(id)
          if (page == null) return
          const displayName = `${page.properties?.icon ?? ""} ${
            page.originalName
          }`
          span.innerHTML = displayName
          span.title = displayName
          break
        }
        case "block": {
          const block = await logseq.Editor.getBlock(id)
          if (block == null) return
          const displayName = await parseContent(block.content)
          span.innerHTML = displayName
          span.title = displayName
          break
        }
        case "help": {
          span.innerHTML = t("Help")
          span.title = ""
          break
        }
        case "pageGraph": {
          span.innerHTML = t("Page graph")
          span.title = ""
          break
        }
        case "contents": {
          span.innerHTML = t("Contents")
          span.title = ""
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
      ? target.childElementCount - 1
      : Array.prototype.indexOf.call(target.children, sibling) - 1
  drake.cancel(true)
  const sourceIndex = Array.prototype.indexOf.call(target.children, el)

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
    // Do nothing
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

async function close(index: number, container?: HTMLElement) {
  unrender(container)
  const sidebarBlocks = await logseq.App.getStateFromStore("sidebar/blocks")
  const realIndex = sidebarBlocks.length - 1 - index
  if (realIndex < 0) {
    await logseq.App.invokeExternalCommand("logseq.ui/toggle-right-sidebar")
    return
  }
  sidebarBlocks.splice(realIndex, 1)
  nextActiveIdx = Math.max(0, index > activeIdx ? activeIdx : activeIdx - 1)
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

logseq.ready(main).catch(console.error)
