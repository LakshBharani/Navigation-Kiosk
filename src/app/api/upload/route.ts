import { google } from "googleapis";
import { Readable } from "stream";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const FOLDER_NAME = "Map Screenshots"; // change to whatever you want
let cachedFolderId: string | null = null;

function getDrive() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: "v3", auth: oauth2 });
}

async function getFolderId(drive: ReturnType<typeof getDrive>) {
  if (cachedFolderId) return cachedFolderId;

  const list = await drive.files.list({
    q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
    spaces: "drive",
  });

  if (list.data.files && list.data.files.length > 0) {
    cachedFolderId = list.data.files[0].id!;
    return cachedFolderId;
  }

  const folder = await drive.files.create({
    requestBody: {
      name: FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });
  cachedFolderId = folder.data.id!;
  return cachedFolderId;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const drive = getDrive();
    const folderId = await getFolderId(drive);

    const created = await drive.files.create({
      requestBody: { name: file.name, parents: [folderId] },
      media: { mimeType: file.type, body: Readable.from(buffer) },
      fields: "id, name",
    });

    const fileId = created.data.id!;

    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
    });

    return NextResponse.json({
      id: fileId,
      name: created.data.name,
      viewUrl: `https://drive.google.com/file/d/${fileId}/view`,
      imageUrl: `https://drive.google.com/uc?export=view&id=${fileId}`,
    });
  } catch (err: any) {
    console.error(err?.response?.data ?? err);
    return NextResponse.json(
      { error: err?.message ?? "Upload failed" },
      { status: 500 }
    );
  }
}