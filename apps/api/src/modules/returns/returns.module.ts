import { Module } from '@nestjs/common';
import { ReturnsService } from './returns.service';
import { ReturnsResolver } from './returns.resolver';
import { AuditModule } from '../audit/audit.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [AuditModule, PaymentsModule],
  providers: [ReturnsService, ReturnsResolver],
  exports: [ReturnsService],
})
export class ReturnsModule {}
