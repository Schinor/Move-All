import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { ImportsService, resolveSourceType } from './imports.service';

/** Request Fastify com o método `.file()` injetado pelo @fastify/multipart. */
type MultipartRequest = FastifyRequest & {
  isMultipart(): boolean;
  file(): Promise<MultipartFile | undefined>;
};

@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /** Upload de 1 arquivo `.csv`/`.xlsx` (campo `file`); body opcional `sourceType`. */
  @Post()
  async upload(@Req() req: FastifyRequest) {
    const multipartReq = req as MultipartRequest;
    if (!multipartReq.isMultipart()) {
      throw new BadRequestException(
        'A requisição deve ser multipart/form-data com o campo "file".',
      );
    }

    const data = await multipartReq.file();
    if (!data) {
      throw new BadRequestException('Nenhum arquivo enviado (campo "file").');
    }

    const buffer = await data.toBuffer();
    const sourceTypeField = data.fields?.sourceType as
      { value?: string } | undefined;

    return this.imports.createFromUpload({
      buffer,
      originalName: data.filename,
      mimeType: data.mimetype,
      sourceType: resolveSourceType(sourceTypeField?.value),
    });
  }

  @Get()
  list(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.imports.list(skip ? Number(skip) : 0, take ? Number(take) : 20);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.imports.getById(id);
  }

  @Post(':id/reprocess')
  reprocess(@Param('id') id: string) {
    return this.imports.reprocess(id);
  }
}
