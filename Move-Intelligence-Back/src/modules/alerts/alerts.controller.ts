import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { AlertRuleConfig, AlertsService } from './alerts.service';

@Public()
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.alerts.list(status);
  }

  @Post(':id/ack')
  acknowledge(@Param('id') id: string) {
    return this.alerts.acknowledge(id);
  }

  @Get('rules')
  getRules() {
    return this.alerts.getRules();
  }

  @Post('rules')
  saveRules(@Body() dto: AlertRuleConfig) {
    return this.alerts.saveRules(dto);
  }

  @Post('test-webhook')
  testWebhook(@Body() dto: { webhookUrl: string; channel: 'slack' | 'telegram' | 'generic'; telegramChatId?: string }) {
    return this.alerts.testWebhook(dto.webhookUrl, dto.channel, dto.telegramChatId);
  }

  @Post('scan')
  scanOpportunities() {
    return this.alerts.scanOpportunitiesAndNotify();
  }
}
