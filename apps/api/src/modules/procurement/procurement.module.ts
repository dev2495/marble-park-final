import { Module } from '@nestjs/common';
import { ProcurementResolver } from './procurement.resolver';
import { ProcurementService } from './procurement.service';

@Module({
  providers: [ProcurementService, ProcurementResolver],
  exports: [ProcurementService],
})
export class ProcurementModule {}
