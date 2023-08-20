import { IAsyncStorage } from "@logseq/libs/dist/modules/LSPlugin.Storage"
import { parse } from "./marked-renderer"

const TASK_REGEX = /^(?:TODO|LATER|DOING|NOW|DONE|CANCELED|WAITING) /

const PIN_DATA_KEY = "pin.json"

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

  // Remove tags.
  content = content.replace(/(^|\s)#((\[\[([^\]]|\](?!\]))+\]\])|\S+)/g, "")

  // Remove page refs
  content = content.replace(/\[\[([^\]]+)\]\]/g, "$1")

  return content.trim()
}

export function isElement(node: Node): node is HTMLElement {
  return node.nodeType === 1
}

export async function readPinData(storage: IAsyncStorage): Promise<string[]> {
  try {
    if (!(await storage.hasItem(PIN_DATA_KEY))) return []
    const pinStr = (await storage.getItem(PIN_DATA_KEY))!
    return JSON.parse(pinStr)
  } catch (err) {
    console.error(err)
    return []
  }
}

export async function writePinData(data: string[], storage: IAsyncStorage) {
  await storage.setItem(PIN_DATA_KEY, JSON.stringify(data))
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

export async function getBlocksFromUuids(uuids: string[]) {
  return await Promise.all(
    uuids.map(async (uuid) => {
      return (
        (await logseq.Editor.getPage(uuid)) ??
        (await logseq.Editor.getBlock(uuid))
      )
    }),
  )
}
