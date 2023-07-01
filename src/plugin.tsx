import "@logseq/libs"
import { setup, t } from "logseq-l10n"
import { render } from "preact"
import Menu from "./comps/Menu"
import { isElement, parseContent } from "./libs/utils"
import zhCN from "./translations/zh-CN.json"

let lastSidebarItemCount = -1
let activeIdx = 0
let lastActiveIdx = 0
let lastDeleteIdx = -1
let reordering = false
let drake: any = null

async function main() {
  await setup({ builtinTranslations: { "zh-CN": zhCN } })

  injectDeps()
  provideStyles()

  const sidebarVisibleOffHook = logseq.App.onSidebarVisibleChanged(
    async ({ visible }) => {
      if (visible) {
        renderTabs()
      } else {
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
            refreshTabs(existent)
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
      padding: 0 0.5em;
      font-size: 0.875em;
    }
    #kef-ts-tabs > .flex {
      flex: 0 1 auto;
      min-width: 0;
      width: 150px;
      height: 30px;
      line-height: 30px;
      margin-right: 5px;
      padding-right: 5px;
      background-color: var(--ls-primary-background-color);
      border-radius: 4px;
      cursor: pointer;
    }
    #kef-ts-tabs > .flex:last-child {
      margin-right: 0;
    }
    #kef-ts-tabs > .flex > div {
      overflow: hidden;
      white-space: nowrap;
      justify-content: flex-start;
    }
    #kef-ts-tabs > .flex > div > a {
      display: none;
    }
    #kef-ts-tabs a.close > svg {
      width: 18px;
      height: 18px;
    }
    .kef-ts-active {
      background-color: var(--ls-selection-background-color) !important;
    }
    #kef-ts-tabs .mt-1.ml-1 {
      display: none;
    }
    .kef-ts-block-title {
      margin-right: 4px;
    }
    .kef-ts-block-title + a.page-title {
      display: inline-block;
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
    .sidebar-item .initial {
      margin-left: -20px;
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
  container.addEventListener("click", onTabClick)
  container.addEventListener("contextmenu", onTabContextMenu)
  topBar.after(container)

  drake = (parent as any).dragula([container], {
    direction: "horizontal",
    mirrorContainer: container,
  })
  drake.on("drop", onDrop)
}

function refreshTabs(hasExistent: boolean = false) {
  const container = parent.document.getElementById("kef-ts-tabs")
  if (container == null) return
  const itemList = parent.document.querySelector(".sidebar-item-list")
  if (itemList == null) return

  const newTabs = parent.document.querySelectorAll(
    ".sidebar-item > .flex-col > .flex",
  )
  newTabs.forEach((tab) => {
    container.prepend(tab)
  })

  const deleteCount = container.childElementCount - itemList.childElementCount
  for (let i = 0; i < deleteCount; i++) {
    container.children[0].remove()
  }

  if (
    (newTabs.length === 1 ||
      hasExistent ||
      (newTabs.length > lastSidebarItemCount && lastSidebarItemCount > -1)) &&
    !reordering
  ) {
    setActive(container.childElementCount - 1)
  } else if (newTabs.length > 1) {
    setActive(activeIdx)
  } else if (lastDeleteIdx > activeIdx) {
    setActive(
      activeIdx < container.childElementCount ? activeIdx : activeIdx - 1,
    )
  } else if (lastDeleteIdx === activeIdx) {
    setActive(
      lastActiveIdx > lastDeleteIdx
        ? lastActiveIdx - 1
        : lastActiveIdx < container.childElementCount
        ? lastActiveIdx
        : lastActiveIdx - 1,
    )
  } else {
    updateTabs(container)
  }
  lastDeleteIdx = -1
  reordering = false
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

  if (
    (e.target as HTMLElement).nodeName === "A" &&
    (e.target as HTMLElement).classList?.contains("close")
  ) {
    lastDeleteIdx = index
    return
  }

  e.stopImmediatePropagation()

  if (e.shiftKey) {
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
  } else {
    setActive(index)
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

async function setActive(idx: number, updateLastActive: boolean = true) {
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

  if (updateLastActive) {
    lastActiveIdx = activeIdx
  }
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
  await Promise.all(
    Array.prototype.map.call(container.children, async (tab, i) => {
      const [_graph, id, type] = sideBlocks[sideBlocks.length - 1 - i]
      const titleContainer = tab.querySelector(".ml-1.font-medium")
      if (titleContainer == null) return
      let span = titleContainer.querySelector(".kef-ts-block-title")
      if (span == null) {
        span = parent.document.createElement("span")
        span.classList.add("kef-ts-block-title")
        titleContainer.prepend(span)
      }

      switch (type) {
        case "page": {
          const page = await logseq.Editor.getPage(id)
          if (page == null) return
          span.innerHTML = page.properties?.icon ?? ""
          break
        }
        case "block":
        case "blockRef": {
          const block = await logseq.Editor.getBlock(id)
          if (block == null) return
          span.innerHTML = await parseContent(block.content)
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
  await logseq.App.setStateFromStore("sidebar/blocks", stateSidebarBlocks)

  if (
    (sourceIndex < activeIdx && targetIndex < activeIdx) ||
    (sourceIndex > activeIdx && targetIndex > activeIdx)
  )
    return
  if (sourceIndex > activeIdx) {
    await setActive(activeIdx + 1, false)
  } else if (sourceIndex < activeIdx) {
    await setActive(activeIdx - 1, false)
  } else if (targetIndex > activeIdx) {
    await setActive(activeIdx + (targetIndex - activeIdx), false)
  } else {
    await setActive(activeIdx - (activeIdx - targetIndex), false)
  }
}

function unrender(container: HTMLElement) {
  render(null, container)
  container.remove()
}

async function close(index: number, container: HTMLElement) {
  unrender(container)
  const sidebarBlocks = await logseq.App.getStateFromStore("sidebar/blocks")
  const realIndex = sidebarBlocks.length - 1 - index
  sidebarBlocks.splice(realIndex, 1)
  await logseq.App.setStateFromStore("sidebar/blocks", sidebarBlocks)
  setTimeout(() => {
    setActive(Math.max(0, activeIdx - 1))
  }, 50)
}

async function closeOthers(index: number, container: HTMLElement) {
  unrender(container)
  const sidebarBlocks = await logseq.App.getStateFromStore("sidebar/blocks")
  const realIndex = sidebarBlocks.length - 1 - index
  const blocks = sidebarBlocks.splice(realIndex, 1)
  await logseq.App.setStateFromStore("sidebar/blocks", blocks)
  setTimeout(() => {
    setActive(0)
  }, 50)
}

async function closeRight(index: number, container: HTMLElement) {
  unrender(container)
  const sidebarBlocks = await logseq.App.getStateFromStore("sidebar/blocks")
  const realIndex = sidebarBlocks.length - 1 - index
  sidebarBlocks.splice(0, realIndex)
  await logseq.App.setStateFromStore("sidebar/blocks", sidebarBlocks)
  setTimeout(() => {
    setActive(Math.min(activeIdx, index))
  }, 50)
}

async function closeAll(container: HTMLElement) {
  unrender(container)
  logseq.App.clearRightSidebarBlocks({ close: true })
}

logseq.ready(main).catch(console.error)
