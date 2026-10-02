import { v2 as cloudinary } from "cloudinary";

const FOLDER = "documents";
const OPTIONS = { resource_type: "raw", type: "private" };

let configured = false;

function setup() {
  if (configured) return;
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
    process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error("Variables CLOUDINARY_* non définies");
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
}

/** Uploads a buffer as a raw file; returns its public_id (the "key"). */
export function upload(fileName, buffer) {
  setup();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        ...OPTIONS,
        folder: FOLDER,
        // For raw files the extension must be part of the public_id.
        public_id: fileName,
        use_filename: false,
        unique_filename: false,
        overwrite: false,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.public_id);
      },
    );
    stream.end(buffer);
  });
}

/** Temporary download URL (default 1 h). */
export function url(publicId, expiresInSeconds = 3600) {
  setup();
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return cloudinary.utils.private_download_url(publicId, undefined, {
    ...OPTIONS,
    expires_at: expiresAt,
  });
}

export async function remove(publicId) {
  setup();
  const result = await cloudinary.uploader.destroy(publicId, OPTIONS);
  if (result.result !== "ok" && result.result !== "not found") {
    throw new Error(`Suppression Cloudinary : ${result.result}`);
  }
}
