<p align="center">
  <img src="public/sparkle-logo.png" alt="Sparkle" width="520">
</p>

<p align="center">
  <a href="README.zh-TW.md">繁體中文</a> ·
  <a href="README.md">English</a>
</p>

<p align="center">
  私人、離線優先的圖片與 AI 提示詞管理工具。
</p>

<a href="https://github.com/AmeMizuki/sparkle/releases/download/readme-assets/preview-dashboard.mp4">
  <img src="https://github.com/AmeMizuki/sparkle/releases/download/readme-assets/preview-2.webp" alt="Sparkle Preview" width="100%">
</a>

## ✨ 功能特色

- **資料留在本機。** 圖片與縮圖儲存在瀏覽器中，匯入的檔案不會上傳。
- **瀏覽與整理。** 匯入圖片或巢狀資料夾、收藏圖片，並建立分類收藏集。
- **檢視生成資訊。** 查看正向／負向提示詞、生成設定、原始中繼資料，並縮放檢視原始尺寸圖片。
- **快速搜尋。** 搜尋檔名、生成器名稱與 ISO 日期；可依來源或日期篩選並排序。較長的搜尋詞可容忍一個字元的拼寫錯誤。
- **自訂工作區。** 可選擇英文或繁體中文、系統／淺色／深色外觀，以及強調色和背景色。設定會保留，並在首次繪製前套用。
- **專注瀏覽。** 左側邊欄可收合為圖示列（左上角按鈕或 `[` 鍵），手機上則以滑入式抽屜顯示。動畫會遵循 `prefers-reduced-motion` 設定及瀏覽器支援狀況。

## 中繼資料支援

可讀取 PNG `tEXt`、`zTXt`、`iTXt`，JPEG EXIF／XMP／註解，以及 WebP EXIF／XMP。可正規化 Automatic1111 生成文字、ComfyUI 提示詞圖（包含自訂取樣器）、NovelAI 註解與 SwarmUI JSON。原始中繼資料會保留；擷取警告不會中斷匯入。

自訂節點或已移除的中繼資料可能導致欄位無法辨識。ComfyUI 圖表有多個輸出分支時，Sparkle 會使用最近連接的取樣器，並保留原始圖表資料供檢視。日期採用來源檔案的最後修改時間，而非宣稱的生成時間。

## 開發

```sh
npm install
npm run dev
```

執行檢查與測試：

```sh
npm run check
npm test
```

## 儲存提醒

靜態 PNG、JPEG 與 WebP 匯入後，會在檔案更小時使用完整解析度的 WebP（品質 0.86）。Prompt 與原始 Metadata 獨立保存在圖庫，不會嵌入壓縮後的下載檔。動態圖片、GIF／AVIF，以及轉換失敗或無法縮小的圖片保留來源內容。既有圖庫不會重新壓縮，也不會更動裝置上的來源檔案。

瀏覽器網站資料不是備份；清除資料會刪除圖片庫。請保留來源檔案備份，下載的壓縮圖片不包含獨立儲存的生成 Metadata。儲存保護功能會向瀏覽器要求持續性儲存，但瀏覽器可能拒絕。從 Sparkle 匯入或移除圖片不會更動裝置上的原始檔案。

