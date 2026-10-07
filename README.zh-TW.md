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

圖片與縮圖以 Blob 儲存在獨立的 IndexedDB 儲存區，只有 ID 主鍵；次要索引僅涵蓋 Metadata。既有圖庫會自動遷移。每頁顯示 24 張圖片，卡片進入可視範圍才讀取 Blob；圖片卸載或切換預覽解析度時會釋放 Object URL。

圖片與分類 ID 優先使用 `crypto.randomUUID()`；無此 API 時，改用 `crypto.getRandomValues()` 產生 UUIDv4，讓非安全環境仍可匯入圖片及建立分類。Service Worker 與持續性儲存申請等安全環境功能，仍需使用 HTTPS 或 localhost。

瀏覽器網站資料不是備份；清除資料會刪除圖片庫。請保留來源檔案備份，下載的壓縮圖片不包含獨立儲存的生成 Metadata。Sparkle 啟動時會要求持續性儲存；瀏覽器拒絕或不支援 API 時，可使用儲存保護按鈕再次申請。核准後可避免儲存空間壓力造成的自動清除，但無法防止手動清除網站資料，也不代表容量無上限。從 Sparkle 匯入或移除圖片不會更動裝置上的原始檔案。

「設定 → 本地儲存」提供「刪除所有圖片」。必須先確認刪除意願，再將顯示的 6 位英數確認碼逐字輸入六格 OTP 樣式欄位。確認碼區禁止選取與複製；輸入欄拒絕貼上、拖放、自動填入與程式合成的輸入事件。小寫字母會轉為大寫，輸入後自動移至下一格，並支援方向鍵、Backspace 與 Delete。取消、關閉或輸入錯誤確認碼都不會刪除圖庫。確認成功後，會以同一個交易刪除所有圖片 Metadata、圖片與縮圖，保留分類、偏好設定及裝置上的來源檔案。
