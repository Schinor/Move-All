import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { CopilotService } from './copilot.service';
import { CopilotChatDto } from './dto/copilot-chat.dto';
import { UpdateCopilotConversationDto } from './dto/update-copilot-conversation.dto';

@Public()
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

    try {
      for await (const chunk of this.copilot.chatStream(dto)) {
        if (typeof raw?.write === 'function') {
          raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      }
      if (typeof raw?.write === 'function') {
        raw.write('data: [DONE]\n\n');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (typeof raw?.write === 'function') {
        raw.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
      }
    } finally {
      if (typeof raw?.end === 'function') {
        raw.end();
      }
    }
  }
}
