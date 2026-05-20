import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

const s3 = new S3Client({});
const RESIZED_BUCKET = process.env.RESIZED_BUCKET;

export const handler = async (event) => {
  for (const record of event.Records) {
    const sourceBucket = record.s3.bucket.name;
    const key = decodeURIComponent(
      record.s3.object.key.replace(/\+/g, " ")
    );

    const original = await s3.send(
      new GetObjectCommand({ Bucket: sourceBucket, Key: key })
    );

    const buffer = Buffer.concat(await original.Body.toArray());

    const resized = await sharp(buffer)
      .resize(300, 300, { fit: "inside" })
      .jpeg({ quality: 80 })
      .toBuffer();

    await s3.send(
      new PutObjectCommand({
        Bucket: RESIZED_BUCKET,
        Key: key,
        Body: resized,
        ContentType: "image/jpeg",
      })
    );

    console.log(`Resized ${key} and saved to ${RESIZED_BUCKET}`);
  }
};