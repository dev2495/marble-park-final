import { Module } from '@nestjs/common';
import { IntentsService } from './intents.service';
import { IntentsResolver } from './intents.resolver';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [IntentsService, IntentsResolver],
  exports: [IntentsService],
})
export class IntentsModule {}
