import { Injectable } from '@nestjs/common';

@Injectable()
export class TranslationService {
  async translateToPortuguese(text: string): Promise<string> {
    return text;
  }
}
