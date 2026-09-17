import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [MediaController] })
export class MediaModule {}
