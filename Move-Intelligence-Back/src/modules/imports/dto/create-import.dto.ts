import { ImportSourceType } from '@prisma/client';

/** Origem já lida do upload multipart, pronta para o serviço processar. */
export interface UploadedImportFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  sourceType: ImportSourceType;
}
