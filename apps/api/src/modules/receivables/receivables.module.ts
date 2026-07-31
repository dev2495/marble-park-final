import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ReceivablesResolver } from './receivables.resolver';
import { ReceivablesService } from './receivables.service';

@Module({
  imports: [AuditModule],
  providers: [ReceivablesService, ReceivablesResolver],
  exports: [ReceivablesService],
})
export class ReceivablesModule {}
