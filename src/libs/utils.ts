import { BlockEntity, PageEntity } from "@logseq/libs/dist/LSPlugin.user"
import { IAsyncStorage } from "@logseq/libs/dist/modules/LSPlugin.Storage"
import { parse } from "./marked-renderer"

const TASK_REGEX = /^(?:TODO|LATER|DOING|NOW|DONE|CANCEL{1,2}ED|WAITING) /

const PIN_KEY = "pin.json"

export async function parseContent(content: string) {
  // Use only the first line.
  content = content.match(/.*/)![0]

  // Remove task markers.
  content = content.replace(TASK_REGEX, "")

  // Remove macro renderers.
  content = content.replace(/ \{\{renderer (?:\}[^\}]|[^\}])+\}\}/g, "")

  // Handle markdown.
  content = parse(content)

  // Replace block refs with their content.
  let match
  while ((match = /(?:\(\()(?!\()([^\)]+)\)\)/g.exec(content)) != null) {
    const start = match.index
    const end = start + match[0].length
    const refUUID = match[1]
    try {
      const refBlock = await logseq.Editor.getBlock(refUUID)
      const refFirstLine = refBlock?.content.match(/.*/)?.[0]
      const refContent = refFirstLine
        ? await parseContent(refFirstLine)
        : refUUID
      content = `${content.substring(0, start)}${refContent}${content.substring(
        end,
      )}`
    } catch (err) {
      // ignore err
      break
    }
  }

  // Remove page refs
  content = content.replace(/\[\[([^\]]+)\]\]/g, "$1")

  return content.trim()
}

export function isElement(node: Node): node is HTMLElement {
  return node.nodeType === 1
}

export interface PinData {
  pinned: PinItem[]
  unpinned: PinItem[]
}

export interface PinItem {
  id: string
  block?: BlockEntity | PageEntity | null
  moved?: "up" | "down"
  height?: string
}

export async function readPinData(
  graphName: string,
  storage: IAsyncStorage,
): Promise<PinData> {
  const pinKey = `${graphName}-${PIN_KEY}`
  try {
    if (!(await storage.hasItem(pinKey))) return { pinned: [], unpinned: [] }
    const pinStr = (await storage.getItem(pinKey))!
    const json = JSON.parse(pinStr)
    const pinData: PinData = Array.isArray(json)
      ? {
          pinned: (
            await Promise.all(
              json.map(async (id: string) => {
                return {
                  id,
                  pinned: true,
                  block:
                    (await logseq.Editor.getPage(id)) ??
                    (await logseq.Editor.getBlock(id)),
                }
              }),
            )
          ).filter((item) => item.block != null) as PinItem[],
          unpinned: [],
        }
      : {
          pinned: (
            await Promise.all(
              json.pinned.map(async (item: PinItem) => {
                item.block =
                  (await logseq.Editor.getPage(item.id)) ??
                  (await logseq.Editor.getBlock(item.id))
                return item
              }),
            )
          ).filter((item) => item.block != null) as PinItem[],
          unpinned: (
            await Promise.all(
              json.unpinned.map(async (item: PinItem) => {
                item.block =
                  (await logseq.Editor.getPage(item.id)) ??
                  (await logseq.Editor.getBlock(item.id))
                return item
              }),
            )
          ).filter((item) => item.block != null) as PinItem[],
        }

    if (
      Array.isArray(json)
        ? pinData.pinned.length < json.length
        : pinData.pinned.length < json.pinned.length ||
          pinData.unpinned.length < json.unpinned.length
    ) {
      await writePinData(graphName, pinData, storage)
    }

    return pinData
  } catch (err) {
    console.error(err)
    return { pinned: [], unpinned: [] }
  }
}

export async function writePinData(
  graphName: string,
  data: PinData,
  storage: IAsyncStorage,
) {
  const pinKey = `${graphName}-${PIN_KEY}`
  data = {
    pinned: data.pinned.map((item) => {
      const ret = { ...item }
      delete ret.block
      return ret
    }),
    unpinned: data.unpinned.map((item) => {
      const ret = { ...item }
      delete ret.block
      return ret
    }),
  }
  await storage.setItem(pinKey, JSON.stringify(data))
}

export async function getBlock(index: number) {
  const sideBlocks = await logseq.App.getStateFromStore("sidebar/blocks")
  const [_graph, id, type] = sideBlocks[sideBlocks.length - 1 - index]

  switch (type) {
    case "page": {
      return await logseq.Editor.getPage(id)
    }
    case "block": {
      return await logseq.Editor.getBlock(id)
    }
    case "contents": {
      return await logseq.Editor.getPage("contents")
    }
    default:
      return null
  }
}

export async function persistBlockUUID(block: BlockEntity | PageEntity) {
  if (block.name) return
  if (!(await logseq.Editor.getBlockProperty(block.uuid, "id"))) {
    await logseq.Editor.upsertBlockProperty(block.uuid, "id", block.uuid)
  }
}
