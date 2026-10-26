import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN_HERE";
const CHANNEL_ID = process.env.BACKUP_CHANNEL_ID || "YOUR_CHANNEL_ID_HERE";
const GDRIVE_CMD = "C:\\Users\\emoha\\.gemini\\config\\plugins\\gdrive\\skills\\gdrive\\scripts\\gdrive.cmd";
const TEMP_DIR = path.resolve("./temp_downloads");

const items = [
  // Compiler
  { driveId: "1OytLm6FJjpIkqQsRXnLstC1IrVWfsWER", fileName: "Lec 1.pdf", nodeId: 431, isExport: false, caption: "Compiler - Lecture 1" },
  { driveId: "1uTjqobs4RB3lvXGlg4Tgv3yx4ckN0pQn", fileName: "Lec 2.pdf", nodeId: 432, isExport: false, caption: "Compiler - Lecture 2" },
  { driveId: "1mJKNoMnkwONugUawQxm6qUDBDLLNR3qV", fileName: "Lec 3.pdf", nodeId: 433, isExport: false, caption: "Compiler - Lecture 3" },
  { driveId: "1RsmERqJ1eic9m0hhZzwQgmuW2wsSS0-J", fileName: "Compilers Section 1.pdf", nodeId: 434, isExport: false, caption: "Compiler - Section 1" },

  // Computer Animation
  { driveId: "17yfAX-ggXBXGfD-gW6TzQAor7TGgN9xG", fileName: "Computer_Animation_Course_Book.pdf", nodeId: 435, isExport: false, caption: "Computer Animation - Course Book" },
  { driveId: "1EaQ18ntLgD9auXGALoUTKNY-Mvk2LbyO", fileName: "Lecture_1_Ch01-02.pdf", nodeId: 436, isExport: false, caption: "Computer Animation - Lecture 1" },
  { driveId: "1SOGxIf4r7MgL0n8eVzR63u47274gHoNn", fileName: "Lecture_2_Ch03-04.pdf", nodeId: 437, isExport: false, caption: "Computer Animation - Lecture 2" },
  { driveId: "1KB7R7VyX5vADmMnyrk_s346lM_HScSOx", fileName: "Lecture_3_Ch05-06.pdf", nodeId: 438, isExport: false, caption: "Computer Animation - Lecture 3" },
  { driveId: "1wG4_7gzGUrdXLL0MeRwxOWh4USJyWkgS", fileName: "Lecture_4_Ch07-08.pdf", nodeId: 439, isExport: false, caption: "Computer Animation - Lecture 4" },
  { driveId: "11tAb0ulVGI2B5yIR6fWlYoSrJPFxaOPq", fileName: "Lecture_5_Ch09-10.pdf", nodeId: 440, isExport: false, caption: "Computer Animation - Lecture 5" },
  { driveId: "16bPGjkMCnwDdQcILlzf1WivTqNAsmBc-", fileName: "CA - Section 1.pdf", nodeId: 441, isExport: false, caption: "Computer Animation - Section 1" },
  { driveId: "10Pj_94TB7hOqUdQRFe5GxUt6IfxnRhcU", fileName: "CA - Section 2.pdf", nodeId: 442, isExport: false, caption: "Computer Animation - Section 2" },

  // Network Management
  { driveId: "1rThCamY6d7fK0756t9dnA9F7Dh-GYTsS", fileName: "Lec 1.pdf", nodeId: 443, isExport: false, caption: "Network Management - Lecture 1" },
  { driveId: "1IS-85mHhf-ul0It67taPnZhf4n956HlK", fileName: "Lec 2.pdf", nodeId: 444, isExport: false, caption: "Network Management - Lecture 2" },

  // Software Verification
  { driveId: "1TR-RF0rZCxW-VpWxHyIPEygVYV0C76kl", fileName: "Lec 1.pdf", nodeId: 445, isExport: false, caption: "Software Verification - Lecture 1" },
  { driveId: "115GWMwa6BCRV-CKf3dHUGGYgum0aVxhf", fileName: "Lec 2.pdf", nodeId: 446, isExport: false, caption: "Software Verification - Lecture 2" },
  { driveId: "1LuDuHRcVGvT03VEhr9X_fIiF2i_A6I33", fileName: "Lec 3.pdf", nodeId: 447, isExport: false, caption: "Software Verification - Lecture 3" },
  { driveId: "1_C0GUB1O3PMhOnIAM7u1XPO0fIY4jnuR1g6yKobSIiE", fileName: "Unit_Testing_Syllabus.pdf", nodeId: 448, isExport: true, caption: "Software Verification - Section 1" },
];

async function main() {
  console.log(`Starting sync of ${items.length} files from Google Drive to Telegram and Cloudflare D1...`);
  const sqlStatements = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const localFilePath = path.join(TEMP_DIR, item.fileName);
    console.log(`\n[${i + 1}/${items.length}] Processing: ${item.fileName}...`);

    try {
      // 1. Download or Export from Google Drive
      if (item.isExport) {
        execSync(`& "${GDRIVE_CMD}" readonly export ${item.driveId} "${localFilePath}" --format pdf`, { shell: "powershell" });
      } else {
        execSync(`& "${GDRIVE_CMD}" readonly download ${item.driveId} --out "${localFilePath}"`, { shell: "powershell" });
      }

      if (!fs.existsSync(localFilePath)) {
        console.error(`Failed to download: ${item.fileName}`);
        continue;
      }

      // 2. Upload to Telegram Backup Channel via fetch
      const fileBuffer = fs.readFileSync(localFilePath);
      const blob = new Blob([fileBuffer], { type: "application/pdf" });
      const formData = new FormData();
      formData.append("chat_id", CHANNEL_ID);
      formData.append("document", blob, item.fileName);
      formData.append("caption", item.caption);

      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!data.ok || !data.result?.document?.file_id) {
        console.error(`Telegram upload failed for ${item.fileName}:`, data);
        continue;
      }

      const fileId = data.result.document.file_id;
      console.log(`Uploaded to Telegram! file_id: ${fileId}`);

      // 3. Prepare SQL Insert
      const escapedFileName = item.fileName.replace(/'/g, "''");
      const escapedCaption = item.caption.replace(/'/g, "''");
      sqlStatements.push(
        `INSERT INTO materials (node_id, file_name, telegram_file_id, file_type, caption) VALUES (${item.nodeId}, '${escapedFileName}', '${fileId}', 'document', '${escapedCaption}');`
      );

      // Clean up temp file
      fs.unlinkSync(localFilePath);
    } catch (err) {
      console.error(`Error processing ${item.fileName}:`, err.message);
    }
  }

  // 4. Save SQL file and execute on D1
  if (sqlStatements.length > 0) {
    const sqlPath = path.resolve("./insert_synced_materials.sql");
    fs.writeFileSync(sqlPath, sqlStatements.join("\n"), "utf-8");
    console.log(`\nExecuting ${sqlStatements.length} insertions into Cloudflare D1...`);
    execSync(`npx wrangler d1 execute college_bot_db --remote --file="${sqlPath}"`, { stdio: "inherit", shell: "powershell" });
    console.log("\nAll files successfully synced to Telegram and indexed into D1 database!");
  }
}

main().catch(console.error);
