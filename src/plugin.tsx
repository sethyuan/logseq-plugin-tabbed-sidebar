import "@logseq/libs"
import { setup } from "logseq-l10n"
import { isElement, parseContent } from "./libs/utils"
import zhCN from "./translations/zh-CN.json"

let activeIdx = 0
let lastActiveIdx = 0
let lastDeleteIdx = -1

async function main() {
  await setup({ builtinTranslations: { "zh-CN": zhCN } })

  provideStyles()

  const offHook = logseq.App.onSidebarVisibleChanged(({ visible }) => {
    if (!visible) return
    renderTabs()
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

  logseq.beforeunload(async () => {
    sidebarItemObserver?.disconnect()
    offHook()
  })

  console.log("#tabbed-sidebar loaded")
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
  topBar.after(container)

  setActive(0)
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

  if (newTabs.length === 1 || hasExistent) {
    setActive(container.childElementCount - 1)
  } else if (newTabs.length > 0) {
    setActive(0)
  } else if (lastDeleteIdx > activeIdx) {
    lastDeleteIdx = -1
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
        case "block": {
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

logseq.ready(main).catch(console.error)
