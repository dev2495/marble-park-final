import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersResolver } from './customers.resolver';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [CustomersService, CustomersResolver],
  exports: [CustomersService],
})
export class CustomersModule {}
