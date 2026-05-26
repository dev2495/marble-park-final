import { Module } from '@nestjs/common';
import { PortalService } from './portal.service';
import { PortalResolver } from './portal.resolver';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [PortalService, PortalResolver],
  exports: [PortalService],
})
export class PortalModule {}
