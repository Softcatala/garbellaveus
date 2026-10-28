import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { SubscriptionService } from '../service/subscription.service';

class RequestConfirmationDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @IsNotEmpty() @MaxLength(100) username: string;
}

class TokenDto {
  @IsOptional() @IsString() @MaxLength(1000) token?: string;
}

@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly service: SubscriptionService) {}

  @Get('status')
  async status(@Query('username') username = '') {
    if (!username) return { subscribed: false, validations: 0 };
    return this.service.status(username);
  }

  @Post('request')
  @HttpCode(200)
  async request(@Body() dto: RequestConfirmationDto) {
    await this.service.requestConfirmation(dto.email, dto.username);
    return { status: 'sent' };
  }

  @Post('confirm')
  @HttpCode(200)
  async confirm(@Body() dto: TokenDto) {
    await this.service.confirm(dto.token ?? '');
    return { status: 'confirmed' };
  }

  // The token may arrive in the body (the SPA) or the query string (the
  // List-Unsubscribe one-click POST, whose body is not JSON).
  @Post('unsubscribe')
  @HttpCode(200)
  async unsubscribe(@Body() dto: TokenDto, @Query('token') queryToken?: string) {
    await this.service.unsubscribe(dto?.token ?? queryToken ?? '');
    return { status: 'unsubscribed' };
  }
}
