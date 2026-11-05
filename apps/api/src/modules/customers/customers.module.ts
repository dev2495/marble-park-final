import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersResolver } from './customers.resolver';
import { AuditModule } from '../audit/audit.module';
import { ShowroomVisitsService } from './showroom-visits.service';
import { ShowroomVisitsResolver } from './showroom-visits.resolver';

@Module({
  imports: [AuditModule],
  providers: [CustomersService, CustomersResolver, ShowroomVisitsService, ShowroomVisitsResolver],
  exports: [CustomersService],
})
export class CustomersModule {}
