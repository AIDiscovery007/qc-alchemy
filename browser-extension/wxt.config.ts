import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "QC Alchemy · 图片风格逆向",
    description:
      "选择网页图片，交给本机 Codex 与 Alchemy 技能，提炼可复用的提示词。",
    minimum_chrome_version: "116",
    permissions: ["storage", "contextMenus", "activeTab"],
    host_permissions: ["<all_urls>"],
    action: { default_title: "打开 QC Alchemy" },
  },
});
