import { Module } from '@nestjs/common';
import { TargetsService } from './targets.service';
import { TargetsResolver } from './targets.resolver';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [TargetsService, TargetsResolver],
  exports: [TargetsService],
})
export class TargetsModule {}
