import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ChatMessageDto {
  @IsIn(['user', 'assistant', 'system'])
  role!: 'user' | 'assistant' | 'system';

  @IsString()
  @MaxLength(4000)
  content!: string;
}

export class CopilotChatDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];

  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsOptional()
  @IsObject()
  scope?: Record<string, unknown>;
}
