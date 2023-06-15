import { parse } from "./marked-renderer"

export async function parseContent(content: string) {
  // Use only the first line.
  content = content.match(/.*/)![0]

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
      const [refContent] = refFirstLine
        ? await parseContent(refFirstLine)
        : [refUUID]
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

  // Remove marker
  content = content.replace(
    /^(?:LATER|NOW|TODO|DOING|DONE|WAITING|CANCELED) /g,
    "",
  )

  return content.trim()
}
