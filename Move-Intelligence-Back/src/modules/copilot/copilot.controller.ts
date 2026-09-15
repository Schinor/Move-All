import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CopilotService } from './copilot.service';
import { CopilotChatDto } from './dto/copilot-chat.dto';
import { UpdateCopilotConversationDto } from './dto/update-copilot-conversation.dto';

@Controller('copilot')
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Get('conversations')
  listConversations(@Query('client_id') clientId?: string) {
    return this.copilot.listConversations(clientId);
  }

  @Get('conversations/:id')
  getConversation(@Param('id') id: string, @Query('client_id') clientId?: string) {
    return this.copilot.getConversation(id, clientId);
  }

  @Delete('conversations/:id')
  deleteConversation(@Param('id') id: string, @Query('client_id') clientId?: string) {
    return this.copilot.deleteConversation(id, clientId);
  }

  @Patch('conversations/:id')
  updateConversation(
    @Param('id') id: string,
    @Query('client_id') clientId: string | undefined,
    @Body() dto: UpdateCopilotConversationDto,
  ) {
    return this.copilot.updateConversation(id, dto, clientId);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('chat')
  chat(@Body() dto: CopilotChatDto) {
    return this.copilot.chat(dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('chat/stream')
  async chatStream(@Body() dto: CopilotChatDto, @Res() res: any) {
    const raw = res?.raw ?? res;

    if (typeof raw?.setHeader === 'function') {
      raw.setHeader('Content-Type', 'text/event-stream');
      raw.setHeader('Cache-Control', 'no-cache, no-transform');
      raw.setHeader('Connection', 'keep-alive');
      raw.setHeader('X-Accel-Buffering', 'no');
      raw.flushHeaders?.();
    } else if (typeof res?.header === 'function') {
      res.header('Content-Type', 'text/event-stream');
      res.header('Cache-Control', 'no-cache, no-transform');
      res.header('Connection', 'keep-alive');
      res.header('X-Accel-Buffering', 'no');
    }

    // P0-5: a resposta não depende da conexão — `close` só interrompe a
    // escrita, nunca a geração (o service salva no finally).
    let closed = false;
    try {
      raw?.on?.('close', () => {
        closed = true;
      });
    } catch {
      // Sem suporte a eventos: segue escrevendo com as guardas abaixo.
    }
    const safeWrite = (data: string): void => {
      try {
        if (closed || raw?.writableEnded || raw?.destroyed) return;
        if (typeof raw?.write === 'function') raw.write(data);
      } catch {
        // Socket fechado: nunca lança.
        closed = true;
      }
    };

    try {
      for await (const chunk of this.copilot.chatStream(dto)) {
        safeWrite(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      safeWrite('data: [DONE]\n\n');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      safeWrite(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
    } finally {
      try {
        if (typeof raw?.end === 'function' && !raw?.writableEnded) raw.end();
      } catch {
        // Socket fechado: nunca lança.
      }
    }
  }
}
