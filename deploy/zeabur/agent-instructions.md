# 這台主機的工具

- 已裝好無頭 Chromium（`$CHROME_PATH`），含繁體中文與 emoji 字型；做完畫面請截圖自己檢查。
- 截圖：`od-screenshot <網址或 HTML 檔> <輸出.png> [寬] [高]`，加 `--full` 截整頁；截完用讀圖工具看 PNG。
- 要寫腳本時，`require("playwright-core")` 可直接用（已全域安裝），啟動時指定 `executablePath: process.env.CHROME_PATH` 並加 `--no-sandbox`。
- 另有 Pillow、numpy、fontTools（`pyftsubset`）、ImageMagick（`magick`）、ffmpeg、opencc、zip、gh 可用。
- 你沒有權限安裝系統套件：不要執行 `npx playwright install`、`apk add` 或下載其他瀏覽器，優先用上面已有的工具。
