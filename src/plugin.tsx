import "@logseq/libs"
import { setup } from "logseq-l10n"
import { render } from "preact"
import zhCN from "./translations/zh-CN.json"

async function main() {
  await setup({ builtinTranslations: { "zh-CN": zhCN } })

  provideStyles()

  // logseq.useSettingsSchema([
  //   {
  //     key: "drawShortcut",
  //     title: "",
  //     type: "string",
  //     default: "mod+d mod+d",
  //     description: t("Shortcut that triggers drawing."),
  //   },
  // ])

  // logseq.Editor.registerSlashCommand("Draw It", drawIt)
  // logseq.App.registerCommandPalette(
  //   {
  //     key: "kef-drawit-draw",
  //     label: t("Draw It"),
  //     ...(logseq.settings?.drawShortcut
  //       ? { keybinding: { binding: logseq.settings.drawShortcut } }
  //       : {}),
  //   },
  //   drawIt,
  // )

  console.log("#tabbed-sidebar loaded")
}

function provideStyles() {
  logseq.provideStyle({
    key: "kef-ts",
    style: `
    `,
  })
}

// function previewRenderer({
//   slot,
//   payload: { arguments: args, uuid },
// }: UISlotIdentity & { payload: { arguments: string[]; uuid: string } }) {
//   if (args[0] !== ":drawit") return

//   const slotEl = parent.document.getElementById(slot)
//   if (!slotEl) return
//   const renderered = slotEl.childElementCount > 0
//   if (renderered) return

//   logseq.provideUI({
//     key: `drawit`,
//     slot,
//     template: `<div id="kef-drawit-preview"></div>`,
//     reset: true,
//   })

//   setTimeout(() => renderPreview(uuid), 0)
// }

function renderPreview(uuid: string) {
  const el = parent.document.getElementById("kef-drawit-preview")
  if (el == null) return
  render(null, el)
}

logseq.ready(main).catch(console.error)
