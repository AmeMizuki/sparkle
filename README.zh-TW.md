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
- **容量與匯入結果。** 設定顯示網站已用空間與瀏覽器估計配額，寫入後及每 30 秒更新。配額不足時停止匯入，明確列出成功與未匯入數量；先前成功的圖片仍保留。
- **可選圖片儲存方式。** 每批匯入（含拖放與資料夾）可保留原檔，或縮小並轉成 WebP。
- **分段 ZIP 備份。** 設定中的「匯出／備份圖庫」包含已儲存圖片、縮圖、Prompt、Metadata、分類與偏好設定，每份 ZIP 不超過 200 MB。

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

每批匯入前會詢問是否保持原圖解析度。預設保留完整原檔；選擇「否」則轉成 WebP（品質 0.86），最長邊限制為 2048 像素、不放大小圖，即使轉換檔較大仍使用 WebP。Prompt 與原始 Metadata 另行保存在圖庫，不會嵌入轉換後的圖片。動態圖片需使用原圖模式；靜態 GIF／AVIF 轉換需要瀏覽器 `ImageDecoder` 支援。無法安全判斷影格或轉換失敗時，該檔案會列為匯入失敗，不會默默存回原檔。既有圖庫與裝置上的來源檔案不會變更。

瀏覽器網站資料不是備份，清除資料會刪除圖庫。容量估計包含此網站的資料庫、縮圖與快取；配額會變動，不保證全部可供寫入，不支援估計的瀏覽器會明確顯示「無法取得估計值」。儲存保護會要求持續性儲存，但瀏覽器可能拒絕。配額錯誤時，該圖片與 Metadata 的寫入會一併撤回、停止處理剩餘檔案；先前成功匯入的圖片不會刪除。

### 匯出與備份

在設定中建立備份後，逐一下載所有 ZIP 連結。每份最多 **200,000,000 位元組（200 MB）**，可各自解壓；圖片採 ZIP 儲存方式避免對已壓縮圖片重複壓縮，JSON 資料採 DEFLATE。超過單份容量的圖片或 Metadata 會拆成資料區塊，ZIP 標頭與清單也計入容量上限。

每份包含 `manifest.json`、`RECOVERY.txt` 與資料區塊。請按復原說明將相同邏輯檔案的區塊依 `offset` 串接，保留獨立 Metadata。僅最後一份清單標記 `complete: true` 與 `totalParts`；需集齊相同 `backupId` 的全部分段才是完整備份。匯出失敗會顯示未完成警告，請重試、勿先刪除資料。下載連結會在重新整理或下一次備份時失效。

備份保存圖庫目前的完整資料，不包含先前轉換時捨棄的原始圖片，也不會把 Metadata 重新嵌入圖片。目前可依內附說明離線還原檔案與 JSON，沒有圖庫一鍵還原介面。

