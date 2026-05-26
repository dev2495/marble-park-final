import { Module } from '@nestjs/common';
import { CommunicationsService } from './communications.service';
import { CommunicationsResolver } from './communications.resolver';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [CommunicationsService, CommunicationsResolver],
  exports: [CommunicationsService],
})
export class CommunicationsModule {}
