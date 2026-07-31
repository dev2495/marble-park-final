import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OperationsResolver } from './operations.resolver';
import { OperationsService } from './operations.service';
import { ReceivablesModule } from '../receivables/receivables.module';

@Module({
  imports: [PrismaModule, ReceivablesModule],
  providers: [OperationsResolver, OperationsService],
  exports: [OperationsService],
})
export class OperationsModule {}
